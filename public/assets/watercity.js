import {renderWatercity} from './watercity-view.js?v=20261125-overhaul-1&revision=20261126-area-1';

// Shared home mounts the existing read-only fleet, without changing its API/data.
export function mountWatercity({fleet,status,button,initial=null}) {
 let data=initial,failed=false,busy=false,lastHTML='',stopped=false;
 function render(){
  if(!data||stopped)return;
  const open=new Set([...fleet.querySelectorAll('details[open]')].map(e=>e.dataset.preserve));
  const html=renderWatercity(data,{failed});
  if(html===lastHTML)return;
  fleet.innerHTML=html;lastHTML=html;
  for(const detail of fleet.querySelectorAll('details'))detail.open=open.has(detail.dataset.preserve);
 }
 async function refresh(){
  if(busy||stopped)return;busy=true;
  try{
   const response=await fetch('/api/projects/erebor/wasserstadt',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error(response.status===401||response.status===403?'Anmeldung erforderlich.':'Statusabruf fehlgeschlagen.');
   const result=await response.json();
   if(!Array.isArray(result.slots)||!Array.isArray(result.groups))throw Error('Ungültiger Statusbericht.');
   if(stopped)return;
   data=result;failed=false;
   status.textContent='Automatische Aktualisierung alle 10 Sekunden · native Messzeit steht an jeder Kanone. Keine Ablaufverlängerung.';
  }catch(error){
   if(stopped)return;
   failed=true;status.textContent=error.message+' Aktueller Zustand unbekannt; vorhandene Zähler sind nur letzte Beobachtungen.';
  }finally{busy=false;render();}
 }
 button?.addEventListener('click',refresh);
 const polling=setInterval(refresh,10000),expiry=setInterval(render,1000);
 render();void refresh();
 return ()=>{stopped=true;clearInterval(polling);clearInterval(expiry);button?.removeEventListener('click',refresh);};
}
// Retain compatibility for a cached old page; new routes all use projects.html.
const fleet=globalThis.document?.querySelector('#wc-fleet');
if(fleet&&!document.body.classList.contains('projects-page'))mountWatercity({fleet,status:document.querySelector('#wc-status'),button:document.querySelector('#wc-refresh')});
