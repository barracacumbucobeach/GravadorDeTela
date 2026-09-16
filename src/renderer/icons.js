// Minimal set of hand-drawn line icons (Fluent-style) as inline SVG, so the
// app has zero runtime/network dependency on an icon font or CDN.

const S = 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"';

const PATHS = {
  'record-dot': `<circle cx="10" cy="10" r="7.5" ${S}/><circle cx="10" cy="10" r="3" fill="currentColor"/>`,
  edit: `<path d="M12.5 3.5l4 4L6 18H2v-4L12.5 3.5z" ${S}/><path d="M11 5l4 4" ${S}/>`,
  folder: `<path d="M2.5 5.5a1 1 0 0 1 1-1h4l1.6 2h7.4a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-10.5z" ${S}/>`,
  'folder-open': `<path d="M2.5 6.5a1 1 0 0 1 1-1h4l1.6 2h7.4a1 1 0 0 1 .97 1.24l-1.3 5.3a1 1 0 0 1-.97.76H4.2a1 1 0 0 1-.98-.8l-1.2-6a1 1 0 0 1 .02-.5z" ${S}/>`,
  theme: `<circle cx="10" cy="10" r="3.6" ${S}/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7" ${S}/>`,
  swap: `<path d="M3 7h11.5M14.5 7L11 3.5M14.5 7L11 10.5" ${S}/><path d="M17 13H5.5M5.5 13L9 9.5M5.5 13L9 16.5" ${S}/>`,
  screen: `<rect x="2.5" y="4" width="15" height="10" rx="1.4" ${S}/><path d="M7 17.5h6M10 14v3.5" ${S}/>`,
  window: `<rect x="3" y="3.5" width="14" height="13" rx="1.4" ${S}/><path d="M3 7h14" ${S}/>`,
  mic: `<rect x="7.5" y="2.5" width="5" height="9" rx="2.5" ${S}/><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5v3M7.5 17.5h5" ${S}/>`,
  'mic-off': `<rect x="7.5" y="2.5" width="5" height="9" rx="2.5" ${S}/><path d="M5 9.5a5 5 0 0 0 8.2 3.8M15 8.2V9.5a5 5 0 0 1-.4 2M10 14.5v3M7.5 17.5h5" ${S}/><path d="M3 3l14 14" ${S}/>`,
  speaker: `<path d="M3 8v4h3l4.5 3.5v-10.5L6 8H3z" ${S}/><path d="M14 7a4.2 4.2 0 0 1 0 6M16.3 5a7.5 7.5 0 0 1 0 10" ${S}/>`,
  'speaker-off': `<path d="M3 8v4h3l4.5 3.5v-10.5L6 8H3z" ${S}/><path d="M3 3l14 14" ${S}/>`,
  pause: `<rect x="5.5" y="4" width="3" height="12" rx="1" fill="currentColor"/><rect x="11.5" y="4" width="3" height="12" rx="1" fill="currentColor"/>`,
  stop: `<rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor"/>`,
  play: `<path d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.4-5.8a.8.8 0 0 0 0-1.4L7.2 3.5A.8.8 0 0 0 6 4.2z" fill="currentColor"/>`,
  export: `<path d="M10 12.5V3M6.5 6.5L10 3l3.5 3.5" ${S}/><path d="M3.5 12.5v3a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-3" ${S}/>`,
  cut: `<circle cx="5" cy="5" r="2.2" ${S}/><circle cx="5" cy="15" r="2.2" ${S}/><path d="M6.6 6.4L17 17M6.6 13.6L17 3" ${S}/>`,
  zoom: `<circle cx="8.5" cy="8.5" r="5.5" ${S}/><path d="M8.5 6v5M6 8.5h5" ${S}/><path d="M16.5 16.5L12.8 12.8" ${S}/>`,
  text: `<path d="M3 5.5h14M6 5.5V16M14 5.5V16M4.2 16h3.6M12.2 16h3.6" ${S}/>`,
  arrow: `<path d="M4 16L16 4M16 4H9M16 4v7" ${S}/>`,
  trash: `<path d="M4 6h12M8 6V4.3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.7 10a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" ${S}/><path d="M8.3 9v5M11.7 9v5" ${S}/>`,
  close: `<path d="M4.5 4.5l11 11M15.5 4.5l-11 11" ${S}/>`,
  check: `<path d="M3.5 10.5l4 4 9-9" ${S}/>`,
  plus: `<path d="M10 3.5v13M3.5 10h13" ${S}/>`,
  search: `<circle cx="8.7" cy="8.7" r="5.2" ${S}/><path d="M16.5 16.5l-3.6-3.6" ${S}/>`,
  'chevron-down': `<path d="M4.5 7l5.5 6 5.5-6" ${S}/>`,
  camera: `<path d="M3 6.5a1 1 0 0 1 1-1h2l1-1.5h6l1 1.5h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8z" ${S}/><circle cx="10" cy="10.3" r="3" ${S}/>`
};

export function iconMarkup(name) {
  const inner = PATHS[name];
  if (!inner) return '';
  return `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (!el.dataset.iconMounted) {
      el.innerHTML = iconMarkup(name);
      el.dataset.iconMounted = '1';
    }
  });
}
