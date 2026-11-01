'use strict';
const search = document.getElementById('materialSearch');
const rows = [...document.querySelectorAll('tr[data-material]')];
search.addEventListener('input', () => {
  const q = search.value.trim().toLocaleLowerCase('de-DE');
  let shown = 0;
  for (const row of rows) {
    const match = row.querySelector('.material-label').textContent.toLocaleLowerCase('de-DE').includes(q);
    row.classList.toggle('hide', !match);
    if (match) shown++;
  }
  document.getElementById('materialEmpty').classList.toggle('hide', !rows.length || shown > 0);
});
document.addEventListener('click', e => document.querySelectorAll('.menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.menu[open]').forEach(d => { d.open = false; d.querySelector('summary').focus(); }); });
