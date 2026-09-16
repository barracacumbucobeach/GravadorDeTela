import { mountIcons } from './icons.js';
import { formatTime, clamp, lerp, toast, escapeHtml, openModal, showProgressModal, pickMimeType } from './utils.js';

const els = {
  pickBtn: document.getElementById('btn-pick-source'),
  pickBtn2: document.getElementById('btn-pick-source-2'),
  preview: document.getElementById('source-preview'),
  audioGroup: document.getElementById('audio-mode'),
  followToggle: document.getElementById('toggle-follow-cursor'),
  zoomRow: document.getElementById('zoom-level-row'),
  zoomSlider: document.getElementById('zoom-level'),
  zoomValue: document.getElementById('zoom-level-value'),
  nameInput: document.getElementById('recording-name'),
  timer: document.getElementById('record-timer'),
  recordBtn: document.getElementById('btn-record'),
  pauseBtn: document.getElementById('btn-pause'),
  stopBtn: document.getElementById('btn-stop'),
  hint: document.getElementById('record-hint')
};

const state = {
  selectedSource: null,
  audioMode: 'none',
  followCursor: true,
  zoomLevel: 1.8,
  displays: [],
  recording: false,
  paused: false
};

let mediaRecorder = null;
let activeStreams = []; // all MediaStream objects we must stop() on cleanup
let sessionId = null;
let pendingChunkWrites = []; // in-flight streamChunk() promises, drained before streamEnd()
let startTime = 0;
let pausedAccum = 0;
let pauseStartedAt = 0;
let timerInterval = null;
let pillEl = null;

let compositing = false;
let compositeRaf = null;
let latestCursor = null;
let targetDisplay = null;
let savedCallback = null;
let compositeSourceVideo = null;
let cursorUnsub = null;

export function initRecorder({ onSaved }) {
  savedCallback = onSaved || null;
  loadInitialSettings();

  els.pickBtn.addEventListener('click', pickSource);
  els.pickBtn2.addEventListener('click', pickSource);

  els.audioGroup.querySelectorAll('.segmented-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.audioMode = btn.dataset.audio;
      els.audioGroup.querySelectorAll('.segmented-item').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-checked', String(b === btn));
      });
      window.api.setSettings({ audioMode: state.audioMode });
    });
  });

  els.followToggle.addEventListener('change', () => {
    state.followCursor = els.followToggle.checked;
    els.zoomRow.classList.toggle('is-disabled', !state.followCursor);
    window.api.setSettings({ followCursorDefault: state.followCursor });
  });

  els.zoomSlider.addEventListener('input', () => {
    state.zoomLevel = Number(els.zoomSlider.value);
    els.zoomValue.textContent = `${state.zoomLevel.toFixed(1)}×`;
  });
  els.zoomSlider.addEventListener('change', () => {
    window.api.setSettings({ zoomLevel: state.zoomLevel });
  });

  els.recordBtn.addEventListener('click', () => {
    if (!state.recording) beginRecordingFlow();
  });
  els.pauseBtn.addEventListener('click', togglePause);
  els.stopBtn.addEventListener('click', () => finishRecording());

  window.api.listDisplays().then((displays) => {
    state.displays = displays;
  });
}

async function loadInitialSettings() {
  const settings = await window.api.getSettings();
  state.audioMode = settings.audioMode || 'none';
  state.followCursor = settings.followCursorDefault !== false;
  state.zoomLevel = settings.zoomLevel || 1.8;

  els.audioGroup.querySelectorAll('.segmented-item').forEach((b) => {
    const active = b.dataset.audio === state.audioMode;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-checked', String(active));
  });
  els.followToggle.checked = state.followCursor;
  els.zoomRow.classList.toggle('is-disabled', !state.followCursor);
  els.zoomSlider.value = String(state.zoomLevel);
  els.zoomValue.textContent = `${state.zoomLevel.toFixed(1)}×`;
}

// ---------------------------------------------------------------------------
// Source picker
// ---------------------------------------------------------------------------
async function pickSource() {
  let sources;
  try {
    sources = await window.api.listSources();
  } catch {
    toast('Não foi possível listar as telas e janelas disponíveis.', 'error');
    return;
  }
  if (!sources.length) {
    toast('Nenhuma tela ou janela encontrada.', 'error');
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.width = '680px';
  wrap.innerHTML = `
    <h2>Escolher o que gravar</h2>
    <p style="margin-top:4px;">Selecione uma tela inteira ou uma janela específica.</p>
    <div class="source-grid" id="picker-grid"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-act="cancel">Cancelar</button>
      <button class="btn btn-accent" data-act="ok" disabled>Selecionar</button>
    </div>
  `;
  const grid = wrap.querySelector('#picker-grid');
  const okBtn = wrap.querySelector('[data-act="ok"]');
  let chosen = null;

  const backdrop = openModal(wrap);
  const close = (result) => {
    backdrop.remove();
    if (result) applySelectedSource(result);
  };

  sources.forEach((s) => {
    const tile = document.createElement('button');
    tile.className = 'source-tile';
    tile.innerHTML = `
      <div class="source-tile-thumb">${s.thumbnailDataUrl ? `<img src="${s.thumbnailDataUrl}" alt="" />` : ''}</div>
      <div class="source-tile-name">
        ${
          s.appIconDataUrl
            ? `<img src="${s.appIconDataUrl}" alt="" />`
            : `<span class="icon" data-icon="${s.isScreen ? 'screen' : 'window'}"></span>`
        }
        <span>${escapeHtml(s.name || (s.isScreen ? 'Tela' : 'Janela'))}</span>
      </div>
    `;
    tile.addEventListener('click', () => {
      grid.querySelectorAll('.source-tile').forEach((t) => t.classList.remove('is-selected'));
      tile.classList.add('is-selected');
      chosen = s;
      okBtn.disabled = false;
    });
    tile.addEventListener('dblclick', () => close(s));
    grid.appendChild(tile);
  });
  mountIcons(grid);

  okBtn.addEventListener('click', () => close(chosen));
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close(null);
  });
}

function applySelectedSource(source) {
  state.selectedSource = source;
  els.preview.innerHTML = '';
  if (source.thumbnailDataUrl) {
    const img = document.createElement('img');
    img.src = source.thumbnailDataUrl;
    els.preview.appendChild(img);
  }
  const badge = document.createElement('div');
  badge.className = 'source-name-badge';
  badge.textContent = source.name || (source.isScreen ? 'Tela' : 'Janela');
  els.preview.appendChild(badge);

  const canFollow = !!source.isScreen;
  els.followToggle.disabled = !canFollow;
  if (!canFollow) {
    els.zoomRow.classList.add('is-disabled');
  } else {
    els.zoomRow.classList.toggle('is-disabled', !state.followCursor);
  }

  els.hint.textContent = 'Pronto para gravar';
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------
function showCountdown() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay';
    const number = document.createElement('div');
    number.className = 'countdown-number';
    overlay.appendChild(number);
    document.body.appendChild(overlay);

    let n = 3;
    number.textContent = String(n);
    const interval = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(interval);
        overlay.remove();
        resolve();
        return;
      }
      number.textContent = String(n);
      number.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      number.offsetHeight;
      number.style.animation = '';
    }, 800);
  });
}

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------
async function beginRecordingFlow() {
  if (!state.selectedSource) {
    toast('Selecione uma tela ou janela para gravar.', 'error');
    return;
  }

  els.recordBtn.disabled = true;
  await showCountdown();
  els.recordBtn.disabled = false;

  try {
    await startRecording();
  } catch (err) {
    console.error(err);
    toast('Não foi possível iniciar a gravação: ' + (err.message || err), 'error');
    cleanupAfterFailure();
  }
}

async function startRecording() {
  const source = state.selectedSource;
  const audioMode = state.audioMode;

  await window.api.setPendingSource({ sourceId: source.id, audioMode });

  const wantsAnyAudio = audioMode !== 'none';
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: wantsAnyAudio
  });
  activeStreams.push(displayStream);

  let micStream = null;
  if (audioMode === 'mic' || audioMode === 'both') {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      activeStreams.push(micStream);
    } catch {
      toast('Não foi possível acessar o microfone. Gravando sem áudio do microfone.', 'error');
    }
  }

  const hasSystemAudio = displayStream.getAudioTracks().length > 0;
  if ((audioMode === 'system' || audioMode === 'both') && !hasSystemAudio) {
    toast('Áudio do sistema não é suportado neste computador. Continuando sem ele.', 'error');
  }

  const audioTrack = buildAudioTrack(audioMode, displayStream, micStream);

  const willFollow = state.followCursor && source.isScreen;
  const videoTrack = willFollow
    ? await buildFollowCursorVideoTrack(displayStream, source)
    : displayStream.getVideoTracks()[0];

  const tracks = [videoTrack];
  if (audioTrack) tracks.push(audioTrack);
  const finalStream = new MediaStream(tracks);
  // Includes the canvas-derived track (follow-cursor mode) and any mixed
  // audio destination track, neither of which belongs to activeStreams'
  // displayStream/micStream entries, so they need their own stop() call.
  activeStreams.push(finalStream);

  const mimeType = pickMimeType();
  mediaRecorder = new MediaRecorder(finalStream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: 8_000_000
  });

  const begin = await window.api.streamBegin();
  sessionId = begin.sessionId;
  pendingChunkWrites = [];

  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0 && sessionId) {
      const currentSessionId = sessionId;
      const write = e.data.arrayBuffer().then((buf) => window.api.streamChunk(currentSessionId, buf));
      pendingChunkWrites.push(write);
    }
  });

  // If the underlying screen capture ends by any external means, treat it
  // the same as pressing "Stop" (this is the original capture track even
  // when the recorded track is a canvas derived from it).
  displayStream.getVideoTracks()[0].addEventListener('ended', () => {
    if (state.recording) finishRecording();
  });

  mediaRecorder.start(1000);

  state.recording = true;
  state.paused = false;
  startTime = Date.now();
  pausedAccum = 0;

  updateUiRecording(true);
  startTimer();
  if (willFollow) window.api.startCursorTracking();
  showPill();
}

function buildAudioTrack(audioMode, displayStream, micStream) {
  if (audioMode === 'none') return null;

  if (audioMode === 'mic') {
    return micStream ? micStream.getAudioTracks()[0] || null : null;
  }

  if (audioMode === 'system') {
    return displayStream.getAudioTracks()[0] || null;
  }

  // 'both' -> mix mic + system (loopback) via Web Audio API
  const sysTrack = displayStream.getAudioTracks()[0] || null;
  const micTrack = micStream ? micStream.getAudioTracks()[0] || null : null;
  if (sysTrack && micTrack) {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream([sysTrack])).connect(dest);
    ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
    return dest.stream.getAudioTracks()[0];
  }
  return sysTrack || micTrack || null;
}

async function buildFollowCursorVideoTrack(displayStream, source) {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = new MediaStream([displayStream.getVideoTracks()[0]]);
  await video.play();
  await new Promise((resolve) => {
    if (video.videoWidth) resolve();
    else video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });

  const maxDim = 1920;
  let vw = video.videoWidth;
  let vh = video.videoHeight;
  if (vw > maxDim) {
    vh = Math.round(vh * (maxDim / vw));
    vw = maxDim;
  }

  const canvas = document.createElement('canvas');
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d', { alpha: false });

  targetDisplay = state.displays.find((d) => d.id === source.display_id) || state.displays[0] || null;
  latestCursor = targetDisplay
    ? { x: targetDisplay.bounds.x + targetDisplay.bounds.width / 2, y: targetDisplay.bounds.y + targetDisplay.bounds.height / 2 }
    : null;

  compositeSourceVideo = video;
  cursorUnsub = window.api.onCursorUpdate((point) => {
    latestCursor = point;
  });

  let smoothX = video.videoWidth / 2;
  let smoothY = video.videoHeight / 2;

  compositing = true;
  function draw() {
    if (!compositing) return;
    const target = mapCursorToVideo(latestCursor, targetDisplay, video.videoWidth, video.videoHeight);
    smoothX = lerp(smoothX, target.x, 0.08);
    smoothY = lerp(smoothY, target.y, 0.08);

    const scale = state.zoomLevel;
    const viewW = video.videoWidth / scale;
    const viewH = video.videoHeight / scale;
    const sx = clamp(smoothX - viewW / 2, 0, Math.max(0, video.videoWidth - viewW));
    const sy = clamp(smoothY - viewH / 2, 0, Math.max(0, video.videoHeight - viewH));
    try {
      ctx.drawImage(video, sx, sy, viewW, viewH, 0, 0, canvas.width, canvas.height);
    } catch {
      /* frame not ready yet */
    }
    compositeRaf = requestAnimationFrame(draw);
  }
  draw();

  const stream = canvas.captureStream(30);
  return stream.getVideoTracks()[0];
}

function mapCursorToVideo(point, display, videoW, videoH) {
  if (!point || !display) return { x: videoW / 2, y: videoH / 2 };
  const scaleFactor = display.scaleFactor || 1;
  const localX = (point.x - display.bounds.x) * scaleFactor;
  const localY = (point.y - display.bounds.y) * scaleFactor;
  const ratioX = videoW / (display.bounds.width * scaleFactor || videoW);
  const ratioY = videoH / (display.bounds.height * scaleFactor || videoH);
  return { x: localX * ratioX, y: localY * ratioY };
}

// ---------------------------------------------------------------------------
// Pause / stop / cleanup
// ---------------------------------------------------------------------------
function togglePause() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  if (state.paused) {
    mediaRecorder.resume();
    pausedAccum += Date.now() - pauseStartedAt;
    state.paused = false;
    els.pauseBtn.innerHTML = '<span class="icon" data-icon="pause"></span> Pausar';
    els.recordBtn.classList.remove('is-paused');
  } else {
    mediaRecorder.pause();
    pauseStartedAt = Date.now();
    state.paused = true;
    els.pauseBtn.innerHTML = '<span class="icon" data-icon="play"></span> Retomar';
    els.recordBtn.classList.add('is-paused');
  }
  mountIcons(els.pauseBtn);
}

async function finishRecording() {
  if (!state.recording || !mediaRecorder) return;
  state.recording = false;

  els.stopBtn.disabled = true;
  els.pauseBtn.disabled = true;

  const finalElapsed = elapsedSeconds();
  stopTimer();
  window.api.stopCursorTracking();

  const audioTracksPresent = mediaRecorder.stream.getAudioTracks().length > 0;

  await new Promise((resolve) => {
    mediaRecorder.addEventListener('stop', resolve, { once: true });
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    else resolve();
  });
  // The final `dataavailable` (fired alongside `stop`) may still be
  // converting its Blob to an ArrayBuffer and writing it over IPC; wait for
  // every in-flight chunk write before closing the file, or the last
  // second of the recording can be silently dropped.
  await Promise.all(pendingChunkWrites);
  pendingChunkWrites = [];

  stopCompositing();
  activeStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  activeStreams = [];
  hidePill();
  updateUiRecording(false);

  const progress = showProgressModal({ title: 'Salvando gravação em MP4...' });
  const unsub = window.api.onConvertProgress(({ percent }) => progress.update(percent));

  try {
    const { tempPath } = await window.api.streamEnd(sessionId);
    sessionId = null;
    const result = await window.api.finalizeRecording(tempPath, {
      name: els.nameInput.value.trim(),
      duration: finalElapsed,
      hasAudio: audioTracksPresent,
      followCursor: state.followCursor && state.selectedSource && state.selectedSource.isScreen
    });
    progress.close();
    if (result.success) {
      toast(`Gravação salva: ${result.record.name}.mp4`, 'success');
      els.nameInput.value = '';
      if (savedCallback) savedCallback(result.record);
    } else {
      toast('Falha ao converter a gravação: ' + (result.error || ''), 'error');
    }
  } catch (err) {
    progress.close();
    toast('Falha ao salvar a gravação: ' + (err.message || err), 'error');
  } finally {
    unsub();
  }
}

function cleanupAfterFailure() {
  stopCompositing();
  activeStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  activeStreams = [];
  window.api.stopCursorTracking();
  stopTimer();
  hidePill();
  updateUiRecording(false);
  state.recording = false;
  if (sessionId) {
    window.api.streamAbort(sessionId);
    sessionId = null;
  }
}

function stopCompositing() {
  compositing = false;
  if (compositeRaf) cancelAnimationFrame(compositeRaf);
  compositeRaf = null;
  if (cursorUnsub) cursorUnsub();
  cursorUnsub = null;
  if (compositeSourceVideo) {
    compositeSourceVideo.pause();
    compositeSourceVideo.srcObject = null;
  }
  compositeSourceVideo = null;
}

function updateUiRecording(isRecording) {
  els.recordBtn.classList.toggle('is-recording', isRecording);
  els.recordBtn.classList.remove('is-paused');
  els.pauseBtn.disabled = !isRecording;
  els.stopBtn.disabled = !isRecording;
  els.pickBtn.disabled = isRecording;
  els.pickBtn2.disabled = isRecording;
  els.audioGroup.querySelectorAll('.segmented-item').forEach((b) => (b.disabled = isRecording));
  els.followToggle.disabled = isRecording || !(state.selectedSource && state.selectedSource.isScreen);
  els.zoomSlider.disabled = isRecording;
  els.nameInput.disabled = isRecording;
  els.pauseBtn.innerHTML = '<span class="icon" data-icon="pause"></span> Pausar';
  mountIcons(els.pauseBtn);
  els.hint.textContent = isRecording ? 'Gravando...' : state.selectedSource ? 'Pronto para gravar' : 'Selecione uma origem para começar';
}

// ---------------------------------------------------------------------------
// Timer + floating pill
// ---------------------------------------------------------------------------
function elapsedSeconds() {
  const end = state.paused ? pauseStartedAt : Date.now();
  return (end - startTime - pausedAccum) / 1000;
}

function startTimer() {
  updateTimerUi();
  timerInterval = setInterval(updateTimerUi, 250);
}
function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  els.timer.textContent = '00:00';
}
function updateTimerUi() {
  const t = formatTime(elapsedSeconds());
  els.timer.textContent = t;
  if (pillEl) pillEl.querySelector('.pill-timer').textContent = t;
}

function showPill() {
  pillEl = document.createElement('div');
  pillEl.className = 'recording-pill';
  pillEl.innerHTML = `<span class="dot"></span><span class="pill-timer">00:00</span><span>Gravando</span>`;
  document.body.appendChild(pillEl);
}
function hidePill() {
  if (pillEl) {
    pillEl.remove();
    pillEl = null;
  }
}
