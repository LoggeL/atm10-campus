import {readFileSync} from 'node:fs';
export const k09=JSON.parse(readFileSync(new URL('./erebor-fleet/k09-groups.json',import.meta.url)));
export const groupOf=name=>k09.groups.find(g=>'erebor-'+g.name===name);
export const slotsFor=site=>site===k09.site?['A','B','C',...k09.groups.flatMap(g=>Object.keys(g.slots))]:['A','B','C'];
export function supplyGroup(all,group){
  const slots=group?Object.keys(group.slots):['A','B','C'];
  return Object.fromEntries(Object.entries(all).filter(([slot])=>slots.includes(slot)));
}
