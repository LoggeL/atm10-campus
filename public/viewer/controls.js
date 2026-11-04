const $ = s => document.querySelector(s);

// Shared navigation and display controls for blueprint and planning scenes.
export function installViewerControls({view,nav,home,saveHash,syncNavButtons,onEscape,filename='campus',canWalk=true,enterWalk=null}) {
  const walk = $('#nav-mode [data-mode="walk"]');
  walk.disabled = !canWalk;
  if (!canWalk) walk.title = 'Laufen benötigt einen blockgenauen Weltbestand. Für diesen Masterplan ist Fliegen verfügbar.';
  const setMode=mode=>{if(mode==='walk'&&enterWalk)enterWalk();else nav.setMode(mode);syncNavButtons();};
  $('#nav-mode').onclick = e => { const b = e.target.closest('[data-mode]'); if (b && !b.disabled) setMode(b.dataset.mode); };
  nav.on(type => { if (type === 'moved') saveHash(); });
  const tod = $('#tod');
  tod.oninput = () => {
    const h = Number(tod.value);
    view.setTimeOfDay(h);
    $('#tod-val').textContent = `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  };
  const toggle = (id, fn) => { const b = $(id); b.onclick = () => { b.classList.toggle('active'); b.setAttribute('aria-pressed', String(b.classList.contains('active'))); fn(b.classList.contains('active')); }; };
  toggle('#t-shadows', on => view.setShadows(on));
  toggle('#t-bloom', on => { view.bloomEnabled = on; });
  toggle('#t-grid', on => { view.grid.visible = on; });
  $('#reset-cam').onclick = () => { if (nav.mode !== 'orbit') { nav.setMode('orbit'); syncNavButtons(); } nav.flyTo(home().pos, home().target); };
  $('#shot').onclick = () => {
    view.render(0);
    view.canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${filename}-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };
  $('#panel-toggle').onclick = () => { const open = $('#panel').classList.toggle('open'); $('#panel-toggle').setAttribute('aria-expanded', String(open)); };
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { onEscape(); return; }
    if (e.target.closest?.('input, select, textarea, button')) return;
    const mode = {'1':'orbit','2':'fly','3':'walk'}[e.key];
    if (mode && (mode !== 'walk' || canWalk)) setMode(mode);
  });
}
