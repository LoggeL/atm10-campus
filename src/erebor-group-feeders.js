import {randomBytes,createHash} from 'node:crypto';
import {HttpError} from './auth.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message)=>{throw new HttpError(code,message);};
// Intentionally no public registration endpoint: only an independently verified
// pilot mapping may be provisioned by a trusted installer. Empty is disabled.
export function registerGroupFeeders(app,campus){
 const db=campus.db;
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_group_feeders(
 site TEXT NOT NULL,group_id TEXT NOT NULL,version INTEGER NOT NULL,
 computer_id INTEGER NOT NULL UNIQUE,chest_side TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,claim TEXT,claim_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(site,group_id));`);
 const lookup=db.prepare('SELECT * FROM erebor_group_feeders WHERE site=? AND group_id=? AND token_hash=?');
 const snapshot=b=>{
  const config=db.prepare("SELECT q.version,q.enabled,p.current_version FROM erebor_queue_config q JOIN build_projects p ON p.id='erebor' WHERE q.id=1").get();
  const all=db.prepare('SELECT site,slot,job FROM erebor_helpers WHERE version=? ORDER BY site,slot').all(b.version);
  const rows=all.filter(r=>r.site===b.site&&b.group_id.includes(r.slot));
  const files=rows.map(r=>JSON.parse(r.job||'null')?.desired?.file).filter(Boolean);
  const assigned=all.map(r=>JSON.parse(r.job||'null')?.desired?.file).filter(Boolean);
  const mains=db.prepare('SELECT state FROM erebor_queue_sites').all().map(r=>JSON.parse(r.state||'{}').job?.desired?.file).filter(Boolean);
  if(files.some(file=>assigned.filter(f=>f===file).length!==1||mains.includes(file)))fail(409,'Bauplan ist mehrfach reserviert.');
  if(!config?.enabled||config.version!==b.version||config.current_version!==b.version||rows.length!==3||rows.some(r=>{const j=JSON.parse(r.job||'null');return !j?.loaded||j.tainted||!j.desired?.file;}))fail(409,'Gruppe hat keine drei freigegebenen Aufträge.');
  const station=db.prepare('SELECT options_json FROM cannons WHERE name=?').get('erebor-'+b.site);
  if(!station||JSON.parse(station.options_json||'{}').paused)fail(409,'Standort-Materialzufuhr ist gesperrt.');
  return JSON.stringify([config,rows,station.options_json]);
 };
 app.post('/api/erebor/groups/:site/:group/plan',async req=>{
  const credential=/^Bearer (\S+)$/.exec(req.headers.authorization||'')?.[1];
  const b=credential&&lookup.get(req.params.site,req.params.group,hash(credential));
  if(!b)fail(401,'Gruppen-Anmeldung erforderlich.');
  if(req.body?.computerId!==b.computer_id||req.body?.chestSide!==b.chest_side)fail(403,'Computer oder Kiste passt nicht zur Gruppe.');
  const before=snapshot(b),claim=randomBytes(24).toString('hex'),time=Date.now();
  const changed=db.prepare('UPDATE erebor_group_feeders SET claim=?,claim_until=? WHERE site=? AND group_id=? AND token_hash=? AND claim_until<=?').run(claim,time+30000,b.site,b.group_id,b.token_hash,time);
  if(!changed.changes)fail(409,'Materialprüfung läuft bereits.');
  try{
   const binding={site:b.site,group:b.group_id,version:b.version,computerId:b.computer_id,chestSide:b.chest_side};
   const row={name:'erebor-'+b.site+'-'+b.group_id,assignment:0,options_json:'{}',status_json:JSON.stringify({computerId:b.computer_id,chestSide:b.chest_side,at:new Date().toISOString()})};
   const plan=await campus.ereborFeeder(row,{options:{paused:false,returnLeftovers:false,autoCraft:false,gunpowder:0},intervals:{plan:5}},binding);
   const current=lookup.get(b.site,b.group_id,b.token_hash);
   if(!current||current.claim!==claim||current.claim_until<=Date.now()||snapshot(b)!==before)fail(409,'Gruppenauftrag während der Prüfung geändert.');
   return plan;
  }finally{db.prepare('UPDATE erebor_group_feeders SET claim=NULL,claim_until=0 WHERE site=? AND group_id=? AND claim=?').run(b.site,b.group_id,claim);}
 });
 return {register(mapping){
  const {site,group,version,computerId,chestSide}=mapping;
  if(site!=='K12'||!['DEF','GHI'].includes(group)||!Number.isSafeInteger(version)||version<1||!Number.isSafeInteger(computerId)||computerId<0||!['front','back','left','right','top','bottom'].includes(chestSide))fail(400,'Ungültige Pilotbindung.');
  const token=randomBytes(32).toString('base64url');
  // No replace/upsert: rebinding must explicitly revoke the old identity first.
  db.prepare('INSERT INTO erebor_group_feeders(site,group_id,version,computer_id,chest_side,token_hash) VALUES(?,?,?,?,?,?)').run(site,group,version,computerId,chestSide,hash(token));
  return token;
 }};
}
