import { esc } from './format.js?v=20261104-erebor-symmetry-3';

// Always pin the image to the displayed version, including older cannon assignments.
export function blueprintPreview(bp, {size = 'thumbnail', eager = false, source = null} = {}) {
  const version = bp?.version ?? bp?.currentVersion;
  const url=source??`/api/blueprints/${encodeURIComponent(bp?.id||'')}/preview.png?version=${version}`;
  const valid = bp?.id && Number.isSafeInteger(version) && version > 0 && /^\/api\/(projects|blueprints)\//.test(url) && !/[\\#]/.test(url);
  const variant = ['thumbnail','small','large'].includes(size) ? size : 'thumbnail';
  const label = `Vorschau: ${bp?.name || bp?.id || 'Bauplan'}, Version ${version}`;
  return `<span class="blueprint-preview ${variant}${valid ? '' : ' unavailable'}">${valid ? `<img data-blueprint-preview src="${esc(url)}" width="640" height="400" alt="${esc(label)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">` : ''}<span class="preview-placeholder">${valid ? 'Vorschau lädt …' : 'Keine Vorschau'}</span></span>`;
}

export function installPreviewFallbacks(root = document) {
  const finish = event => {
    const img = event.target;
    if (!img.matches?.('img[data-blueprint-preview]')) return;
    const frame = img.closest('.blueprint-preview'), failed = event.type === 'error';
    frame.classList.toggle('unavailable', failed);
    frame.classList.toggle('loaded', !failed);
    if (failed) frame.querySelector('.preview-placeholder').textContent = 'Vorschau nicht verfügbar';
  };
  root.addEventListener('load', finish, true);
  root.addEventListener('error', finish, true);
}
