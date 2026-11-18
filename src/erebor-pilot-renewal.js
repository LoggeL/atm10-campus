import {isDeepStrictEqual as same} from 'node:util';

// No retained jobs: each bounded publication is rebuilt from authoritative state.
// A slow/hung request cannot overlap another publication. Expiry remains 8s.
export function targetRenewal(snapshot,request){
 let running=false;
 return {async tick(){
  if(running)return {state:'busy'};
  running=true;
  try{
   const before=structuredClone(snapshot());
   if(!before)return {state:'disabled'};
   const at=Date.now(),lease={schema:1,version:before.version,phase:'stone',at,expiresAt:at+8000,jobs:before.jobs};
   const result=await request('erebor-target-leases',lease);
   if(!same(before,snapshot()))throw Error('Pilot renewal ownership changed');
   if(result?.published!==true||!same(result.lease,lease)||Date.now()>=lease.expiresAt)throw Error('Pilot renewal not confirmed');
   return {state:'renewed',expiresAt:lease.expiresAt};
  }finally{running=false;}
 }};
}
