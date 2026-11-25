// Shared by every Campus page module; keep this free of DOM access so Node tests can import it.
const numberFormat = new Intl.NumberFormat('de-DE');
const berlinDateTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  dateStyle: 'short',
  timeStyle: 'short',
});
const berlinTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmt = (n) => (n == null ? '–' : numberFormat.format(Number(n)));

export function fmtPercent(value, maximumFractionDigits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '–';
  return Number(value).toLocaleString('de-DE', { maximumFractionDigits }) + ' %';
}

export function formatBerlinDateTime(value) {
  if (!value) return '–';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : berlinDateTime.format(date);
}

export function formatBerlinTime(value) {
  if (!value) return '–';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : berlinTime.format(date);
}

export function formatRelativeTime(value, now = Date.now()) {
  if (value == null || value === '') return '–';
  const ts = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ts)) return '–';
  const seconds = (now - ts) / 1000;
  if (seconds < 0) return formatBerlinDateTime(ts);
  if (seconds < 90) return 'gerade eben';
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `vor ${Math.round(seconds / 3600)} h`;
  return formatBerlinDateTime(ts);
}
