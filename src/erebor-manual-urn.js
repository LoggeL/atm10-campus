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
