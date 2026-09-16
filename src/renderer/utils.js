// Shared helpers: formatting, small UI primitives (toast/dialogs/progress).

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function toast(message, type = 'info', timeout = 3600) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast-error' : ''}${type === 'success' ? ' toast-success' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

export function openModal(contentEl) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.appendChild(contentEl);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  return backdrop;
}

export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <p style="margin-top:8px;">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-act="cancel">${escapeHtml(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-accent'}" data-act="ok">${escapeHtml(confirmText)}</button>
      </div>
    `;
    const backdrop = openModal(wrap);
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    wrap.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    wrap.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
  });
}

export function promptDialog({ title, message = '', initialValue = '', confirmText = 'OK' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      ${message ? `<p style="margin-top:6px;">${escapeHtml(message)}</p>` : ''}
      <input type="text" class="text-input" style="width:100%;margin-top:12px;" value="${escapeHtml(initialValue)}" />
      <div class="modal-actions">
        <button class="btn btn-secondary" data-act="cancel">Cancelar</button>
        <button class="btn btn-accent" data-act="ok">${escapeHtml(confirmText)}</button>
      </div>
    `;
    const backdrop = openModal(wrap);
    const input = wrap.querySelector('input');
    input.focus();
    input.select();
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    wrap.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    wrap.querySelector('[data-act="ok"]').addEventListener('click', () => close(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim());
      if (e.key === 'Escape') close(null);
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
  });
}

export function showProgressModal({ title }) {
  const wrap = document.createElement('div');
  wrap.style.minWidth = '360px';
  wrap.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <div class="progress-track"><div class="progress-fill"></div></div>
    <div class="progress-label">0%</div>
  `;
  const backdrop = openModal(wrap);
  const fill = wrap.querySelector('.progress-fill');
  const label = wrap.querySelector('.progress-label');
  return {
    update(percent, text) {
      fill.style.width = `${clamp(percent, 0, 100)}%`;
      label.textContent = text || `${Math.round(percent)}%`;
    },
    close() {
      backdrop.remove();
    }
  };
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

export function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm'
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

// Converts a filesystem path (Windows or POSIX) coming from the main
// process into a `file://` URL usable as a <video>/<img> src.
export function toFileUrl(p) {
  let pathName = String(p).replace(/\\/g, '/');
  if (!pathName.startsWith('/')) pathName = '/' + pathName;
  return encodeURI('file://' + pathName);
}

// Generic pointer-drag helper: calls onMove(event) for each pointer move
// after a pointerdown, until pointerup. Used by trim handles, overlay
// drag/resize, and the zoom target marker.
export function startPointerDrag(downEvent, onMove, onEnd) {
  downEvent.preventDefault();
  downEvent.stopPropagation();
  const move = (e) => onMove(e);
  const up = (e) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (onEnd) onEnd(e);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
