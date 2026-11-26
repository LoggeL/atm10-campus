const physical={P01A:[959,192,-9279],P01B:[960,192,-9280],P01C:[961,192,-9279],P03A:[1151,191,-9279],P03B:[1152,191,-9280],P03C:[1153,191,-9279]};

export function fixture(now=Date.now()) {
 const jobs=Object.entries(physical).map(([key,position],i)=>{
  const desired={version:12,file:`campus_00000000-0000-0000-0000-00000000000${i}.nbt`,sha256:String(i+1).repeat(64),owner:'Erebor',anchor:[1088,64,-9248-i*32],rotation:'none',mirror:'none',blueprint:`EREBOR_E25_BAU_AP1040_M9200_${i}`,options:{replace_mode:2,skip_missing:false,replace_block_entities:false}};
  return {key,position,selectionId:12+i,desired,job:{desired,size:[32,32,32],blocks:4310,loaded:true,started:true,seen:(now-60000)/1000,placed:300+i,watercity:{slot:key,position,computerId:key.startsWith('P01')?92:93,batch:'batch',leaseExpires:now+120000,nativeState:'PAUSED',nativeStatus:'missingBlock',pendingCampusAdoption:true}}};
 });
 const watercity={schema:1,version:12,batch:'batch',at:now,expires:now+120000,state:'observed',jobs:jobs.map(({key,position,selectionId,desired})=>({key,position,selectionId,desired})),stations:Object.fromEntries(jobs.map((j,i)=>[j.key,{position:j.position,file:j.desired.file,owner:'Erebor',anchor:j.desired.anchor,size:j.job.size,rotation:'none',mirror:'none',deployed:true,options:[2,false,false],valid:true,state:'PAUSED',status:'missingBlock',placed:356+i,total:i<3?1040:0,fuel:42}])),groups:{P01:{authorized:true},P03:{authorized:true}},supply:{P01:{at:now,batch:'batch',computerId:92,ok:true,result:{state:'feeding',shortages:{'minecraft:bookshelf':{inME:500,missing:24}}}}}};
 return {jobs,watercity};
}
