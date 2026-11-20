import {createHash} from 'node:crypto';
import {stoneNBT} from './project-stone.js';

export const lootUrn='supplementaries:urn';
const size=[1,1,1], bytes=stoneNBT(size,[[0,0,0]]);
const sha=createHash('sha256').update(bytes).digest('hex');

// A merged or reissued plan may revisit the same urn. Use the world position,
// not the generation or donor cannon, for a stable manual download.
export function manualUrn(column,origin,oldestTargetSave=0){
 const tile=column+'_URN_'+origin.join('_')+'_BE';
 return {tile,origin,size,blocks:1,bytes,sha,oldestTargetSave};
}

// The single block may land before the controller can read back its start.
// Match Minecraft's retained input -> output transition to this exact file.
export function witnessedUrn(job,signal,at){
 const r=signal?.finish;
 return job?.massif?.includes('_URN_') && job.blocks===1 && signal.ready && signal.empty===true &&
   signal.upload==='' && signal.state==='STOPPED' && signal.status==='finished' &&
   r?.file===job.desired.file && Number.isSafeInteger(r.before) && Number.isSafeInteger(r.at) &&
   r.at>=r.before && r.at-r.before<=10000 && at>=r.at &&
   Number.isSafeInteger(r.oldCount) && r.oldCount>=0 && r.newCount===r.oldCount+1;
}
