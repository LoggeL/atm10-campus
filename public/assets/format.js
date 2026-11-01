// Shared by every Campus page module; keep this free of DOM access so Node tests can import it.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt = n => n == null ? '–' : Number(n).toLocaleString('de-DE');
