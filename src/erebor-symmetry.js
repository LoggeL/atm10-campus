// Cuboids use half-open bounds: a cell x reflects to lo + hi - 1 - x.
export const SYMMETRIC_ROOMS=new Set(['E05','E06','E07','E08','E09','E10','E11','E12','E13','E16','E17','E18','E19','E21A','E21B',...Array.from({length:9},(_,i)=>'E'+(30+i))]);

export function reflectState(state){
 const props={...state.props};
 if(props.facing==='east')props.facing='west';else if(props.facing==='west')props.facing='east';
 if(props.shape?.endsWith('_left'))props.shape=props.shape.replace('_left','_right');else if(props.shape?.endsWith('_right'))props.shape=props.shape.replace('_right','_left');
 if(props.hinge==='left')props.hinge='right';else if(props.hinge==='right')props.hinge='left';
 return {name:state.name,props};
}

export function centeredStarts(lo,hi,width,step){
 const count=Math.floor((hi-lo-width)/step)+1;
 if(count<1)return [];
 const start=lo+(hi-lo-((count-1)*step+width))/2;
 if(!Number.isInteger(start)){
  const left=Array.from({length:Math.ceil(count/2)},(_,i)=>Math.floor(start)+i*step);
  return [...new Set([...left,...left.map(x=>lo+hi-width-x)])].sort((a,b)=>a-b);
 }
 return Array.from({length:count},(_,i)=>start+i*step);
}

// Architectural wings share one canonical half; doors to the unequal neighbouring
// functions are cut afterwards. Do not mirror skins, terrain, mines or machinery.
export function balanceRooms(d,zones){
 const axes=new Map(zones.filter(z=>SYMMETRIC_ROOMS.has(z.id)).map(z=>[z.id,z.bounds[0][0]+z.bounds[1][0]]));
 const remap=d.palette.map((s,i)=>i===0?0:d.state(reflectState(s))),out=[];
 for(const o of d.ops){
  const sum=axes.get(o.g);if(sum===undefined){out.push(o);continue;}
  const end=Math.min(o.b[0],sum/2);if(o.a[0]>=end)continue;
  const a=[...o.a],b=[...o.b];b[0]=end;
  out.push({...o,a,b,role:'symmetric-room'});
  out.push({...o,a:[sum-b[0],a[1],a[2]],b:[sum-a[0],b[1],b[2]],s:remap[o.s],role:'symmetric-room'});
 }
 d.ops=out;
 if(d.stairChecks){const checks=[];for(const c of d.stairChecks){const sum=axes.get(c.g);if(sum===undefined){checks.push(c);continue;}const end=Math.min(c.b[0],sum/2);if(c.a[0]>=end)continue;const a=[...c.a],b=[...c.b];b[0]=end;checks.push({...c,a,b},{...c,a:[sum-b[0],a[1],a[2]],b:[sum-a[0],b[1],b[2]],s:remap[c.s]});}d.stairChecks=checks;}
}

// A bounded, exhaustive voxel comparison, including air and stair orientation.
// Called on the architectural room before functional connecting routes are cut.
export function auditRoomSymmetry(d,zone){
 const [a,b]=zone.bounds,size=b.map((v,i)=>v-a[i]),[w,h,l]=size;
 const data=new Int16Array(w*h*l);data.fill(-1);
 for(const o of d.ops.filter(o=>o.g===zone.id)){
  const lo=o.a.map((v,i)=>Math.max(v,a[i])-a[i]),hi=o.b.map((v,i)=>Math.min(v,b[i])-a[i]);
  if(lo.some((v,i)=>v>=hi[i]))continue;
  for(let y=lo[1];y<hi[1];y++)for(let z=lo[2];z<hi[2];z++)data.fill(o.s,(y*l+z)*w+lo[0],(y*l+z)*w+hi[0]);
 }
 const key=s=>s.name+JSON.stringify(Object.entries(s.props||{}).sort()),states=d.palette.map(key),mirror=d.palette.map(s=>key(reflectState(s)));
 let mismatches=0,pairs=0,occupied=0,example=null;
 for(let y=0;y<h;y++)for(let z=0;z<l;z++)for(let x=0;x<w/2;x++){
  const left=data[(y*l+z)*w+x],right=data[(y*l+z)*w+w-1-x];pairs++;occupied+=(left>0?1:0)+(right>0?1:0);
  if(left<0?right>=0:right<0||mirror[left]!==states[right]){mismatches++;example||=[a[0]+x,a[1]+y,a[2]+z];}
 }
 return {id:zone.id,title:zone.title,axis:(a[0]+b[0])/2,pairs,occupied,mismatches,example};
}
