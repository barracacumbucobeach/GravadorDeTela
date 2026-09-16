import { mountIcons } from './icons.js';
import {
  formatTime,
  formatBytes,
  formatDate,
  toast,
  confirmDialog,
  openModal,
  toFileUrl,
  debounce,
  escapeHtml
} from './utils.js';

const els = {
  grid: document.getElementById('library-grid'),
  empty: document.getElementById('library-empty'),
  search: document.getElementById('library-search'),
  openFolder: document.getElementById('btn-open-folder')
};

let allRecords = [];
let onOpenInEditorCb = null;

export function initLibrary({ onOpenInEditor }) {
  onOpenInEditorCb = onOpenInEditor;

  els.search.addEventListener(
    'input',
    debounce(() => renderGrid(els.search.value.trim().toLowerCase()), 120)
  );
  els.openFolder.addEventListener('click', () => window.api.openRecordingsDir());

  refresh();
  return { refresh };
}

async function refresh() {
  try {
    allRecords = await window.api.listRecordings();
  } catch (err) {
    console.error(err);
    toast('Não foi possível carregar as gravações.', 'error');
    allRecords = [];
  }
  renderGrid(els.search.value.trim().toLowerCase());
}

function renderGrid(filter) {
  const records = filter ? allRecords.filter((r) => r.name.toLowerCase().includes(filter)) : allRecords;

  els.empty.hidden = allRecords.length > 0;
  els.grid.innerHTML = '';

  records.forEach((record) => {
    els.grid.appendChild(buildCard(record));
  });

  mountIcons(els.grid);
}

function buildCard(record) {
  const card = document.createElement('div');
  card.className = 'rec-card';

  const thumb = document.createElement('div');
  thumb.className = 'rec-thumb';
  if (record.thumbnail) {
    thumb.style.backgroundImage = `url("${toFileUrl(record.thumbnail)}")`;
  }
  thumb.innerHTML = `
    <div class="rec-play-overlay"><span class="icon" data-icon="play"></span></div>
    <span class="rec-duration">${formatTime(record.duration)}</span>
  `;
  thumb.addEventListener('click', () => openPreview(record));

  const body = document.createElement('div');
  body.className = 'rec-body';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'rec-name';
  nameInput.value = record.name;
  nameInput.spellcheck = false;
  nameInput.addEventListener('click', (e) => e.stopPropagation());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
    if (e.key === 'Escape') {
      nameInput.value = record.name;
      nameInput.blur();
    }
  });
  nameInput.addEventListener('blur', async () => {
    const newName = nameInput.value.trim();
    if (!newName || newName === record.name) {
      nameInput.value = record.name;
      return;
    }
    const result = await window.api.renameRecording(record.id, newName);
    if (result.success) {
      Object.assign(record, result.record);
      nameInput.value = record.name;
      toast('Gravação renomeada.', 'success');
    } else {
      nameInput.value = record.name;
      toast('Não foi possível renomear a gravação.', 'error');
    }
  });

  const meta = document.createElement('div');
  meta.className = 'rec-meta';
  meta.textContent = `${formatDate(record.createdAt)} · ${formatBytes(record.size)}${record.hasAudio ? ' · com áudio' : ' · sem áudio'}`;

  const actions = document.createElement('div');
  actions.className = 'rec-actions';
  actions.appendChild(actionButton('edit', 'Editar', () => {
    if (onOpenInEditorCb) {
      onOpenInEditorCb({ path: record.path, name: record.name, duration: record.duration });
    }
  }));
  actions.appendChild(actionButton('folder-open', 'Mostrar na pasta', () => window.api.revealRecording(record.path)));
  actions.appendChild(
    actionButton('trash', 'Excluir', async () => {
      const ok = await confirmDialog({
        title: 'Excluir gravação',
        message: `Tem certeza de que deseja excluir "${record.name}"? Essa ação não pode ser desfeita.`,
        confirmText: 'Excluir',
        danger: true
      });
      if (!ok) return;
      const success = await window.api.deleteRecording(record.id);
      if (success) {
        toast('Gravação excluída.', 'success');
        refresh();
      } else {
        toast('Não foi possível excluir a gravação.', 'error');
      }
    })
  );

  body.appendChild(nameInput);
  body.appendChild(meta);
  body.appendChild(actions);
  card.appendChild(thumb);
  card.appendChild(body);
  return card;
}

function actionButton(icon, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn-icon-round';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = `<span class="icon" data-icon="${icon}"></span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function openPreview(record) {
  const wrap = document.createElement('div');
  wrap.style.width = '720px';
  wrap.innerHTML = `
    <h2>${escapeHtml(record.name)}</h2>
    <video controls autoplay style="width:100%;border-radius:8px;margin-top:10px;background:#000;max-height:70vh;"></video>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-act="close">Fechar</button>
    </div>
  `;
  const video = wrap.querySelector('video');
  video.src = toFileUrl(record.path);
  const backdrop = openModal(wrap);
  const close = () => {
    video.pause();
    video.src = '';
    backdrop.remove();
  };
  wrap.querySelector('[data-act="close"]').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
}
