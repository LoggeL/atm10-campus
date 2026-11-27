const button=document.querySelector('#publish'),result=document.querySelector('#result');
async function request(body){
  const res=await fetch('/api/projects/erebor/architecture/prepare',{method:'POST',headers:{'content-type':'application/json','x-campus-csrf':'1'},body:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok)throw Error(data.message||data.error||('HTTP '+res.status));
  return data;
}
button.addEventListener('click',async()=>{
  button.disabled=true;
  const messages=[];
  for(const [site,id] of [['K10','E38_903'],['K15 → K22','E36_903']]){
    try{
      result.textContent=[...messages,site+' wird geprüft …'].join(' · ');
      const body={baseVersion:12,package:id};
      const check=await request({...body,dryRun:true});
      if(check.unchanged){messages.push(site+' bereits veröffentlicht');continue;}
      if(!check.preview)throw Error('Vorschau fehlt');
      const saved=await request({...body,dryRun:false,preview:check.preview});
      if(!saved.saved&&!saved.unchanged)throw Error('Keine Bestätigung');
      messages.push(site+' veröffentlicht');
    }catch(e){messages.push(site+' – '+e.message);}
  }
  result.textContent=messages.join(' · ');
  button.disabled=false;
});
