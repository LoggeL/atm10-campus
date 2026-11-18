import { api } from './campus-client.js?v=20261114-status-1';
const menu = document.querySelector('.campus-more');
if (location.pathname === '/app') {
  for (const link of document.querySelectorAll('.campus-nav [data-tab]'))
    link.setAttribute('href', '#' + link.dataset.tab);
}
if (menu) {
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
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
