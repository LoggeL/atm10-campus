import { api } from './campus-client.js?v=20261125-overhaul-1';

const head = document.querySelector('.campus-head');
const nav = document.querySelector('.campus-nav');
const menu = document.querySelector('.campus-more');
const toggle = document.querySelector('.campus-menu-toggle');
const mobileCurrent = document.querySelector('.campus-mobile-current');
const mobileMedia = window.matchMedia('(max-width: 860px)');

if (location.pathname === '/app' && nav) {
  for (const link of nav.querySelectorAll('[data-tab]')) {
    link.setAttribute('href', '#' + link.dataset.tab);
  }
}

function syncMobileCurrent() {
  if (!mobileCurrent || !nav) return;
  const active = nav.querySelector('a[aria-current="page"]');
  if (!active) {
    mobileCurrent.hidden = true;
    return;
  }
  const label = active.textContent.trim();
  mobileCurrent.textContent = label;
  mobileCurrent.setAttribute('href', active.getAttribute('href') || location.pathname);
  mobileCurrent.hidden = !label;
}

function setDrawerOpen(open) {
  if (!head || !toggle) return;
  const isMobile = mobileMedia.matches;
  const next = Boolean(open && isMobile);
  head.classList.toggle('is-open', next);
  document.body.classList.toggle('campus-nav-open', next);
  toggle.setAttribute('aria-expanded', String(next));
  toggle.setAttribute('aria-label', next ? 'Navigation schließen' : 'Navigation öffnen');
  if (menu) menu.open = next;
}

if (toggle) {
  toggle.addEventListener('click', () => {
    setDrawerOpen(!head?.classList.contains('is-open'));
  });
}

if (nav) {
  nav.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (link && head?.classList.contains('is-open')) {
      setDrawerOpen(false);
    }
  });

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(syncMobileCurrent);
    observer.observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'href'] });
  }
}

mobileMedia.addEventListener('change', (event) => {
  if (!event.matches) {
    setDrawerOpen(false);
  }
});

if (menu) {
  document.addEventListener('click', (event) => {
    if (mobileMedia.matches) return;
    if (!menu.contains(event.target)) menu.open = false;
  });

  menu.querySelector('[data-logout]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/api/auth/logout', { method: 'POST' });
      location.assign('/login');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Abmelden erneut versuchen';
      button.title = error.message;
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (head?.classList.contains('is-open')) {
    setDrawerOpen(false);
    toggle?.focus();
    return;
  }
  if (menu?.open && !mobileMedia.matches) {
    menu.open = false;
    menu.querySelector('summary')?.focus();
  }
});

window.addEventListener('hashchange', () => {
  if (head?.classList.contains('is-open')) setDrawerOpen(false);
  setTimeout(syncMobileCurrent, 0);
});

syncMobileCurrent();
