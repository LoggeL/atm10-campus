const esc=value=>String(value??'unbekannt').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('de-DE'):'unbekannt';
const stamp=at=>Number.isFinite(at)?new Date(at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})+' (Berlin)':'Zeitpunkt unbekannt';
const fresh=(o,now,failed)=>!failed&&o?.fresh===true&&Number.isFinite(o.at)&&now>=o.at&&now-o.at<45000;

function card(row,now,failed) {
 const a=row.assignment,o=row.observation;
 const expired=a&&(!Number.isFinite(a.leaseExpires)||now>=a.leaseExpires);
 const current=!expired&&!row.problem&&fresh(o,now,failed);
 const count=o?.placed;
 const total=o?.total;
 const denominator=Number.isSafeInteger(total)&&total>0&&Number.isSafeInteger(count)&&count<=total;
 const label=current?'Frisch gemessen':'Zuletzt beobachtet · aktueller Zustand unbekannt';
 return `<article id="slot-${esc(row.key)}" class="project-card wc-card" data-slot="${esc(row.key)}" data-fresh="${current}">
  <div class="row wc-card-head"><h3>${esc(row.key)}</h3><span class="c-badge c-badge--neutral">${a?'Belegt':'Unbekannt'}</span></div>
  <p class="wc-coord">Kanone ${esc(row.position?.join(' / '))} · Overworld</p>
  ${row.problem?`<p class="wc-warning">${esc(row.problem)}</p>`:''}
  ${expired?'<p class="wc-warning">Freigabe abgelaufen · keine erneuerte Betriebsfreigabe bestätigt.</p>':''}
  <p class="wc-freshness">${label}</p>
  <p class="wc-native"><strong>${esc(o?.state??'Unbekannt')}</strong> / ${esc(o?.status??'unbekannt')}</p>
  <p class="wc-counter">${num(count)} <span>platziert${denominator?' / '+num(total)+' nativ':' · native Gesamtzahl unbekannt'}</span></p>
  ${denominator?`<progress value="${count}" max="${total}" aria-label="${esc(row.key)} nativer Bauzähler"></progress>`:'<div class="wc-unknown-bar" aria-label="Kein verlässlicher nativer Nenner"></div>'}
  <p class="wc-time">Messung: ${esc(stamp(o?.at))}</p>
  ${a?`<p class="wc-plan">${esc(a.blueprint)}</p><p>Reservierung #${a.id} · Quelle ${esc(a.sourceSite)} · ${esc(a.status)} (Scheduler-Ausnahme)</p>
  <details data-preserve="${esc(row.key)}"><summary>Auftrag &amp; Betriebsgrenze</summary><dl>
  <dt>Upload</dt><dd>${esc(a.file)}</dd><dt>SHA-256</dt><dd>${esc(a.sha256)}</dd>
  <dt>Zielanker</dt><dd>${esc(a.anchor?.join(' / '))}</dd><dt>Planumfang brutto</dt><dd>${num(a.planBlocks)} Blöcke · nicht der native Fortschrittsnenner</dd>
  <dt>Echt geladen / gestartet</dt><dd>${a.loaded?'ja':'nicht bestätigt'} / ${a.started?'ja':'nicht bestätigt'} (beibehaltener Nachweis)</dd>
  <dt>Befristete Betriebsfreigabe bis</dt><dd>${esc(stamp(a.leaseExpires))}</dd>
  </dl></details>`:''}
 </article>`;
}
function supply(group,now,failed) {
 const s=group.supply;
 if(!s)return '<p class="wc-note">Kein passender aktueller CC-Materialbericht. Versorgung unbekannt.</p>';
 const current=fresh(s,now,failed);
 return `<details class="wc-supply" data-preserve="supply-${esc(group.id)}"><summary>Materialbeobachtung · ${current?'frischer CC-Bericht':'letzter CC-Bericht, jetzt unbekannt'}</summary>
  <p>Gemessen ${esc(stamp(s.at))}. Geschützte ME-Reserve: ${num(s.reserve)} je Material. Keine neue Freigabe durch diese Ansicht.</p>
  <ul>${s.shortages.map(r=>`<li><code>${esc(r.item)}</code>: ${num(r.inME)} im gemeinsamen ME; ${num(r.missing)} noch im Lieferbudget.</li>`).join('')}</ul>
  <p>Lieferbudget ist nicht die exakt unverbaute Weltmenge. Gemeinsame ME-Beobachtungen nicht addieren.</p></details>`;
}
export function renderWatercity(data,{now=Date.now(),failed=false}={}) {
 return data.groups.map(g=>{
  if(!g.commissioned)return `<section class="project-note wc-inactive"><h2>${esc(g.id)} · Nicht in Betrieb</h2><p>Kein in Betrieb genommener Computer, keine Wasserstadt-Bauzuweisung. Aktueller Hardware-/Kopplungszustand hier nicht live gemessen; siehe Aufstellung.</p></section>`;
  const rows=data.slots.filter(s=>s.site===g.id);
  return `<section class="project-section wc-group"><div class="wc-group-head"><h2>${esc(g.id)} <span>Computer #${g.computerId}</span></h2><p>Truhe ${esc(g.chest.join(' / '))} · lokal ${esc(g.chestSide)} / Bridge ${esc(g.bridgeSide)}</p></div>
   <div class="project-cards wc-slots">${rows.map(row=>card(row,now,failed)).join('')}</div>${supply(g,now,failed)}</section>`;
 }).join('')+'<p class="wc-note">Keine automatische Folgeauftrag-Zuteilung. Reservierungen und Betrieb bleiben unverändert.</p>';
}
