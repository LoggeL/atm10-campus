import {readFileSync} from 'node:fs';
export const k09=JSON.parse(readFileSync(new URL('./erebor-fleet/k09-groups.json',import.meta.url)));
const expansion=JSON.parse(readFileSync(new URL('./erebor-fleet/expansion-groups.json',import.meta.url)));
if(expansion.version!==k09.version)throw Error('Unterschiedliche Versionen der Erebor-Standortpläne.');
export const groupSites=new Map([k09,...expansion.sites].map(row=>[row.site,row.groups]));
const byName=new Map([...groupSites.values()].flat().map(group=>['erebor-'+group.name,group]));
export const groupOf=name=>byName.get(name);
export const slotsFor=site=>['A','B','C',...(groupSites.get(site)??[]).flatMap(group=>Object.keys(group.slots))];
export function supplyGroup(all,group){
  const slots=group?Object.keys(group.slots):['A','B','C'];
  return Object.fromEntries(Object.entries(all).filter(([slot])=>slots.includes(slot)));
}
