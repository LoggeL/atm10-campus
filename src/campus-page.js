import { readFileSync } from 'node:fs';

const header = readFileSync(new URL('../public/campus-header.html', import.meta.url), 'utf8');
const navAssets =
  '<link rel="stylesheet" href="/assets/campus-nav.css?v=20261114-status-1"><script type="module" src="/assets/campus-nav.js?v=20261114-status-1"></script>';

export function campusPage(content, actor, section) {
  const session = actor?.via === 'session';
  const navigation = header
    .replace('data-section="' + section + '"', 'data-section="' + section + '" aria-current="page"')
    .replace(
      '<!-- campus-admin -->',
      session && actor.user.role === 'admin' ? '<a href="/app#admin" data-tab="admin">Verwaltung</a>' : '',
    )
    .replace(
      '<!-- campus-session -->',
      session ? '<button type="button" data-logout>Abmelden</button>' : '<a href="/login">Anmelden</a>',
    );
  return content.replace('</head>', navAssets + '</head>').replace('<!-- campus-navigation -->', navigation);
}
