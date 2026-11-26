import {esc} from './format.js?v=20261125-overhaul-1';

// All project/area homes use these components and projects.css. No data is assumed.
export const projectSection = (id,title,body,card=false) => `<section id="${esc(id)}" class="project-section${card?' project-section-card':''}"><h2>${esc(title)}</h2>${body}</section>`;
export const projectNav = items => `<nav class="project-nav" aria-label="Projektbereiche">${items.map(([id,title])=>`<a href="#${esc(id)}">${esc(title)}</a>`).join('')}</nav>`;
export function projectHero({status,title,summary,actions='',metrics=[]}) {
 return `<header class="project-hero"><div class="project-hero-head"><div class="project-hero-copy"><p class="project-status">${esc(status)}</p><h1>${esc(title)}</h1><p class="project-hero-summary">${esc(summary)}</p></div><div class="project-hero-actions">${actions}</div></div><div class="project-metrics">${metrics.map(([value,label])=>`<div class="project-metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('')}</div></header>`;
}
