// All privileged requests originate here, never in the browser or CC computer.
import { createHmac, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { requireActor, HttpError } from './auth.js';
import { logActivity, now } from './db.js';
import { cannonRange } from './cannon-range.js';
import { createCannonDiscovery } from './cannon-discovery.js';

export function bridgeClient(config) {
  return async (action, obj) => {
    if (!config.cannonBridgeUrl || !config.cannonBridgeSecret || config.cannonBridgeSecret.length < 32) throw new HttpError(503,'Live-Bridge nicht konfiguriert; keine Materialfreigabe.');
    const path='/campus/'+action, body=JSON.stringify(obj), stamp=String(Math.floor(Date.now()/1000)), nonce=randomBytes(24).toString('base64url');
    const signature=createHmac('sha256',config.cannonBridgeSecret).update(path+'\n'+stamp+'\n'+nonce+'\n'+body).digest('hex');
    let res;
    try { res=await fetch(config.cannonBridgeUrl+path,{method:'POST',headers:{'content-type':'application/json','X-Campus-Time':stamp,'X-Campus-Nonce':nonce,'X-Campus-Signature':signature},body,signal:AbortSignal.timeout(10000),redirect:'error'}); }
    catch { throw new HttpError(503,'Live-Bridge offline oder Zeitüberschreitung; Material gesperrt.'); }
    let data; try { data=await res.json(); } catch { throw new HttpError(503,'Ungültige Live-Probe; Material gesperrt.'); }
    if (!res.ok) throw new HttpError(res.status===401 ? 503 : 409,data.error || 'Live-Probe abgelehnt.');
    return data;
  };
}

const same=isDeepStrictEqual;
export function verifyAlignment(desired,o,receipt) {
  if(!receipt || !same(desired,receipt))return 'Gewählte Bauplanversion noch nicht sicher angewendet. Stoppen/zurücksetzen und Anwenden wiederholen.';
  if(!o || !Number.isFinite(o.at) || Math.abs(Date.now()/1000-o.at)>15)return 'Live-Probe fehlt oder ist veraltet.';
  if(o.fileHash!==desired.sha256)return 'Datei-/Revisionshash stimmt nicht mit der gewählten Campus-Version überein.';
  if(desired.options && !same(o.options,desired.options))return 'Kanonen-Einstellungen stimmen nicht mit dem vorbereiteten Plan überein.';
  const expected={'create:schematic_file':desired.file,'create:schematic_owner':desired.owner,'create:schematic_anchor':desired.anchor,'create:schematic_rotation':desired.rotation,'create:schematic_mirror':desired.mirror,'create:schematic_deployed':1};
  if(o.item!=='create:schematic' || Object.entries(expected).some(([k,v])=>!same(o.components?.[k],v)))return 'Schematic-Datei, Owner, Anker, Rotation oder Spiegelung abweichend.';
  if(!['STOPPED','RUNNING','PAUSED'].includes(o.state))return 'Unbekannter nativer Kanonenzustand.';
  if(!o.printer || typeof o.printer!=='object')return 'Printer-Zustand unbekannt.';
  if(o.state!=='STOPPED' && !same(o.printer.Anchor,desired.anchor))return 'Aktiver Printer-Cache hat einen anderen/unbekannten Anker.';
  if(o.printer.Anchor && !same(o.printer.Anchor,desired.anchor))return 'Printer-Cache stimmt nicht mit dem Sollanker überein.';
  return null;
}

export function registerAlignment(app, campus, schematics) {
  const db=campus.db;
  db.exec(`CREATE TABLE IF NOT EXISTS cannon_alignment (name TEXT PRIMARY KEY COLLATE NOCASE, binding_json TEXT NOT NULL, applied_json TEXT, last_error TEXT, updated_at TEXT NOT NULL);`);
  const row=name=>db.prepare('SELECT * FROM cannons WHERE name = ?').get(name);
  const record=name=>db.prepare('SELECT * FROM cannon_alignment WHERE name = ?').get(name);
  const request=campus.config.cannonBridgeRequest || bridgeClient(campus.config);
  let discovery;
  const check=name=>{const r=row(name);if(!r)throw new HttpError(404,'Station nicht gefunden.');return r;};
  const admin=req=>{
    const actor=requireActor(req,'admin');
    if(req.method!=='GET' && req.headers.origin && req.headers.origin!==campus.config.publicUrl)throw new HttpError(403,'Fremder Origin abgelehnt.');
    return actor;
  };
  const desiredFor=(r,rec)=>{
    if(!r.blueprint_id)return null;
    const bp=campus.getBlueprint(r.blueprint_id),v=campus.version(bp.id,r.version),binding=JSON.parse(rec.binding_json);
    if(bp.archived)throw new HttpError(409,'Bauplan archiviert.');
    const sc=schematics.view(r.name);
    if(sc.settings.enabled) {
      const job=sc.job;
      if(!job || ['empty','outofrange'].includes(job.state))return null;
      return {file:job.fileName,sha256:job.sha256,owner:binding.owner,anchor:job.origin,rotation:'none',mirror:'none',blueprint:job.blueprint,version:job.version,assignment:r.assignment,
        options:{replace_mode:sc.settings.replaceMode,skip_missing:sc.settings.skipMissing,replace_block_entities:!sc.settings.protectBlockEntities}};
    }
    return {file:bp.fileName,sha256:v.sha256,owner:binding.owner,anchor:v.origin,rotation:'none',mirror:'none',blueprint:bp.id,version:v.version,assignment:r.assignment};
  };
  const disabled={state:'disabled',enabled:false,binding:null,desired:null,observed:null,message:'Ausrichtung deaktiviert: keine bestätigte Blockbindung. Bestehender Materialfluss unverändert.'};
  const observedStates=new Map();
  const notifyView=(name,result)=>{
    const o=result.observed;
    const signature=JSON.stringify([result.state,result.message,result.discovery?.state,result.discovery?.message,result.discovery?.computerId,o?.state,o?.status,o?.amountPlaced,o?.amountToPlace,o?.fileHash,o?.options,o?.components]);
    if(observedStates.get(name)!==signature){observedStates.set(name,signature);app.updates?.publish('cannons',name);}
    return result;
  };
  const view=async(name,{notify=false}={})=>{
    // Browser reads must never trigger an SSE -> GET -> SSE feedback loop while
    // native counters advance. Only scheduled observations and actions publish.
    const found=discovery?.view(name);
    const finish=result=>{
      const latest=discovery?.view(name);
      const enriched={...result,...(latest?{discovery:latest}:{}),...(latest&&latest.state!=='bound'?{enabled:true,state:'pending',observed:null,message:latest.message}:{})};
      return notify?notifyView(name,enriched):enriched;
    };
    const rec=record(name);
    if(found && found.state!=='bound')return finish({enabled:true,state:'pending',binding:rec?JSON.parse(rec.binding_json):null,desired:null,observed:null,message:found.message});
    if(!rec)return finish({...disabled});
    let desired=null;const binding=JSON.parse(rec.binding_json);
    try{
      const proof=discovery?.proof(name);
      const r=check(name);desired=desiredFor(r,rec);
      const result=await request('inspect',{station:r.name});
      discovery?.assertCurrent(name,proof);
      if(!same(binding,result.binding))throw new HttpError(409,'Host-Registry weicht von bestätigter Campus-Bindung ab.');
      if(row(name)?.assignment!==r.assignment || record(name)?.binding_json!==rec.binding_json)throw new HttpError(409,'Auftrag während Live-Probe geändert.');
      const rangeJob=schematics.view(name).job;
      const mismatch=desired?verifyAlignment(desired,result.observed,JSON.parse(rec.applied_json||'null')):'Kein Bauplan gewählt.';
      // A transient discovery/transport failure must not mask a later complete
      // native proof. Keep its diagnosis only while the actual alignment fails.
      const message=rangeJob?.state==='outofrange' && schematics.settingsFor(name).enabled ? rangeJob.message : mismatch ? (rec.last_error || mismatch) : null;
      return finish({enabled:true,state:message?'pending':'aligned',binding,desired,observed:result.observed,message:message||'Live geprüft: exakte Revision, Owner und Ausrichtung stimmen.'});
    }catch(e){return finish({enabled:true,state:e.statusCode===409?'mismatch':'offline',binding,desired,observed:null,message:e.message});}
  };
  const applying=new Set();
  campus.assertBlueprintWritable=id=>{
    for(const r of db.prepare('SELECT name FROM cannons WHERE blueprint_id=?').all(id)){
      if(applying.has(r.name.toLowerCase()))throw new HttpError(409,'Kanone wird gerade vorbereitet oder gestartet. Bauplan danach erneut ändern.');
    }
  };
  const bindingFor=name=>{const rec=record(name);return rec?JSON.parse(rec.binding_json):null;};
  const prepare=async(name,actor,{force=false}={})=>{
    name=check(name).name.toLowerCase();
    if(applying.has(name))throw new HttpError(409,'Schematic-Vorbereitung läuft bereits.');
    applying.add(name);
    let job;
    try {
      const proof=await discovery?.ensure(name,{locked:true,actor});
      const rec=record(name),r=check(name);
      if(!rec)throw new HttpError(409,'Zuerst den Kanonen-Block bestätigen.');
      const sc=schematics.sync(r,campus.latestSnapshot('live'),bindingFor(name),force);job=sc.job;
      if(!sc.settings.enabled || !job || ['empty','ready','outofrange'].includes(job.state))return view(name,{notify:true});
      const desired=desiredFor(r,rec),{assignment,options,...target}=desired;
      db.prepare('UPDATE cannon_alignment SET applied_json=NULL,last_error=NULL WHERE name=?').run(name);
      const result=await request('prepare',{station:r.name,desired:target,options,size:job.size,nbtBase64:schematics.bytes(job).toString('base64')});
      discovery?.assertCurrent(name,proof);
      if(!same(JSON.parse(rec.binding_json),result.binding) || row(name)?.assignment!==assignment || record(name)?.binding_json!==rec.binding_json)throw new HttpError(409,'Auftrag/Bindung während Vorbereitung geändert.');
      const error=verifyAlignment(desired,result.observed,desired);if(error)throw new HttpError(409,error);
      schematics.ready(name,job.id);
      const receipt=desiredFor(check(name),record(name));
      db.prepare('UPDATE cannon_alignment SET applied_json=?,last_error=NULL,updated_at=? WHERE name=?').run(JSON.stringify(receipt),now(),name);
      logActivity(db,actor,'schematic.ready',name,{job:job.id,version:job.version,origin:job.origin});
      return view(name,{notify:true});
    }catch(e){const previous=record(name)?.last_error;if(job)schematics.waiting(name,job.id,e.message);db.prepare('UPDATE cannon_alignment SET last_error=? WHERE name=?').run(e.message,name);if(previous!==e.message)app.updates?.publish('cannons',name);throw e;}
    finally{applying.delete(name);}
  };
  const apply=async(name,actor)=>{
    if(schematics.settingsFor(name).enabled)return prepare(name,actor);
    name=check(name).name.toLowerCase();
    if(applying.has(name))throw new HttpError(409,'Ausrichtungsauftrag läuft bereits.');
    applying.add(name);
    try{
      const proof=await discovery?.ensure(name,{locked:true,actor});
      const rec=record(name),r=check(name);if(!rec)throw new HttpError(409,'Admin muss zuerst den Block binden.');
      const desired=desiredFor(r,rec);if(!desired)throw new HttpError(409,'Zuerst Bauplan auswählen.');
      const range=cannonRange(JSON.parse(rec.binding_json),desired.anchor);
      if(range.state!=='inrange')throw new HttpError(409,range.message);
      // Revoke prior receipt before issuing any write. Failures remain fail-closed.
      db.prepare('UPDATE cannon_alignment SET applied_json=NULL,last_error=NULL WHERE name=?').run(name);
      const {assignment,...target}=desired;
      const result=await request('apply',{station:r.name,desired:target});
      discovery?.assertCurrent(name,proof);
      if(!same(JSON.parse(rec.binding_json),result.binding) || row(name)?.assignment!==assignment || record(name)?.binding_json!==rec.binding_json)throw new HttpError(409,'Auftrag/Bindung während Apply geändert; keine Materialfreigabe.');
      const error=verifyAlignment(desired,result.observed,desired);if(error)throw new HttpError(409,error);
      db.prepare('UPDATE cannon_alignment SET applied_json=?,last_error=NULL,updated_at=? WHERE name=?').run(JSON.stringify(desired),now(),name);
      logActivity(db,actor,'cannon.alignment.apply',name,{desired});
      return view(name,{notify:true});
    }catch(e){const previous=record(name)?.last_error;db.prepare('UPDATE cannon_alignment SET last_error=? WHERE name=?').run(e.message,name);logActivity(db,actor,'cannon.alignment.blocked',name,{message:e.message});if(previous!==e.message)app.updates?.publish('cannons',name);throw e;}
    finally{applying.delete(name);}
  };
  const gate=async(name,plan)=>{
    const alignment=await view(name,{notify:true});
    if(plan.state==='outofrange'){alignment.state='outofrange';alignment.message=plan.message;}
    if(alignment.enabled && (row(name)?.assignment!==plan.assignment || applying.has(name.toLowerCase()))) {alignment.state='pending';alignment.message='Auftrag geändert oder Apply läuft; Plan erneut abrufen.';}
    if(alignment.enabled){alignment.leaseSeconds=10;plan={...plan,intervals:{...plan.intervals,plan:5}};}
    if(plan.state!=='outofrange' && (!alignment.enabled || alignment.state==='aligned'))return {...plan,alignment};
    return {...plan,state:plan.state==='outofrange'?'outofrange':'alignment',message:alignment.message,items:[],done:false,alignment,options:{...plan.options,paused:true,gunpowder:0,autoCraft:false}};
  };
  app.get('/api/cannons/:name/alignment',async req=>{requireActor(req,'read');check(req.params.name);return view(req.params.name);});
  app.post('/api/cannons/:name/alignment/probe',async req=>{
    const a=admin(req);check(req.params.name);
    const result=await request('probe',{binding:req.body?.binding});
    logActivity(db,a,'cannon.alignment.probe',req.params.name,{binding:result.binding});return result;
  });
  app.post('/api/cannons/:name/alignment/bind',async req=>{
    const a=admin(req);const r=check(req.params.name);
    if(req.body?.confirm!==true)throw new HttpError(400,'Block und Aktivierung ausdrücklich bestätigen.');
    const status=JSON.parse(r.status_json||'null');
    if(!['1.1.0','1.2.0','1.3.0','1.4.0'].includes(status?.script) || !Number.isFinite(Date.parse(status.at)) || Date.now()-Date.parse(status.at)>180000)throw new HttpError(409,'Vor Aktivierung Feeder aktualisieren und frische Statusmeldung abwarten. Legacy-Feeder können alte Materialpläne weiterverwenden.');
    return withStationsLocked([r.name],async()=>{
      const result=await request('bind',{station:r.name,binding:req.body.binding,nonce:req.body.nonce});
      db.prepare('INSERT INTO cannon_alignment(name,binding_json,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET binding_json=excluded.binding_json,applied_json=NULL,last_error=NULL,updated_at=excluded.updated_at').run(r.name,JSON.stringify(result.binding),now());
      discovery.manual(r.name);
      logActivity(db,a,'cannon.alignment.bind',r.name,{binding:result.binding});return view(r.name,{notify:true});
    });
  });
  app.post('/api/cannons/:name/alignment/apply',async req=>{const a=admin(req);check(req.params.name);return apply(req.params.name,a);});
  app.post('/api/cannons/:name/schematic/prepare',async req=>{
    const actor=admin(req),r=check(req.params.name);
    if(applying.has(r.name.toLowerCase()))throw new HttpError(409,'Vorbereitung läuft bereits.');
    if(!schematics.settingsFor(r.name).enabled || !r.blueprint_id)throw new HttpError(400,'Automatische Vorbereitung aktivieren und einen Bauplan wählen.');
    if(!campus.latestSnapshot('live'))throw new HttpError(503,'Noch kein Live-Snapshot.');
    try{await prepare(r.name,actor,{force:true});}catch{/* Exact refusal is stored in the job and alignment view. */}
    return schematics.view(r.name);
  });
  app.post('/api/cannons/:name/start',async req=>{
    const actor=admin(req),name=check(req.params.name).name,input=req.body||{};
    if(!Number.isSafeInteger(input.assignment)||!Number.isSafeInteger(input.version)||input.version<1||Object.keys(input).some(k=>!['assignment','version'].includes(k)))throw new HttpError(400,'Auftragsnummer und Bauplanversion erforderlich.');
    return withStationsLocked([name],async()=>{
      try{
        const proof=await discovery?.ensure(name,{locked:true,actor});
        const r=check(name),rec=record(name);
        if(!rec)throw new HttpError(409,'Zuerst den Kanonen-Block bestätigen.');
        if(r.assignment!==input.assignment||r.version!==input.version)throw new HttpError(409,'Auftrag oder Version geändert. Bitte neu laden.');
        if(!r.last_seen_at||!Number.isFinite(Date.parse(r.last_seen_at))||Date.now()-Date.parse(r.last_seen_at)>=180000)throw new HttpError(409,'Kanonen-Computer ist offline. Start abgelehnt.');
        if(JSON.parse(r.options_json||'{}').paused)throw new HttpError(409,'Materialzufuhr ist pausiert. Vor dem Start wieder aktivieren.');
        const sc=schematics.sync(r,campus.latestSnapshot('live'),JSON.parse(rec.binding_json));
        if(!sc.settings.enabled||sc.job?.state!=='ready'||sc.job.version!==input.version)throw new HttpError(409,'Zuerst das Schematic automatisch vorbereiten lassen.');
        const desired=desiredFor(r,rec),range=cannonRange(JSON.parse(rec.binding_json),desired.anchor);
        if(range.state!=='inrange')throw new HttpError(409,range.message);
        if(!same(desired,JSON.parse(rec.applied_json||'null')))throw new HttpError(409,'Vorbereitete Revision ist noch nicht bestätigt.');
        const inspected=await request('inspect',{station:name});
        discovery?.assertCurrent(name,proof);
        if(!same(JSON.parse(rec.binding_json),inspected.binding))throw new HttpError(409,'Host-Registry weicht von bestätigter Bindung ab.');
        const error=verifyAlignment(desired,inspected.observed,desired);if(error)throw new HttpError(409,error);
        const unchanged=()=>row(name)?.assignment===r.assignment&&record(name)?.binding_json===rec.binding_json&&schematics.view(name).job?.id===sc.job.id&&same(desiredFor(check(name),record(name)),desired);
        if(!unchanged())throw new HttpError(409,'Auftrag während Startprüfung geändert.');
        const {assignment,options,...target}=desired;
        const result=await request('start',{station:name,desired:target,options});
        discovery?.assertCurrent(name,proof);
        if(!unchanged()||!same(result.binding,JSON.parse(rec.binding_json)))throw new HttpError(409,'Auftrag während Start geändert. Nativen Zustand prüfen.');
        const mismatch=verifyAlignment(desired,result.observed,desired);
        if(mismatch||!result.started||!['RUNNING','PAUSED'].includes(result.observed?.state))throw new HttpError(409,mismatch||'Start nicht bestätigt. Nativen Zustand prüfen.');
        logActivity(db,actor,'cannon.start',name,{version:input.version,assignment:input.assignment,alreadyRunning:!!result.alreadyRunning,state:result.observed.state});
        app.updates?.publish('cannons',name);
        return notifyView(name,{enabled:true,state:'aligned',binding:result.binding,desired,observed:result.observed,started:true,alreadyRunning:!!result.alreadyRunning,
          message:result.alreadyRunning?'Kanone läuft bereits mit diesem Bauplan.':result.observed.state==='PAUSED'?'Start übernommen. Kanone ist aktuell pausiert.':'Bau gestartet.'});
      }catch(e){
        logActivity(db,actor,'cannon.start.blocked',name,{message:e.message});app.updates?.publish('cannons',name);throw e;
      }
    });
  });
  let timer,preparing=null,closing=false;
  const prepareQueued=async()=>{
    if(closing||preparing)return preparing;
    preparing=(async()=>{
    for(const r of db.prepare('SELECT * FROM cannons WHERE blueprint_id IS NOT NULL').all()) {
      if(closing)break;
      if(!record(r.name) || !schematics.settingsFor(r.name).enabled || applying.has(r.name.toLowerCase()))continue;
      try{await prepare(r.name,null);}catch{/* Fail closed; the next poll retries at a safe stop. */}
    }
    })();
    try{await preparing;}finally{preparing=null;}
  };
  app.addHook('onReady',async()=>{timer=setInterval(()=>void prepareQueued(),10000);timer.unref();});
  app.addHook('preClose',async()=>{closing=true;clearInterval(timer);});
  app.addHook('onClose',async()=>{if(preparing)await preparing;});
  const withStationsLocked=async(names,fn)=>{
    const keys=[...new Set(names.map(n=>check(n).name.toLowerCase()))];
    if(keys.some(n=>applying.has(n)))throw new HttpError(409,'Eine Kanone wird gerade vorbereitet. Bitte kurz warten.');
    keys.forEach(n=>applying.add(n));
    try{return await fn();}finally{keys.forEach(n=>applying.delete(n));}
  };
  const inspect=async name=>{
    const proof=await discovery?.ensure(name,{locked:true});
    const binding=bindingFor(name);
    if(!binding)throw new HttpError(409,'Zuerst den Kanonen-Block bestätigen.');
    const result=await request('inspect',{station:check(name).name});
    discovery?.assertCurrent(name,proof);
    if(!same(binding,result.binding) || !same(binding,bindingFor(name)))throw new HttpError(409,'Blockbindung wurde geändert. Bitte erneut prüfen.');
    if(!Number.isFinite(result.observed?.at) || Math.abs(Date.now()/1000-result.observed.at)>15)throw new HttpError(409,'Live-Prüfung fehlt oder ist veraltet.');
    return result.observed;
  };
  const revoke=name=>db.prepare('UPDATE cannon_alignment SET applied_json=NULL,last_error=NULL,updated_at=? WHERE name=?').run(now(),name);
  discovery=createCannonDiscovery({app,campus,schematics,request,row,record,withStationsLocked,busy:name=>applying.has(name.toLowerCase()),
    afterBound:async(name,actor)=>{if(row(name)?.blueprint_id&&schematics.settingsFor(name).enabled)try{await prepare(name,actor);}catch{/* Stored pending state is visible; never start automatically. */}}});
  app.post('/api/cannons/:name/discover',async req=>{
    const actor=admin(req),name=check(req.params.name).name;
    if(applying.has(name.toLowerCase()))throw new HttpError(409,'Kanone wird gerade vorbereitet, gestartet oder geprüft.');
    try{await discovery.discover(name,actor,true);}catch{/* The persisted diagnosis is returned below. */}
    return view(name,{notify:true});
  });
  return {view,gate,apply,prepare,admin,inspect,revoke,withStationsLocked,binding:bindingFor,busy:name=>applying.has(name.toLowerCase()),enabled:name=>!!record(name),managed:discovery.managed,locationReady:name=>!!record(name)&&(!discovery.managed(name)||discovery.view(name)?.state==='bound')};
}
