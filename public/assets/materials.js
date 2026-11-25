'use strict';
const search = document.getElementById('materialSearch');
const empty = document.getElementById('materialEmpty');
const rows = [...document.querySelectorAll('tr[data-material]')];
if (search) {
  search.addEventListener('input', () => {
    const q = search.value.trim().toLocaleLowerCase('de-DE');
    let shown = 0;
    for (const row of rows) {
      const label = row.querySelector('.material-label');
      const match = (label ? label.textContent : row.textContent).toLocaleLowerCase('de-DE').includes(q);
      row.classList.toggle('hide', !match);
      if (match) shown++;
    }
    if (empty) empty.classList.toggle('hide', !rows.length || shown > 0);
  });
}
document.addEventListener('click', e => {
  document.querySelectorAll('.menu[open]').forEach(d => {
    if (!d.contains(e.target)) d.open = false;
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.menu[open]').forEach(d => {
      d.open = false;
      d.querySelector('summary')?.focus();
    });
  } else if (e.key === '/' && search && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select')) {
    e.preventDefault();
    search.focus();
  }
});
