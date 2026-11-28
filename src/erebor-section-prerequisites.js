// Aushub/interior precede the shell in the same physical X/Z section only.
// Unpublished manifests remain blockers; no global project-phase barrier.
export function sectionPredecessors(surface,open,missing){
 const overlap=e=>e.origin[0]<surface.origin[0]+32&&e.origin[0]+e.size[0]>surface.origin[0]&&
  e.origin[2]<surface.origin[2]+32&&e.origin[2]+e.size[2]>surface.origin[2];
 return [...new Set([...open.filter(e=>['clear','build'].includes(e.stage)&&overlap(e)).map(e=>e.name),
  ...missing.filter(p=>p.tiles.some(overlap)).map(p=>p.id)])];
}
