import { mountIcons } from './icons.js';
import {
  formatTime,
  clamp,
  lerp,
  uid,
  toast,
  escapeHtml,
  showProgressModal,
  pickMimeType,
  toFileUrl,
  startPointerDrag
} from './utils.js';

const TEXT_COLORS = ['#ffffff', '#000000', '#e81123', '#0f78d4', '#107c10', '#ffd700'];
const BG_COLORS = ['rgba(0,0,0,0.55)', 'rgba(255,255,255,0.85)', 'rgba(15,120,212,0.55)', 'transparent'];
const CORNER_PRESETS = [
  [0.05, 0.05], [0.5, 0.05], [0.95, 0.05],
  [0.05, 0.5], [0.5, 0.5], [0.95, 0.5],
  [0.05, 0.95], [0.5, 0.95], [0.95, 0.95]
];

function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

const els = {
  importBtn: document.getElementById('btn-import-video'),
  importBtn2: document.getElementById('btn-import-video-2'),
  filename: document.getElementById('editor-filename'),
  exportBtn: document.getElementById('btn-export'),
  empty: document.getElementById('editor-empty'),
  stage: document.getElementById('editor-stage'),
  stageWrap: document.getElementById('stage-canvas-wrap'),
  canvas: document.getElementById('editor-canvas'),
  overlayLayer: document.getElementById('overlay-layer'),
  playBtn: document.getElementById('btn-play'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  scrubber: document.getElementById('scrubber'),
  muteBtn: document.getElementById('btn-mute'),
  toolCut: document.getElementById('tool-cut'),
  toolZoom: document.getElementById('tool-zoom'),
  toolText: document.getElementById('tool-text'),
  toolArrow: document.getElementById('tool-arrow'),
  panelContext: document.getElementById('panel-context'),
  btnMarkCut: document.getElementById('btn-mark-cut'),
  timelineDuration: document.getElementById('timeline-duration'),
  timelineTracks: document.getElementById('timeline-tracks'),
  laneVideo: document.getElementById('lane-video'),
  laneZoom: document.getElementById('lane-zoom'),
  laneOverlay: document.getElementById('lane-overlay'),
  thumbStrip: document.getElementById('thumb-strip'),
  trimStartEl: document.getElementById('trim-start'),
  trimEndEl: document.getElementById('trim-end'),
  cutsContainer: document.getElementById('cuts-container'),
  playhead: document.getElementById('playhead')
};

const video = document.getElementById('editor-video');
const ctx = els.canvas.getContext('2d', { alpha: false });

const thumbVideo = document.createElement('video');
thumbVideo.muted = true;
thumbVideo.preload = 'auto';

const state = {
  meta: null,
  duration: 0,
  trimStart: 0,
  trimEnd: 0,
  cuts: [],
  zooms: [],
  texts: [],
  arrows: [],
  selected: null,
  playing: false,
  muted: false,
  cutMarking: false,
  cutMarkStart: 0
};

const overlayDomMap = new Map();
let zoomMarkerEl = null;
let rafId = null;

export function initEditor() {
  wireToolbar();
  wireTransport();
  wireTools();
  wireTimelineInteractions();

  video.addEventListener('error', () => {
    toast('Não foi possível carregar este vídeo.', 'error');
  });

  return { loadVideo };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function loadVideo(meta) {
  resetEditState();
  state.meta = meta;
  els.filename.textContent = meta.name || '';
  video.src = toFileUrl(meta.path);

  await new Promise((resolve) => {
    // `loadeddata` (not just `loadedmetadata`) guarantees the frame at the
    // current position has actually been decoded and is paintable, so the
    // very first drawImage() call doesn't render a blank/black canvas.
    video.addEventListener('loadeddata', resolve, { once: true });
  });

  const maxDim = 1920;
  let vw = video.videoWidth || 1280;
  let vh = video.videoHeight || 720;
  if (vw > maxDim) {
    vh = Math.round(vh * (maxDim / vw));
    vw = maxDim;
  }
  els.canvas.width = vw;
  els.canvas.height = vh;

  state.duration =
    meta.duration && isFinite(meta.duration) && meta.duration > 0
      ? meta.duration
      : isFinite(video.duration)
        ? video.duration
        : 0;
  state.trimStart = 0;
  state.trimEnd = state.duration;

  els.empty.hidden = true;
  els.stage.hidden = false;
  els.exportBtn.disabled = false;
  [els.toolCut, els.toolZoom, els.toolText, els.toolArrow, els.btnMarkCut].forEach((b) => (b.disabled = false));

  seek(0);
  renderTimeline();
  renderThumbStrip();
}

function resetEditState() {
  pausePlayback();
  state.meta = null;
  state.cuts = [];
  state.zooms = [];
  state.texts = [];
  state.arrows = [];
  state.selected = null;
  state.cutMarking = false;
  overlayDomMap.forEach((el) => el.remove());
  overlayDomMap.clear();
  removeZoomMarker();
  els.overlayLayer.innerHTML = '';
  renderPropertiesPanel();
}

// ---------------------------------------------------------------------------
// Toolbar (import / export)
// ---------------------------------------------------------------------------
function wireToolbar() {
  els.importBtn.addEventListener('click', importVideo);
  els.importBtn2.addEventListener('click', importVideo);
  els.exportBtn.addEventListener('click', exportVideo);
}

async function importVideo() {
  const picked = await window.api.openVideoDialog();
  if (!picked) return;
  await loadVideo(picked);
}

// ---------------------------------------------------------------------------
// Transport (play / pause / scrub / mute)
// ---------------------------------------------------------------------------
function wireTransport() {
  els.playBtn.addEventListener('click', playPause);
  els.scrubber.addEventListener('input', () => {
    if (state.playing) pausePlayback();
    const t = (Number(els.scrubber.value) / 1000) * state.duration;
    seek(t);
  });
  els.muteBtn.addEventListener('click', () => {
    state.muted = !state.muted;
    video.muted = state.muted;
    els.muteBtn.innerHTML = `<span class="icon" data-icon="${state.muted ? 'speaker-off' : 'speaker'}"></span>`;
    mountIcons(els.muteBtn);
  });
}

function playPause() {
  if (!state.meta) return;
  if (state.playing) pausePlayback();
  else startPlayback();
}

function startPlayback() {
  state.playing = true;
  video.play();
  els.playBtn.innerHTML = '<span class="icon" data-icon="pause"></span>';
  mountIcons(els.playBtn);
  rafId = requestAnimationFrame(tick);
}

function pausePlayback() {
  state.playing = false;
  video.pause();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  els.playBtn.innerHTML = '<span class="icon" data-icon="play"></span>';
  mountIcons(els.playBtn);
}

function tick() {
  if (!state.playing) return;
  drawFrame(video.currentTime, false);
  syncOverlayVisibility(video.currentTime);
  updateTransportUi();
  if (video.currentTime >= state.duration - 0.03 || video.ended) {
    pausePlayback();
    seek(0);
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function seek(t) {
  video.currentTime = clamp(t, 0, state.duration || 0);
  drawFrame(video.currentTime, false);
  syncOverlayVisibility(video.currentTime);
  updateTransportUi();
  // Self-correct once the browser confirms the seek landed: the immediate
  // draw above can occasionally paint a stale frame while the decoder catches up.
  video.addEventListener('seeked', () => drawFrame(video.currentTime, false), { once: true });
}

function updateTransportUi() {
  els.timeCurrent.textContent = formatTime(video.currentTime);
  els.timeTotal.textContent = formatTime(state.duration);
  els.scrubber.value = String(Math.round((video.currentTime / (state.duration || 1)) * 1000) || 0);
  updatePlayheadPosition();
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------
// A zoom region eases in centered on point A, optionally pans across to
// point B while fully zoomed in, then eases back out centered on B — this
// is what lets a single zoom "move the screen" between two chosen spots.
function computeZoomTransform(t) {
  const z = state.zooms.find((zz) => t >= zz.start && t <= zz.end);
  if (!z) return null;
  const inDur = Math.min(0.4, (z.end - z.start) / 3) || 0.001;
  const easeInEnd = z.start + inDur;
  const easeOutStart = z.end - inDur;

  let scaleProgress;
  let panProgress;
  if (t < easeInEnd) {
    scaleProgress = (t - z.start) / inDur;
    panProgress = 0;
  } else if (t > easeOutStart) {
    scaleProgress = (z.end - t) / inDur;
    panProgress = 1;
  } else {
    scaleProgress = 1;
    const midDur = Math.max(0.001, easeOutStart - easeInEnd);
    panProgress = (t - easeInEnd) / midDur;
  }

  const scale = 1 + (z.scale - 1) * smoothstep(scaleProgress);
  const panEase = smoothstep(panProgress);
  const cx = lerp(z.cx1, z.cx2, panEase);
  const cy = lerp(z.cy1, z.cy2, panEase);
  return { cx, cy, scale };
}

function drawFrame(t, burn) {
  const vw = video.videoWidth || els.canvas.width;
  const vh = video.videoHeight || els.canvas.height;
  const zt = computeZoomTransform(t);
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;
  if (zt && zt.scale > 1.001) {
    sw = vw / zt.scale;
    sh = vh / zt.scale;
    sx = clamp(zt.cx * vw - sw / 2, 0, Math.max(0, vw - sw));
    sy = clamp(zt.cy * vh - sh / 2, 0, Math.max(0, vh - sh));
  }
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, els.canvas.width, els.canvas.height);
  } catch {
    /* frame not decoded yet */
  }
  if (burn) renderOverlayBurn(t);
}

function renderOverlayBurn(t) {
  const cw = els.canvas.width;
  const ch = els.canvas.height;
  state.texts.filter((o) => t >= o.start && t <= o.end).forEach((o) => drawTextBurn(o, cw, ch));
  state.arrows.filter((o) => t >= o.start && t <= o.end).forEach((o) => drawArrowBurn(o, cw, ch));
}

function drawTextBurn(o, cw, ch) {
  const x = o.x * cw;
  const y = o.y * ch;
  const w = o.w * cw;
  const h = o.h * ch;
  ctx.save();
  if (o.bg && o.bg !== 'transparent') {
    ctx.fillStyle = o.bg;
    roundRectPath(x, y, w, h, Math.min(14, h / 4));
    ctx.fill();
  }
  const fontPx = Math.max(10, o.fontSizeRel * ch);
  ctx.font = `700 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = o.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  wrapText(o.text, x + w / 2, y + h / 2, w - 16, fontPx * 1.2);
  ctx.restore();
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(text, cx, cy, maxWidth, lineHeight) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const totalH = lines.length * lineHeight;
  const startY = cy - totalH / 2 + lineHeight / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}

function drawArrowBurn(o, cw, ch) {
  const x1 = o.x1 * cw;
  const y1 = o.y1 * ch;
  const x2 = o.x2 * cw;
  const y2 = o.y2 * ch;
  const lw = Math.max(2, o.widthRel * ch);
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = lw * 3.2;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Overlay DOM (live editing)
// ---------------------------------------------------------------------------
function stageWrapRect() {
  return els.stageWrap.getBoundingClientRect();
}

function syncOverlayVisibility(t) {
  overlayDomMap.forEach((el, id) => {
    const o =
      state.texts.find((x) => x.id === id) || state.arrows.find((x) => x.id === id) || null;
    if (o) el.style.display = t >= o.start && t <= o.end ? '' : 'none';
  });
}

function createTextDom(o) {
  const el = document.createElement('div');
  el.className = 'overlay-item';
  el.dataset.id = o.id;
  el.innerHTML = `<div class="overlay-text"></div><div class="overlay-resize-handle"></div>`;
  els.overlayLayer.appendChild(el);
  overlayDomMap.set(o.id, el);

  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('overlay-resize-handle')) return;
    selectItem('text', o.id);
    const rect = stageWrapRect();
    const startX = o.x;
    const startY = o.y;
    const downX = e.clientX;
    const downY = e.clientY;
    startPointerDrag(e, (ev) => {
      o.x = clamp(startX + (ev.clientX - downX) / rect.width, 0, 1 - o.w);
      o.y = clamp(startY + (ev.clientY - downY) / rect.height, 0, 1 - o.h);
      positionTextDom(o, el);
    });
  });

  el.querySelector('.overlay-resize-handle').addEventListener('pointerdown', (e) => {
    selectItem('text', o.id);
    const rect = stageWrapRect();
    const startW = o.w;
    const startH = o.h;
    const downX = e.clientX;
    const downY = e.clientY;
    startPointerDrag(e, (ev) => {
      o.w = clamp(startW + (ev.clientX - downX) / rect.width, 0.05, 1 - o.x);
      o.h = clamp(startH + (ev.clientY - downY) / rect.height, 0.04, 1 - o.y);
      positionTextDom(o, el);
    });
  });

  positionTextDom(o, el);
  return el;
}

function positionTextDom(o, el) {
  const rect = stageWrapRect();
  el.style.left = `${o.x * 100}%`;
  el.style.top = `${o.y * 100}%`;
  el.style.width = `${o.w * 100}%`;
  el.style.height = `${o.h * 100}%`;
  const textEl = el.querySelector('.overlay-text');
  textEl.textContent = o.text;
  textEl.style.color = o.color;
  textEl.style.background = o.bg;
  textEl.style.fontSize = `${o.fontSizeRel * rect.height}px`;
  textEl.style.width = '100%';
  textEl.style.height = '100%';
  textEl.style.display = 'flex';
  textEl.style.alignItems = 'center';
  textEl.style.justifyContent = 'center';
  textEl.style.textAlign = 'center';
  textEl.style.boxSizing = 'border-box';
}

function createArrowDom(o) {
  const el = document.createElement('div');
  el.className = 'overlay-item';
  el.dataset.id = o.id;
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.cursor = 'default';
  el.innerHTML = `
    <svg class="overlay-arrow-svg" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;">
      <defs><marker id="arrowhead-${o.id}" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><polygon points="0 0, 8 4, 0 8" /></marker></defs>
      <line class="arrow-line" />
    </svg>
    <div class="overlay-arrow-handle" data-end="tail" style="pointer-events:auto;"></div>
    <div class="overlay-arrow-handle" data-end="head" style="pointer-events:auto;"></div>
  `;
  els.overlayLayer.appendChild(el);
  overlayDomMap.set(o.id, el);

  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('overlay-arrow-handle')) return;
    selectItem('arrow', o.id);
  });

  el.querySelectorAll('.overlay-arrow-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      selectItem('arrow', o.id);
      const end = handle.dataset.end;
      const rect = stageWrapRect();
      startPointerDrag(e, (ev) => {
        const rx = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
        const ry = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
        if (end === 'tail') {
          o.x1 = rx;
          o.y1 = ry;
        } else {
          o.x2 = rx;
          o.y2 = ry;
        }
        positionArrowDom(o, el);
      });
    });
  });

  positionArrowDom(o, el);
  return el;
}

function positionArrowDom(o, el) {
  const rect = stageWrapRect();
  const line = el.querySelector('.arrow-line');
  line.setAttribute('x1', `${o.x1 * 100}%`);
  line.setAttribute('y1', `${o.y1 * 100}%`);
  line.setAttribute('x2', `${o.x2 * 100}%`);
  line.setAttribute('y2', `${o.y2 * 100}%`);
  line.setAttribute('stroke', o.color);
  line.setAttribute('stroke-width', String(Math.max(2, o.widthRel * rect.height)));
  line.setAttribute('marker-end', `url(#arrowhead-${o.id})`);
  const tail = el.querySelector('[data-end="tail"]');
  const head = el.querySelector('[data-end="head"]');
  tail.style.left = `${o.x1 * 100}%`;
  tail.style.top = `${o.y1 * 100}%`;
  head.style.left = `${o.x2 * 100}%`;
  head.style.top = `${o.y2 * 100}%`;
  head.style.background = o.color;
  tail.style.background = o.color;
  const poly = el.querySelector(`#arrowhead-${o.id} polygon`);
  if (poly) poly.setAttribute('fill', o.color);
}

function removeOverlayDom(id) {
  const el = overlayDomMap.get(id);
  if (el) el.remove();
  overlayDomMap.delete(id);
}

// Two draggable markers (A = zoom-in point, B = zoom-out point) connected
// by a dashed line, so a zoom can pan the view from one spot to another
// while staying zoomed in, instead of only holding a single fixed point.
function showZoomMarker(z) {
  removeZoomMarker();
  const inDur = Math.min(0.4, (z.end - z.start) / 3) || 0.001;

  const wrap = document.createElement('div');
  wrap.style.position = 'absolute';
  wrap.style.inset = '0';
  wrap.style.pointerEvents = 'none';
  wrap.innerHTML = `
    <svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;">
      <line class="zoom-connector" stroke-dasharray="5,4" stroke-width="2" stroke="var(--zoom-color)" />
    </svg>
    <div class="zoom-marker zoom-marker-a" title="Ponto inicial do zoom (A)">A</div>
    <div class="zoom-marker zoom-marker-b" title="Ponto final do zoom (B)">B</div>
  `;
  els.overlayLayer.appendChild(wrap);
  zoomMarkerEl = wrap;

  const line = wrap.querySelector('.zoom-connector');
  const markerA = wrap.querySelector('.zoom-marker-a');
  const markerB = wrap.querySelector('.zoom-marker-b');

  function positionMarkers() {
    markerA.style.left = `${z.cx1 * 100}%`;
    markerA.style.top = `${z.cy1 * 100}%`;
    markerB.style.left = `${z.cx2 * 100}%`;
    markerB.style.top = `${z.cy2 * 100}%`;
    line.setAttribute('x1', `${z.cx1 * 100}%`);
    line.setAttribute('y1', `${z.cy1 * 100}%`);
    line.setAttribute('x2', `${z.cx2 * 100}%`);
    line.setAttribute('y2', `${z.cy2 * 100}%`);
  }

  const bindDrag = (markerEl, keyX, keyY, previewTime) => {
    markerEl.style.pointerEvents = 'auto';
    markerEl.addEventListener('pointerdown', (e) => {
      if (video.currentTime < previewTime.min || video.currentTime > previewTime.max) {
        seek(clamp(previewTime.target, previewTime.min, previewTime.max));
      }
      const rect = stageWrapRect();
      startPointerDrag(e, (ev) => {
        z[keyX] = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
        z[keyY] = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
        positionMarkers();
        drawFrame(video.currentTime, false);
      });
    });
  };
  // Jump the preview into the zone where each point is fully in control
  // (A dominates during ease-in, B dominates from ease-out onward), so
  // dragging a marker shows an immediate, correct preview.
  bindDrag(markerA, 'cx1', 'cy1', { min: z.start, max: z.start + inDur, target: z.start + inDur / 2 });
  bindDrag(markerB, 'cx2', 'cy2', { min: z.end - inDur, max: z.end, target: z.end - inDur / 2 });

  positionMarkers();
}

function removeZoomMarker() {
  if (zoomMarkerEl) {
    zoomMarkerEl.remove();
    zoomMarkerEl = null;
  }
}

// ---------------------------------------------------------------------------
// Timeline rendering
// ---------------------------------------------------------------------------
function pctLeft(t) {
  return (t / (state.duration || 1)) * 100;
}
function pctWidth(a, b) {
  return ((b - a) / (state.duration || 1)) * 100;
}

function renderTimeline() {
  if (!state.duration) return;
  els.timelineDuration.textContent = formatTime(state.duration);

  els.trimStartEl.style.width = `${pctLeft(state.trimStart)}%`;
  els.trimEndEl.style.width = `${100 - pctLeft(state.trimEnd)}%`;

  els.cutsContainer.innerHTML = '';
  state.cuts.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'cut-block';
    div.style.left = `${pctLeft(c.start)}%`;
    div.style.width = `${pctWidth(c.start, c.end)}%`;
    div.title = `Corte: ${formatTime(c.start)} – ${formatTime(c.end)}`;
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem('cut', c.id);
    });
    els.cutsContainer.appendChild(div);
  });

  els.laneZoom.innerHTML = '';
  state.zooms.forEach((z) => {
    const div = document.createElement('div');
    div.className = `clip-block clip-zoom${state.selected && state.selected.id === z.id ? ' is-selected' : ''}`;
    div.style.left = `${pctLeft(z.start)}%`;
    div.style.width = `${Math.max(pctWidth(z.start, z.end), 1)}%`;
    div.textContent = `${z.scale.toFixed(1)}×`;
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem('zoom', z.id);
    });
    els.laneZoom.appendChild(div);
  });

  els.laneOverlay.innerHTML = '';
  // Text and arrows share one lane; new items default to the same start
  // time, so pin each type to its own half-height sub-row or one type's
  // block would always fully hide the other's.
  state.texts.forEach((o) => {
    const div = document.createElement('div');
    div.className = `clip-block clip-text${state.selected && state.selected.id === o.id ? ' is-selected' : ''}`;
    div.style.left = `${pctLeft(o.start)}%`;
    div.style.width = `${Math.max(pctWidth(o.start, o.end), 1)}%`;
    div.style.top = '2px';
    div.style.bottom = '50%';
    div.textContent = o.text.slice(0, 14) || 'Texto';
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem('text', o.id);
    });
    els.laneOverlay.appendChild(div);
  });
  state.arrows.forEach((o) => {
    const div = document.createElement('div');
    div.className = `clip-block clip-arrow${state.selected && state.selected.id === o.id ? ' is-selected' : ''}`;
    div.style.left = `${pctLeft(o.start)}%`;
    div.style.width = `${Math.max(pctWidth(o.start, o.end), 1)}%`;
    div.style.top = '50%';
    div.style.bottom = '2px';
    div.textContent = 'Seta';
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem('arrow', o.id);
    });
    els.laneOverlay.appendChild(div);
  });

  updatePlayheadPosition();
}

function updatePlayheadPosition() {
  if (!state.duration) return;
  const laneRect = els.laneVideo.getBoundingClientRect();
  const tracksRect = els.timelineTracks.getBoundingClientRect();
  const offsetLeft = laneRect.left - tracksRect.left;
  const x = offsetLeft + (video.currentTime / state.duration) * laneRect.width;
  els.playhead.style.left = `${x}px`;
}

function wireTimelineInteractions() {
  els.trimStartEl.addEventListener('pointerdown', (e) => {
    const laneRect = els.laneVideo.getBoundingClientRect();
    startPointerDrag(
      e,
      (ev) => {
        const t = clamp(((ev.clientX - laneRect.left) / laneRect.width) * state.duration, 0, state.trimEnd - 0.3);
        state.trimStart = t;
        renderTimeline();
      },
      () => seek(state.trimStart)
    );
  });

  els.trimEndEl.addEventListener('pointerdown', (e) => {
    const laneRect = els.laneVideo.getBoundingClientRect();
    startPointerDrag(
      e,
      (ev) => {
        const t = clamp(
          ((ev.clientX - laneRect.left) / laneRect.width) * state.duration,
          state.trimStart + 0.3,
          state.duration
        );
        state.trimEnd = t;
        renderTimeline();
      },
      () => seek(state.trimEnd)
    );
  });

  [els.laneVideo, els.laneZoom, els.laneOverlay].forEach((lane) => {
    lane.addEventListener('click', (e) => {
      if (!state.duration) return;
      if (e.target.closest('.cut-block') || e.target.closest('.clip-block') || e.target.closest('.trim-region')) {
        return;
      }
      const rect = els.laneVideo.getBoundingClientRect();
      const t = clamp(((e.clientX - rect.left) / rect.width) * state.duration, 0, state.duration);
      seek(t);
    });
  });
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------
async function renderThumbStrip() {
  els.thumbStrip.innerHTML = '';
  if (!state.duration || !state.meta) return;

  thumbVideo.src = toFileUrl(state.meta.path);
  await new Promise((resolve) => {
    thumbVideo.addEventListener('loadedmetadata', resolve, { once: true });
    thumbVideo.addEventListener('error', resolve, { once: true });
  });

  const count = 10;
  const tCanvas = document.createElement('canvas');
  tCanvas.width = 160;
  tCanvas.height = 90;
  const tCtx = tCanvas.getContext('2d');

  for (let i = 0; i < count; i++) {
    const t = (state.duration * (i + 0.5)) / count;
    // eslint-disable-next-line no-await-in-loop
    await seekVideoTo(thumbVideo, t);
    try {
      tCtx.drawImage(thumbVideo, 0, 0, tCanvas.width, tCanvas.height);
      const img = document.createElement('img');
      img.src = tCanvas.toDataURL('image/jpeg', 0.6);
      els.thumbStrip.appendChild(img);
    } catch {
      /* skip a frame that failed to decode */
    }
  }
}

function seekVideoTo(videoEl, t) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      videoEl.removeEventListener('seeked', finish);
      resolve();
    };
    videoEl.addEventListener('seeked', finish);
    videoEl.currentTime = clamp(t, 0, videoEl.duration || t);
    setTimeout(finish, 1200);
  });
}

// ---------------------------------------------------------------------------
// Tools (cut / zoom / text / arrow)
// ---------------------------------------------------------------------------
function wireTools() {
  els.toolCut.addEventListener('click', toggleCutMarking);
  els.btnMarkCut.addEventListener('click', toggleCutMarking);
  els.toolZoom.addEventListener('click', addZoom);
  els.toolText.addEventListener('click', addText);
  els.toolArrow.addEventListener('click', addArrow);
}

function toggleCutMarking() {
  if (!state.duration) return;
  if (!state.cutMarking) {
    state.cutMarking = true;
    state.cutMarkStart = video.currentTime;
    els.toolCut.classList.add('is-active');
    els.btnMarkCut.classList.add('is-active');
    els.btnMarkCut.innerHTML = '<span class="icon" data-icon="cut"></span> Marcar fim do corte';
    mountIcons(els.btnMarkCut);
    toast('Avance até o fim do trecho indesejado e marque novamente.', 'info');
  } else {
    const a = state.cutMarkStart;
    const b = video.currentTime;
    state.cutMarking = false;
    els.toolCut.classList.remove('is-active');
    els.btnMarkCut.classList.remove('is-active');
    els.btnMarkCut.innerHTML = '<span class="icon" data-icon="cut"></span> Marcar corte na posição atual';
    mountIcons(els.btnMarkCut);
    addCut(Math.min(a, b), Math.max(a, b));
  }
}

function addCut(start, end) {
  start = clamp(start, state.trimStart, state.trimEnd);
  end = clamp(end, state.trimStart, state.trimEnd);
  if (end - start < 0.15) {
    toast('Selecione um intervalo maior para cortar.', 'error');
    return;
  }
  state.cuts.push({ id: uid(), start, end });
  state.cuts.sort((a, b) => a.start - b.start);
  renderTimeline();
  toast(`Trecho de ${formatTime(start)} a ${formatTime(end)} marcado para corte.`, 'success');
}

function getKeptSegments() {
  const sorted = [...state.cuts].sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = state.trimStart;
  for (const c of sorted) {
    const s = clamp(c.start, state.trimStart, state.trimEnd);
    const e = clamp(c.end, state.trimStart, state.trimEnd);
    if (s > cursor) segments.push({ start: cursor, end: s });
    cursor = Math.max(cursor, e);
  }
  if (cursor < state.trimEnd) segments.push({ start: cursor, end: state.trimEnd });
  return segments.filter((s) => s.end - s.start > 0.02);
}

function addZoom() {
  if (!state.duration) return;
  const start = video.currentTime;
  const end = Math.min(start + 3, state.trimEnd);
  if (end - start < 0.3) {
    toast('Posicione o cursor com mais espaço antes do fim do vídeo.', 'error');
    return;
  }
  const z = { id: uid(), start, end, cx1: 0.5, cy1: 0.5, cx2: 0.5, cy2: 0.5, scale: 1.8 };
  state.zooms.push(z);
  selectItem('zoom', z.id);
}

function addText() {
  if (!state.duration) return;
  const start = video.currentTime;
  const end = Math.min(start + 4, state.trimEnd);
  if (end - start < 0.3) {
    toast('Posicione o cursor com mais espaço antes do fim do vídeo.', 'error');
    return;
  }
  const o = {
    id: uid(),
    start,
    end,
    x: 0.28,
    y: 0.42,
    w: 0.44,
    h: 0.14,
    text: 'Digite seu texto',
    color: '#ffffff',
    bg: 'rgba(0,0,0,0.55)',
    fontSizeRel: 0.055
  };
  state.texts.push(o);
  createTextDom(o);
  selectItem('text', o.id);
}

function addArrow() {
  if (!state.duration) return;
  const start = video.currentTime;
  const end = Math.min(start + 4, state.trimEnd);
  if (end - start < 0.3) {
    toast('Posicione o cursor com mais espaço antes do fim do vídeo.', 'error');
    return;
  }
  const o = { id: uid(), start, end, x1: 0.3, y1: 0.65, x2: 0.55, y2: 0.4, color: '#ca5010', widthRel: 0.01 };
  state.arrows.push(o);
  createArrowDom(o);
  selectItem('arrow', o.id);
}

function deleteItem(type, id) {
  if (type === 'text') state.texts = state.texts.filter((x) => x.id !== id);
  if (type === 'arrow') state.arrows = state.arrows.filter((x) => x.id !== id);
  if (type === 'zoom') state.zooms = state.zooms.filter((x) => x.id !== id);
  removeOverlayDom(id);
  removeZoomMarker();
  state.selected = null;
  renderTimeline();
  renderPropertiesPanel();
  drawFrame(video.currentTime, false);
}

// ---------------------------------------------------------------------------
// Selection + properties panel
// ---------------------------------------------------------------------------
function selectItem(type, id) {
  state.selected = { type, id };
  let obj = null;
  if (type === 'zoom') obj = state.zooms.find((x) => x.id === id);
  if (type === 'text') obj = state.texts.find((x) => x.id === id);
  if (type === 'arrow') obj = state.arrows.find((x) => x.id === id);
  if (type === 'cut') obj = state.cuts.find((x) => x.id === id);

  document.querySelectorAll('.overlay-item').forEach((el) => {
    el.classList.toggle('is-selected', el.dataset.id === id);
  });

  if (obj && (video.currentTime < obj.start || video.currentTime > obj.end)) {
    seek(obj.start + Math.min(0.05, (obj.end - obj.start) / 4));
  }

  renderTimeline();
  renderPropertiesPanel();
}

function renderPropertiesPanel() {
  removeZoomMarker();
  if (!state.selected) {
    els.panelContext.innerHTML = `<h3>Propriedades</h3><p class="panel-hint">Selecione um item na linha do tempo para editar suas propriedades.</p>`;
    return;
  }
  const { type, id } = state.selected;
  if (type === 'cut') return renderCutPanel(id);
  if (type === 'zoom') return renderZoomPanel(id);
  if (type === 'text') return renderTextPanel(id);
  if (type === 'arrow') return renderArrowPanel(id);
}

function addSwatch(container, color, selected, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `color-swatch${selected ? ' is-selected' : ''}`;
  el.style.background = color === 'transparent' ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px' : color;
  el.title = color;
  el.addEventListener('click', onClick);
  container.appendChild(el);
}

function renderCutPanel(id) {
  const cut = state.cuts.find((c) => c.id === id);
  if (!cut) return;
  els.panelContext.innerHTML = `
    <h3>Corte</h3>
    <p class="panel-hint">De ${formatTime(cut.start)} até ${formatTime(cut.end)} (${formatTime(cut.end - cut.start)} removidos na exportação)</p>
    <button class="btn btn-danger btn-block" id="prop-delete"><span class="icon" data-icon="trash"></span> Remover corte</button>
  `;
  mountIcons(els.panelContext);
  els.panelContext.querySelector('#prop-delete').addEventListener('click', () => {
    state.cuts = state.cuts.filter((c) => c.id !== id);
    state.selected = null;
    renderTimeline();
    renderPropertiesPanel();
  });
}

function renderZoomPanel(id) {
  const z = state.zooms.find((x) => x.id === id);
  if (!z) return;
  els.panelContext.innerHTML = `
    <h3>Zoom</h3>
    <div class="prop-row">
      <div class="prop-field"><label>Início (s)</label><input type="number" step="0.1" min="0" class="text-input" id="prop-start" value="${z.start.toFixed(1)}"></div>
      <div class="prop-field"><label>Fim (s)</label><input type="number" step="0.1" min="0" class="text-input" id="prop-end" value="${z.end.toFixed(1)}"></div>
    </div>
    <div class="prop-field"><label>Intensidade do zoom</label><input type="range" min="1.2" max="3" step="0.1" class="slider" style="width:100%" id="prop-scale" value="${z.scale}"></div>
    <p class="panel-hint">Arraste os círculos <strong>A</strong> e <strong>B</strong> sobre o vídeo: o zoom começa em A e se move até B enquanto estiver ampliado — assim você mostra dois cantos diferentes num só zoom.</p>
    <div class="prop-row">
      <div class="prop-field">
        <label>Início do zoom (A)</label>
        <div class="corner-grid" id="corners-a"></div>
      </div>
      <div class="prop-field">
        <label>Fim do zoom (B)</label>
        <div class="corner-grid" id="corners-b"></div>
      </div>
    </div>
    <button class="btn btn-secondary btn-block" id="prop-no-pan">Zoom parado (não mover)</button>
    <button class="btn btn-danger btn-block" id="prop-delete"><span class="icon" data-icon="trash"></span> Remover zoom</button>
  `;
  mountIcons(els.panelContext);

  els.panelContext.querySelector('#prop-start').addEventListener('change', (e) => {
    z.start = clamp(Number(e.target.value), state.trimStart, z.end - 0.2);
    renderTimeline();
    showZoomMarker(z);
  });
  els.panelContext.querySelector('#prop-end').addEventListener('change', (e) => {
    z.end = clamp(Number(e.target.value), z.start + 0.2, state.trimEnd);
    renderTimeline();
    showZoomMarker(z);
  });
  els.panelContext.querySelector('#prop-scale').addEventListener('input', (e) => {
    z.scale = Number(e.target.value);
    renderTimeline();
    drawFrame(video.currentTime, false);
  });

  const refreshMarkersAndPreview = () => {
    showZoomMarker(z);
    renderTimeline();
    drawFrame(video.currentTime, false);
  };
  buildCornerGrid(els.panelContext.querySelector('#corners-a'), (px, py) => {
    z.cx1 = px;
    z.cy1 = py;
    refreshMarkersAndPreview();
  });
  buildCornerGrid(els.panelContext.querySelector('#corners-b'), (px, py) => {
    z.cx2 = px;
    z.cy2 = py;
    refreshMarkersAndPreview();
  });
  els.panelContext.querySelector('#prop-no-pan').addEventListener('click', () => {
    z.cx2 = z.cx1;
    z.cy2 = z.cy1;
    refreshMarkersAndPreview();
  });
  els.panelContext.querySelector('#prop-delete').addEventListener('click', () => deleteItem('zoom', id));

  showZoomMarker(z);
}

function buildCornerGrid(container, onPick) {
  container.innerHTML = '';
  CORNER_PRESETS.forEach(([px, py]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'corner-btn';
    btn.addEventListener('click', () => onPick(px, py));
    container.appendChild(btn);
  });
}

function renderTextPanel(id) {
  const o = state.texts.find((x) => x.id === id);
  if (!o) return;
  els.panelContext.innerHTML = `
    <h3>Caixa de texto</h3>
    <div class="prop-field"><label>Texto</label><textarea id="prop-text">${escapeHtml(o.text)}</textarea></div>
    <div class="prop-field"><label>Tamanho da fonte</label><input type="range" min="0.02" max="0.14" step="0.005" class="slider" style="width:100%" id="prop-font" value="${o.fontSizeRel}"></div>
    <div class="prop-field"><label>Cor do texto</label><div class="color-swatches" id="prop-color"></div></div>
    <div class="prop-field"><label>Fundo</label><div class="color-swatches" id="prop-bg"></div></div>
    <div class="prop-row">
      <div class="prop-field"><label>Início (s)</label><input type="number" step="0.1" min="0" class="text-input" id="prop-start" value="${o.start.toFixed(1)}"></div>
      <div class="prop-field"><label>Fim (s)</label><input type="number" step="0.1" min="0" class="text-input" id="prop-end" value="${o.end.toFixed(1)}"></div>
    </div>
    <button class="btn btn-danger btn-block" id="prop-delete"><span class="icon" data-icon="trash"></span> Remover texto</button>
  `;
  mountIcons(els.panelContext);

  const el = overlayDomMap.get(id);
  const textArea = els.panelContext.querySelector('#prop-text');
  textArea.addEventListener('input', () => {
    o.text = textArea.value;
    positionTextDom(o, el);
    renderTimeline();
  });
  els.panelContext.querySelector('#prop-font').addEventListener('input', (e) => {
    o.fontSizeRel = Number(e.target.value);
    positionTextDom(o, el);
  });
  const colorSwatchesEl = els.panelContext.querySelector('#prop-color');
  TEXT_COLORS.forEach((c) =>
    addSwatch(colorSwatchesEl, c, c === o.color, () => {
      o.color = c;
      positionTextDom(o, el);
      renderTextPanel(id);
    })
  );
  const bgSwatchesEl = els.panelContext.querySelector('#prop-bg');
  BG_COLORS.forEach((c) =>
    addSwatch(bgSwatchesEl, c, c === o.bg, () => {
      o.bg = c;
      positionTextDom(o, el);
      renderTextPanel(id);
    })
  );
  els.panelContext.querySelector('#prop-start').addEventListener('change', (e) => {
    o.start = clamp(Number(e.target.value), state.trimStart, o.end - 0.2);
    renderTimeline();
    syncOverlayVisibility(video.currentTime);
  });
  els.panelContext.querySelector('#prop-end').addEventListener('change', (e) => {
    o.end = clamp(Number(e.target.value), o.start + 0.2, state.trimEnd);
    renderTimeline();
    syncOverlayVisibility(video.currentTime);
  });
  els.panelContext.querySelector('#prop-delete').addEventListener('click', () => deleteItem('text', id));
}

function renderArrowPanel(id) {
  const o = state.arrows.find((x) => x.id === id);
  if (!o) return;
  els.panelContext.innerHTML = `
    <h3>Seta</h3>
    <p class="panel-hint">Arraste as pontas da seta sobre o vídeo para reposicioná-la.</p>
    <div class="prop-field"><label>Cor</label><div class="color-swatches" id="prop-color"></div></div>
    <div class="prop-field"><label>Espessura</label><input type="range" min="0.004" max="0.03" step="0.002" class="slider" style="width:100%" id="prop-width" value="${o.widthRel}"></div>
    <div class="prop-row">
      <div class="prop-field"><label>Início (s)</label><input type="number" step="0.1" min="0" class="text-input" id="prop-start" value="${o.start.toFixed(1)}"></div>
      <div class="prop-field"><label>Fim (s)</label><input type="number" step="0.1" min="0" class="text-input" id="prop-end" value="${o.end.toFixed(1)}"></div>
    </div>
    <button class="btn btn-danger btn-block" id="prop-delete"><span class="icon" data-icon="trash"></span> Remover seta</button>
  `;
  mountIcons(els.panelContext);

  const el = overlayDomMap.get(id);
  const colorSwatchesEl = els.panelContext.querySelector('#prop-color');
  TEXT_COLORS.forEach((c) =>
    addSwatch(colorSwatchesEl, c, c === o.color, () => {
      o.color = c;
      positionArrowDom(o, el);
      renderArrowPanel(id);
    })
  );
  els.panelContext.querySelector('#prop-width').addEventListener('input', (e) => {
    o.widthRel = Number(e.target.value);
    positionArrowDom(o, el);
  });
  els.panelContext.querySelector('#prop-start').addEventListener('change', (e) => {
    o.start = clamp(Number(e.target.value), state.trimStart, o.end - 0.2);
    renderTimeline();
    syncOverlayVisibility(video.currentTime);
  });
  els.panelContext.querySelector('#prop-end').addEventListener('change', (e) => {
    o.end = clamp(Number(e.target.value), o.start + 0.2, state.trimEnd);
    renderTimeline();
    syncOverlayVisibility(video.currentTime);
  });
  els.panelContext.querySelector('#prop-delete').addEventListener('click', () => deleteItem('arrow', id));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function setExportingUi(isExporting) {
  els.exportBtn.disabled = isExporting;
  els.importBtn.disabled = isExporting;
  els.importBtn2.disabled = isExporting;
  els.playBtn.disabled = isExporting;
  els.scrubber.disabled = isExporting;
  [els.toolCut, els.toolZoom, els.toolText, els.toolArrow, els.btnMarkCut].forEach((b) => (b.disabled = isExporting));
}

function playThroughSegments(segments, onProgress) {
  return new Promise((resolve, reject) => {
    let segIdx = 0;
    const totalOut = segments.reduce((a, s) => a + (s.end - s.start), 0) || 1;
    let outAccum = 0;
    let lastT = segments[0].start;

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video
        .play()
        .then(() => requestAnimationFrame(step))
        .catch(reject);
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = segments[0].start;

    function step() {
      const seg = segments[segIdx];
      const t = video.currentTime;
      drawFrame(t, true);
      outAccum += Math.max(0, t - lastT);
      lastT = t;
      if (onProgress) onProgress(Math.min(outAccum, totalOut), totalOut);

      if (t >= seg.end - 0.03 || video.ended) {
        segIdx++;
        if (segIdx >= segments.length) {
          video.pause();
          resolve();
          return;
        }
        lastT = segments[segIdx].start;
        video.currentTime = segments[segIdx].start;
        requestAnimationFrame(step);
        return;
      }
      requestAnimationFrame(step);
    }
  });
}

async function exportVideo() {
  if (!state.meta || !state.duration) return;
  const segments = getKeptSegments();
  if (!segments.length) {
    toast('Não há conteúdo para exportar — tudo foi cortado.', 'error');
    return;
  }
  if (state.playing) pausePlayback();

  const outputDuration = segments.reduce((a, s) => a + (s.end - s.start), 0);
  setExportingUi(true);

  let sessionId = null;
  const progress = showProgressModal({ title: 'Renderizando vídeo editado...' });
  const wasMuted = video.muted;

  try {
    const canvasStream = els.canvas.captureStream(30);
    const tracks = [canvasStream.getVideoTracks()[0]];
    let audioTrack = null;
    try {
      const vStream = typeof video.captureStream === 'function' ? video.captureStream() : null;
      audioTrack = vStream ? vStream.getAudioTracks()[0] || null : null;
    } catch {
      /* captureStream on the media element may be unavailable */
    }
    if (audioTrack) tracks.push(audioTrack);
    const finalStream = new MediaStream(tracks);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(finalStream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 8_000_000
    });

    const begin = await window.api.streamBegin();
    sessionId = begin.sessionId;
    const pendingChunkWrites = [];
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) {
        pendingChunkWrites.push(e.data.arrayBuffer().then((buf) => window.api.streamChunk(sessionId, buf)));
      }
    });

    video.muted = false;
    recorder.start(500);

    await playThroughSegments(segments, (done, total) => {
      progress.update((done / total) * 55, `Renderizando… ${Math.round((done / total) * 100)}%`);
    });

    recorder.stop();
    await new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
    // Wait for every in-flight chunk write (including the final one fired
    // alongside `stop`) before closing the file on the main-process side.
    await Promise.all(pendingChunkWrites);
    video.muted = wasMuted;

    const unsubConv = window.api.onConvertProgress(({ percent }) => {
      progress.update(55 + percent * 0.45, `Convertendo para MP4… ${Math.round(percent)}%`);
    });
    const { tempPath } = await window.api.streamEnd(sessionId);
    sessionId = null;
    const result = await window.api.finalizeExport(tempPath, `${state.meta.name || 'video'}-editado`, outputDuration);
    unsubConv();
    progress.close();

    if (result.success) {
      toast('Vídeo exportado com sucesso: ' + result.path, 'success');
    } else if (!result.canceled) {
      toast('Falha ao exportar: ' + (result.error || ''), 'error');
    }
  } catch (err) {
    progress.close();
    console.error(err);
    toast('Falha ao exportar o vídeo: ' + (err.message || err), 'error');
    if (sessionId) window.api.streamAbort(sessionId);
  } finally {
    video.muted = wasMuted;
    setExportingUi(false);
    seek(0);
  }
}
