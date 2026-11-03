import {createHash} from 'node:crypto';
import {exportMountainTile} from './project-stone.js';
import {regionMtime} from './region.js';
import {zipStore} from './zip.js';
import {nearestStoneCannon,stoneFileName} from '../public/assets/stone-placement.js';

export function exportStoneBatch(worldDir,project,tiles,cannonId,part) {
  const capturedFrom=new Date().toISOString(), files=[], skipped=[], entries=[], stamps=new Map();
  const station=project.plan.cannonLayout.stations.find(s=>s.id===cannonId);
  for(const tile of tiles) {
    const cannon=nearestStoneCannon(project.plan,tile.origin);
    if(cannon?.id!==cannonId)throw Error('Abschnitt und Kanonenstandort passen nicht zusammen.');
    let out;
    try { out=exportMountainTile(worldDir,project.plan,tile); }
    catch(e) { if(/nicht gespeicherten Chunks/.test(e.message)){skipped.push({id:tile.id,origin:tile.origin,reason:'unknown',message:e.message});continue;}throw e; }
    for(const region of out.stats.sourceRegions) {
      const key=region.region.join(',');
      if(stamps.has(key)&&stamps.get(key).savedAt!==region.savedAt)throw Error('Welt wurde während des Paketexports gespeichert. Download erneut anfordern.');
      stamps.set(key,region);
    }
    if(!out.stats.blocks){skipped.push({id:tile.id,origin:tile.origin,reason:'empty',message:'Keine zu füllende Luft oder Wasserzelle außerhalb der Schutzbereiche.'});continue;}
    const name=stoneFileName(project.id,project.version,tile,project.plan), data=Buffer.from(out.bytes);
    entries.push({name,data});
    files.push({fileName:name,tile:tile.id,origin:tile.origin,size:tile.size,cannon:cannon.id,cannonPosition:cannon.position,distance:cannon.distance,blocks:out.stats.blocks,water:out.stats.water,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
  }
  for(const r of stamps.values()){const stamp=regionMtime(worldDir,...r.region),now=stamp?new Date(stamp).toISOString():null;if(now!==r.savedAt)throw Error('Welt wurde während des Paketexports gespeichert. Download erneut anfordern.');}
  const report={project:project.id,version:project.version,cannon:cannonId,cannonPosition:station.position,part,capturedFrom,capturedTo:new Date().toISOString(),material:'minecraft:stone',blocks:files.reduce((n,f)=>n+f.blocks,0),files,skipped,sourceRegions:[...stamps.values()],settings:{replaceMode:0,replaceBlockEntities:false,rotation:'NONE',mirror:'NONE'}};
  const csv='Datei;Anker_X;Anker_Y;Anker_Z;Kanone;Kanone_X;Kanone_Y;Kanone_Z;Abstand;Cleanstone;Wasserzellen\r\n'+files.map(f=>[f.fileName,...f.origin,f.cannon,...f.cannonPosition,f.distance.toFixed(3),f.blocks,f.water].join(';')).join('\r\n');
  const readme=[`Erebor · Cleanstone · ${cannonId} · Paket ${String(part).padStart(2,'0')} · V${project.version}`,'',`Kanonenblock: X ${station.position[0]} / Y ${station.position[1]} / Z ${station.position[2]}`,`Fundament: Y ${station.position[1]-1}`,`Bauplatz: ${station.setup||'Arbeitsplatz vorbereiten.'}`,'',`${files.length} NBT-Dateien, ${report.blocks.toLocaleString('de-DE')} Cleanstone (minecraft:stone).`,'Kein Smooth Stone und kein Cobblestone. Materialzahl gilt für diese gespeicherte Weltaufnahme.','', '1. Kanone und angrenzende Kiste am genannten Standort aufstellen. Arbeitsraum und Zugang vorbereiten.', '2. Welt speichern lassen; bei späteren Änderungen Paket frisch auf dem Campus herunterladen.', '3. NBT-Dateien in den schematics-Ordner der aktiven ATM10-Instanz kopieren und am Schematic Table laden.', '4. Pro Datei ihren eigenen Bauplan-Anker aus KOORDINATEN.csv einstellen. Nicht die Kanonenposition eintragen.', '5. Drehung NONE / 0°, Spiegelung NONE. Kanone: Don’t Replace Solid Blocks (Modus 0); Replace Block Entities AUS.', '6. Dateien in Reihenfolge der CSV bauen: untere Schichten zuerst. Kanonen- und Zielchunks geladen halten.', '', 'Es werden ausschließlich gespeicherte Luft- und Wasserzellen gefüllt. Feste Blöcke und Schutzräume bleiben ausgespart.', 'Keine Luft-/Abrissblöcke. Frische Exporte berücksichtigen bekannte Block-Entities mit vier Blöcken Puffer; Zugang selbst freihalten.', 'Unbekannte Chunks werden nicht als Luft angenommen. Ausgelassene Abschnitte stehen in MANIFEST.json.', 'Die Kanone wird durch diesen Download nicht gestartet und nichts in Minecraft platziert.', '',`Ausgelassen: ${skipped.filter(s=>s.reason==='empty').length} bereits gefüllte/geschützte Abschnitte, ${skipped.filter(s=>s.reason==='unknown').length} mit unbekannten Chunks.`].join('\r\n');
  entries.push({name:'KOORDINATEN.csv',data:Buffer.from('\ufeff'+csv)},{name:'ANLEITUNG.txt',data:Buffer.from('\ufeff'+readme)},{name:'MANIFEST.json',data:Buffer.from(JSON.stringify(report,null,2))});
  return {bytes:zipStore(entries),report};
}
