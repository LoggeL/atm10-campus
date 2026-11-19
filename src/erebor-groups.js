import {readFileSync} from 'node:fs';
export const k09=JSON.parse(readFileSync(new URL('./erebor-fleet/k09-groups.json',import.meta.url)));
const expansion=JSON.parse(readFileSync(new URL('./erebor-fleet/expansion-groups.json',import.meta.url)));
export const finishingGroups=JSON.parse(readFileSync(new URL('./erebor-fleet/finishing-groups.json',import.meta.url)));
const finishingSlots=new Set(finishingGroups.sites.flatMap(row=>row.groups.flatMap(group=>Object.keys(group.slots).map(slot=>row.site+slot))));
export const isFinishingSlot=(site,slot)=>finishingSlots.has(site+slot);
if(expansion.version!==k09.version)throw Error('Unterschiedliche Versionen der Erebor-Standortpläne.');
export const groupSites=new Map([k09,...expansion.sites].map(row=>[row.site,row.groups]));
const byName=new Map([...groupSites.values()].flat().map(group=>['erebor-'+group.name,group]));
if(finishingGroups.version!==k09.version)throw Error('Abweichende Version der Ausbauplanung');
for(const row of finishingGroups.sites){
 const existing=groupSites.get(row.site)??[];
 for(const g of row.groups){
  if(byName.has('erebor-'+g.name)||existing.some(h=>Object.keys(h.slots).some(s=>Object.hasOwn(g.slots,s))))throw Error('Doppelte Kanonengruppe '+g.name);
  byName.set('erebor-'+g.name,g);existing.push(g);
 }
 groupSites.set(row.site,existing);
}
export const groupCount=byName.size;
export const groupOf=name=>byName.get(name);
export const slotsFor=site=>['A','B','C',...(groupSites.get(site)??[]).flatMap(group=>Object.keys(group.slots))];
export function supplyGroup(all,group){
  const slots=group?Object.keys(group.slots):['A','B','C'];
  return Object.fromEntries(Object.entries(all).filter(([slot])=>slots.includes(slot)));
}
