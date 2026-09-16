import { mountIcons } from './icons.js';
import { initRecorder } from './recorder.js';
import { initEditor } from './editor.js';
import { initLibrary } from './library.js';
import { toast } from './utils.js';

mountIcons();
setupTitlebar();
setupTheme();

let editorApi = null;
let libraryApi = null;

editorApi = initEditor();
libraryApi = initLibrary({
  onOpenInEditor: (video) => {
    switchView('editor');
    editorApi.loadVideo(video);
  }
});
initRecorder({
  onSaved: () => {
    if (libraryApi) libraryApi.refresh();
  }
});

setupNav();

function setupTitlebar() {
  document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
  document.getElementById('btn-max').addEventListener('click', () => window.api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.close());

  const maxBtn = document.getElementById('btn-max');
  const setMaxIcon = (isMax) => maxBtn.classList.toggle('is-maximized', !!isMax);
  window.api.isMaximized().then(setMaxIcon);
  window.api.onMaximizedChanged(setMaxIcon);
}

function setupNav() {
  const items = document.querySelectorAll('.nav-item[data-view]');
  items.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
}

function switchView(name) {
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('is-active', v.id === `view-${name}`);
  });
  if (name === 'library' && libraryApi) libraryApi.refresh();
}

async function setupTheme() {
  const settings = await window.api.getSettings();
  applyTheme(settings.theme || 'light');
  document.getElementById('btn-theme').addEventListener('click', async () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await window.api.setSettings({ theme: next });
  });
}

function applyTheme(theme) {
  const resolved =
    theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Ocorreu um erro inesperado. Veja o console para detalhes.', 'error');
});
