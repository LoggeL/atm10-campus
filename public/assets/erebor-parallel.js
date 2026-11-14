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
  for(const c of diagnostics){const slot=document.querySelector('[data-site-fault="'+c.name+'"]');if(slot)slot.innerHTML=renderConnectionIssues(c);}
 }catch{
  banner.innerHTML='<p class="notice error" role="status">Verbindung zur Status-API unterbrochen. Angezeigte Stationsdaten sind nicht live; Stromzustand unbekannt.</p>';
  for(const c of diagnostics){if(c.network)c.network.stale=true;const slot=document.querySelector('[data-site-fault="'+c.name+'"]');if(slot)slot.innerHTML=renderConnectionIssues(c);}
 }
}
setInterval(refreshDiagnostics,15000);
refreshDiagnostics();
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
