import { readFileSync } from 'node:fs';

export const ASSET_VERSION = '20261125-overhaul-1';

const header = readFileSync(new URL('../public/campus-header.html', import.meta.url), 'utf8');
const faviconTag =
  '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'><rect width=\'16\' height=\'16\' rx=\'4\' fill=\'%230c1311\'/><rect x=\'2.5\' y=\'2.5\' width=\'11\' height=\'11\' rx=\'2.5\' fill=\'%237ee0a8\'/><rect x=\'5.5\' y=\'5.5\' width=\'5\' height=\'5\' rx=\'1\' fill=\'%23091d14\'/></svg>">';
const themeColorTag = '<meta name="theme-color" content="#0c1311">';
const tokensLink = `<link rel="stylesheet" href="/assets/campus-tokens.css?v=${ASSET_VERSION}">`;
const navAssets =
  `<link rel="stylesheet" href="/assets/campus-nav.css?v=${ASSET_VERSION}">` +
  `<script type="module" src="/assets/campus-nav.js?v=${ASSET_VERSION}"></script>`;

const STYLESHEET_LINK_RE = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/i;
const ICON_LINK_RE = /<link\b[^>]*rel=["']icon["'][^>]*>/i;
const THEME_COLOR_RE = /<meta\b[^>]*name=["']theme-color["'][^>]*>/i;

export function campusPage(content, actor, section) {
  const session = actor?.via === 'session';
  let navigation = header;
  if (section) {
    navigation = navigation.replace(
      'data-section="' + section + '"',
      'data-section="' + section + '" aria-current="page"',
    );
  }
  navigation = navigation
    .replace(
      '<!-- campus-admin -->',
      session && actor.user.role === 'admin' ? '<a href="/app#admin" data-tab="admin">Verwaltung</a>' : '',
    )
    .replace(
      '<!-- campus-session -->',
      session ? '<button type="button" data-logout>Abmelden</button>' : '<a href="/login">Anmelden</a>',
    );

  let html = content;
  const headPrefix =
    (THEME_COLOR_RE.test(html) ? '' : themeColorTag) +
    (ICON_LINK_RE.test(html) ? '' : faviconTag) +
    (html.includes('campus-tokens.css') ? '' : tokensLink);

  if (headPrefix) {
    if (STYLESHEET_LINK_RE.test(html)) {
      html = html.replace(STYLESHEET_LINK_RE, (match) => headPrefix + match);
    } else {
      html = html.replace('</head>', headPrefix + '</head>');
    }
  }

  return html.replace('</head>', navAssets + '</head>').replace('<!-- campus-navigation -->', navigation);
}
