import {renderFleetIssues,renderConnectionIssues} from './connection-status.js?v=20261114-status-1';
let diagnostics=[];
async function refreshDiagnostics(){
 const banner=document.querySelector('[data-fleet-faults]');
 if(!banner)return;
 try{
  const r=await fetch(location.pathname+'?format=json',{cache:'no-store'});
  if(!r.ok)throw Error('status_unavailable');
  const d=await r.json();diagnostics=d.diagnostics||[];
  banner.innerHTML=renderFleetIssues(diagnostics);
  const latest=Math.max(0,...(d.resume||[]).map(r=>r.expires));
  const batch=(d.resume||[]).filter(r=>r.expires===latest);
  if(batch.length){
    const results=new Map();
    for(const row of batch){
      const label=row.result||(Date.now()>=row.expires?'Zeitfenster abgelaufen':'Wartet auf Freigabe der Kanone');
      results.set(label,(results.get(label)||0)+1);
    }
    document.getElementById('resume-result').textContent=[...results].map(([label,count])=>count+' × '+label).join(' · ');
  }
  for(const c of diagnostics){const slot=document.querySelector('[data-site-fault="'+c.name+'"]');if(slot)slot.innerHTML=renderConnectionIssues(c);}
 }catch{
  banner.innerHTML='<p class="notice error" role="status">Verbindung zur Status-API unterbrochen. Angezeigte Stationsdaten sind nicht live; Stromzustand unbekannt.</p>';
  for(const c of diagnostics){if(c.network)c.network.stale=true;const slot=document.querySelector('[data-site-fault="'+c.name+'"]');if(slot)slot.innerHTML=renderConnectionIssues(c);}
 }
}
setInterval(refreshDiagnostics,15000);
refreshDiagnostics();
const resumeButton=document.getElementById('resume-paused');
resumeButton?.addEventListener('click',async()=>{
  const output=document.getElementById('resume-result');
  resumeButton.disabled=true;
  try{
    const response=await fetch('/api/projects/erebor/planfolge/fortsetzen',{
      method:'POST',headers:{'content-type':'application/json','x-campus-csrf':'1'},
      body:JSON.stringify({version:Number(resumeButton.dataset.version)})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Sammelstart fehlgeschlagen.');
    output.textContent=result.queued.length?result.queued.length+' pausierte Kanonen zum Fortsetzen vorgemerkt.':'Keine passenden pausierten Kanonen in der aktuellen Weltmeldung.';
  }catch(error){output.textContent=error.message;}
  finally{resumeButton.disabled=false;}
});
const supplyButton=document.getElementById('set-supply');
supplyButton?.addEventListener('click',async()=>{
  supplyButton.disabled=true;
  const output=document.getElementById('supply-result');
  try{
    const response=await fetch('/api/projects/erebor/cannon-sites/materialpuffer',{method:'POST',headers:{'x-campus-csrf':'1'}});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Speichern fehlgeschlagen.');
    output.textContent=result.verified+' von '+result.total+' Standorten auf 16 Stacks und 64 Schießpulver eingestellt.';
  }catch(error){output.textContent=error.message;}
  finally{supplyButton.disabled=false;}
});
for(const button of document.querySelectorAll('button[data-enabled]'))button.addEventListener('click',async()=>{
  button.disabled=true;
  try{
    const response=await fetch('/api/projects/erebor/planfolge/dreierbetrieb',{
      method:'POST',headers:{'content-type':'application/json','x-campus-csrf':'1'},
      body:JSON.stringify({version:Number(button.dataset.version),enabled:button.dataset.enabled==='true',
        ...(button.id==='all-mains'?{allMains:true}:{})})
    });
    if(!response.ok)throw Error((await response.json()).error||'Änderung fehlgeschlagen.');
    location.reload();
  }catch(error){
    document.getElementById('result').textContent=' '+error.message;
    button.disabled=false;
  }
});
