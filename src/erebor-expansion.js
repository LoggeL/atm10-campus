// Integer expansion of the interior; the entrance and exterior remain anchored.
import {balanceRooms,centeredStarts,hallColumns} from './erebor-symmetry.js';
export const INTERIOR_IDS=new Set(['E05','E06','E07','E08','E09','E10','E11','E12','E13','E14','E15','E16','E17','E18','E19','E21A','E21B','S1','S2','S3','S4']);
export const expandPoint=([x,y,z])=>[Math.round(x*1.5),y,z<-24?-24+Math.round((z+24)*1.5):z];
export function expandedPlan(original){
 const p=structuredClone(original);if(p.interiorExpansion)throw Error('Innenausbau bereits erweitert');
 const sourceZones=structuredClone(p.zones.filter(z=>INTERIOR_IDS.has(z.id)));
 p.interiorExpansion={revision:2,scale:[1.5,1,1.5],sourceZones,sourceVersion:6,description:'Innenräume 50 % breiter und tiefer; zwei Ringgänge auf Y88/Y112 und neun neue Hallen. Tor und Außenanlagen unverändert.'};
 for(const z of p.zones)if(INTERIOR_IDS.has(z.id)){z.bounds=z.bounds.map(expandPoint);delete z.worldFootprint;delete z.worldBounds;z.features=[`R2: Innenraumraster in Breite und Tiefe 1,5-fach erweitert; Höhen beibehalten.`,...(z.features||[]).filter(t=>!/[XYZ]|\d/.test(t))];}
 const sideTitles=[['Archiv der Sippen','Bibliothek und Runenkunde'],['Gildenhalle der Handwerker','Markt und Versammlung'],['Wachhalle der Tiefen','Forschung und Kartensaal']];
 let id=30;
 for(const [row,z]of [-400,-784,-1184].entries())for(const side of [-1,1]){
  const x=side<0?-664:536; p.zones.push({id:'E'+id++,title:sideTitles[row][side<0?0:1],style:row===0?'royal':'mixed',bounds:[[x,-4,z],[x+128,48,z+144]],floors:[0,24],features:['Große Halle mit umlaufender Galerie, vier Nebenräumen und eigener Treppe','Zugänge zu beiden Ringgang-Ebenen']});
 }
 for(const [i,x]of [-320,-112,160].entries())p.zones.push({id:'E'+id++,title:['Westliche Wohnhalle','Große Halle des Westens','Westliches Handwerksquartier'][i],style:i===1?'royal':'mixed',bounds:[[x,-4,-1440],[x+(i===1?224:160),48,-1280]],floors:[0,24],features:['Zwei Ebenen, Galerie und vier Nebenräume','Vom westlichen Quergang erreichbar']});
 p.envelope.interior=[1328,1440];
 p.summary='Erebor im 2.000 × 2.000 großen Berg: erweiterte Haupthallen, neun zusätzliche Hallen, zwei Gang-Ebenen und Querverbindungen. Osttor, Dale, Esgaroth und Außenanlagen bleiben am geplanten Standort.';
 p.stoneStart.preparedBaseVersion=6;
 p.validation={...p.validation,checked:'2026-11-04',notes:'Architektur R2: Innenraster horizontal 1,5-fach. Zusätzliche Räume und Gänge blockgenau erzeugt. Die gespeicherte Welt wird beim NBT-Export geprüft; unbekannte Aushubzellen bleiben ausgelassen.'};
 for(const z of p.zones.filter(z=>/^E3[0-8]$/.test(z.id)))p.packages.push({id:z.id,title:z.title,phase:5,dependencies:['E29'],notes:['Architektur R2; Aushub vor BAU ausführen.']});
 return p;
}

// R2 persisted references to the already scaled zone objects. Restore the source
// raster only when *all* source bounds match their expanded counterparts.
export function interiorBasis(plan){
 const source=plan.interiorExpansion.sourceZones;
 const repeated=source.every(s=>JSON.stringify(s.bounds)===JSON.stringify(plan.zones.find(z=>z.id===s.id)?.bounds));
 const inverse=([x,y,z])=>[Math.round(x/1.5),y,z<-24?-24+Math.round((z+24)/1.5):z];
 return {...plan,zones:source.map(s=>({...structuredClone(s),bounds:repeated?s.bounds.map(inverse):structuredClone(s.bounds)}))};
}

export function appendExpandedOps(target,source){
 const remap=source.palette.map(s=>s.name==='minecraft:air'?0:target.state(s));
 for(const o of source.ops){
  const core=o.g.startsWith('S')&&source.plan.zones.find(z=>z.id===o.g);
  const expand=core?p=>expandCorePoint(core,p):expandPoint;
  target.ops.push({...o,a:expand(o.a),b:expand(o.b),s:remap[o.s]});
 }
}
export function expandCorePoint(zone,p){
 const center=zone.bounds[0].map((v,i)=>(v+zone.bounds[1][i])/2),target=expandPoint(center);
 return p.map((v,i)=>i===1?v:target[i]+Math.sign(v-center[i])*Math.round(Math.abs(v-center[i])*1.5));
}
export function appendExpandedInterior(target,source){
 appendExpandedOps(target,source);
 target.stairChecks.push(...source.stairChecks.map(c=>({...c,a:expandPoint(c.a),b:expandPoint(c.b),s:target.state(source.palette[c.s])})));
 target.rooms.push(...source.rooms.map(r=>({...r,bounds:r.bounds.map(expandPoint)})));
 target.routes.push(...source.routes.map(r=>({...r,points:r.points.map(expandPoint),width:Math.round(r.width*1.5),sourceRoute:r,expanded:true})));
 target.features.push(...source.features,'Innenbereiche 50 % breiter und tiefer; Höhen und Osttor unverändert');
}

export function addExpansion(d,p,M){
 const first=d.routes.length;
 for(const zone of p.zones.filter(z=>/^E3[0-8]$/.test(z.id))){
  const supports=hallColumns(zone),{x,X,z,Z}=d.shell(zone,{columns:false,supports});
  for(const xx of supports.xs)for(const zz of supports.zs)d.pillar(xx,zz,0,41,6,zone.style==='royal');
  d.gallery(x+4,z+4,X-4,Z-4,24,32);
  const step=Math.floor((X-x-36)/3/2)*2;
  for(const xx of centeredStarts(x+8,X-8,20,step))d.room(xx,24,z+8,20,20,16,{royal:zone.style==='royal',kind:zone.id==='E36'?'home':'library'});
  d.floor(x+6,Z-40,x+16,Z-24,24);d.stairs(x+8,0,Z-8,6,24);
 }
 // Pair both stair flights, galleries and subsidiary rooms before the deliberate
 // single-sided entrances to the ring are cut.
 balanceRooms(d,p.zones.filter(z=>/^E3[0-8]$/.test(z.id)));
 for(const zone of p.zones.filter(z=>/^E3[0-8]$/.test(z.id))){
  const [[x,,z],[X,,Z]]=zone.bounds;d.group=zone.id;
  if(Number(zone.id.slice(1))<=35){const sx=x<0?-480:480,ex=x<0?X-8:x+8,cz=(z+Z)/2;for(const y of [0,24])d.path([[sx,y,cz],[ex,y,cz]],12);}
  else {const cx=Math.floor((x+X)/2);for(const y of [0,24])d.path([[cx,y,-1200],[cx,y,Z-8]],12);}
 }
 d.group='E39';
 for(const y of [0,24]){
  for(const x of [-480,480])d.path([[x,y,-288],[x,y,-1248]],14);
  for(const z of [-384,-816,-1200])d.path([[-480,y,z],[480,y,z]],14);
 }
 // Main floor ties the expanded residential and workshop routes into the ring.
 d.path([[-480,0,-288],[-168,0,-288],[-168,0,-293]],12);
 d.path([[480,0,-288],[168,0,-288],[168,0,-317]],12);
 const routes=d.routes.slice(first);
 for(const r of routes){d.group=r.group;d.path(r.points,r.width,{roof:true,light:false,finalOnly:true});}
 d.features.push('Neun zusätzliche Hallen mit 36 Nebenräumen und neun Treppen','Zwei seitliche Gangachsen mit drei Querspangen auf Laufhöhe Y88 und Y112');
 return routes;
}
