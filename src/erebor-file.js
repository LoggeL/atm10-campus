import {createHash} from 'node:crypto';

// Stable Create upload identity for one published file and content revision.
export function ereborUploadName(fileName,sha256){
 const bytes=createHash('sha256').update(fileName+'\n'+sha256).digest();
 bytes[6]=(bytes[6]&15)|128;
 bytes[8]=(bytes[8]&63)|128;
 const h=bytes.subarray(0,16).toString('hex');
 return 'campus_'+[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-')+'.nbt';
}
