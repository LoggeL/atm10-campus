import {renderWatercity} from './watercity-view.js?v=20261125-overhaul-1&revision=20261126-watercity-1';
const fleet=document.querySelector('#wc-fleet'),status=document.querySelector('#wc-status'),button=document.querySelector('#wc-refresh');
let data=null,failed=false,busy=false,lastHTML='';
function render(){
 if(!data)return;
 const open=new Set([...fleet.querySelectorAll('details[open]')].map(e=>e.dataset.preserve));
 const html=renderWatercity(data,{failed});
 if(html===lastHTML)return;
 fleet.innerHTML=html;lastHTML=html;
 for(const detail of fleet.querySelectorAll('details'))detail.open=open.has(detail.dataset.preserve);
}
async function refresh(){
 if(busy)return;busy=true;button.disabled=true;
 try{
  const response=await fetch('/api/projects/erebor/wasserstadt',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error(response.status===401||response.status===403?'Anmeldung erforderlich.':'Statusabruf fehlgeschlagen.');
  const result=await response.json();
  if(!Array.isArray(result.slots)||!Array.isArray(result.groups))throw Error('Ungültiger Statusbericht.');
  data=result;failed=false;
  status.textContent='Automatische Aktualisierung alle 10 Sekunden · native Messzeit steht an jeder Kanone. Keine Ablaufverlängerung.';
 }catch(error){
  failed=true;status.textContent=error.message+' Aktueller Zustand unbekannt; vorhandene Zähler sind nur letzte Beobachtungen.';
 }finally{busy=false;button.disabled=false;render();}
}
button.addEventListener('click',refresh);
setInterval(refresh,10000);
setInterval(render,1000); // Expire native freshness/permission even with no HTTP response.
refresh();
