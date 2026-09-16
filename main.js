'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  dialog,
  shell,
  nativeTheme
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const RECORDINGS_DIR = path.join(app.getPath('videos'), 'Gravador de Tela');
const TMP_DIR = path.join(app.getPath('temp'), 'gravador-de-tela');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  theme: 'light',
  followCursorDefault: true,
  zoomLevel: 1.8,
  audioMode: 'mic'
};

let mainWindow = null;
let cursorInterval = null;
let pendingCapture = null;
const streamSessions = new Map();

function ensureDirs() {
  for (const dir of [RECORDINGS_DIR, TMP_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length ? cleaned : `Gravacao ${Date.now()}`;
}

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: readSettings().theme === 'dark' ? '#20232a' : '#f3f3f3',
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize', () => mainWindow.webContents.send('win:maximized-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:maximized-changed', false));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupDisplayMediaHandler() {
  const ses = mainWindow.webContents.session;
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } })
        .then((sources) => {
          const chosen =
            (pendingCapture && sources.find((s) => s.id === pendingCapture.sourceId)) || sources[0];
          if (!chosen) {
            callback({});
            return;
          }
          const wantsSystemAudio =
            pendingCapture && (pendingCapture.audioMode === 'system' || pendingCapture.audioMode === 'both');
          callback({
            video: chosen,
            audio: wantsSystemAudio ? 'loopback' : undefined
          });
          pendingCapture = null;
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') callback(true);
    else callback(false);
  });
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  setupDisplayMediaHandler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (cursorInterval) clearInterval(cursorInterval);
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------
ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('win:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow && mainWindow.close());
ipcMain.handle('win:isMaximized', () => (mainWindow ? mainWindow.isMaximized() : false));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, partial) => {
  const merged = { ...readSettings(), ...partial };
  writeSettings(merged);
  if (partial.theme) {
    nativeTheme.themeSource = partial.theme === 'system' ? 'system' : partial.theme;
  }
  return merged;
});

// ---------------------------------------------------------------------------
// Capture sources / displays
// ---------------------------------------------------------------------------
ipcMain.handle('sources:list', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    display_id: s.display_id,
    isScreen: s.id.startsWith('screen'),
    thumbnailDataUrl: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
    appIconDataUrl: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
  }));
});

ipcMain.handle('displays:list', () => {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id
  }));
});

ipcMain.handle('recording:setPendingSource', (_e, data) => {
  pendingCapture = data;
  return true;
});

// ---------------------------------------------------------------------------
// Cursor tracking (pushed to renderer while a recording is active)
// ---------------------------------------------------------------------------
ipcMain.on('cursor:start', (event) => {
  if (cursorInterval) clearInterval(cursorInterval);
  const wc = event.sender;
  cursorInterval = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    if (!wc.isDestroyed()) wc.send('cursor:update', p);
  }, 16);
});

ipcMain.on('cursor:stop', () => {
  if (cursorInterval) {
    clearInterval(cursorInterval);
    cursorInterval = null;
  }
});

// ---------------------------------------------------------------------------
// Generic chunked file streaming (used for both live recording and exports)
// ---------------------------------------------------------------------------
ipcMain.handle('stream:begin', () => {
  const sessionId = crypto.randomUUID();
  const tempPath = path.join(TMP_DIR, `${sessionId}.webm`);
  const stream = fs.createWriteStream(tempPath);
  streamSessions.set(sessionId, { stream, tempPath });
  return { sessionId, tempPath };
});

ipcMain.handle('stream:chunk', (_e, { sessionId, buffer }) => {
  const session = streamSessions.get(sessionId);
  if (!session) return false;
  session.stream.write(Buffer.from(buffer));
  return true;
});

ipcMain.handle('stream:end', async (_e, { sessionId }) => {
  const session = streamSessions.get(sessionId);
  if (!session) return { tempPath: null };
  await new Promise((resolve) => session.stream.end(resolve));
  streamSessions.delete(sessionId);
  return { tempPath: session.tempPath };
});

ipcMain.handle('stream:abort', async (_e, { sessionId }) => {
  const session = streamSessions.get(sessionId);
  if (!session) return true;
  await new Promise((resolve) => session.stream.end(resolve));
  streamSessions.delete(sessionId);
  fs.promises.unlink(session.tempPath).catch(() => {});
  return true;
});

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------
function convertToMp4(inputPath, outputPath, totalDurationSec, onProgress) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .outputOptions(['-preset veryfast', '-crf 20', '-pix_fmt yuv420p', '-movflags +faststart'])
      .audioCodec('aac')
      .audioBitrate('160k')
      .on('progress', (p) => {
        let percent = p.percent;
        if ((percent === undefined || Number.isNaN(percent)) && totalDurationSec) {
          const parts = (p.timemark || '00:00:00').split(':').map(Number);
          const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
          percent = Math.min(99, (sec / totalDurationSec) * 100);
        }
        if (onProgress) onProgress(Math.max(0, Math.min(100, percent || 0)));
      })
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outputPath);
  });
}

function makeThumbnail(inputPath, outputPath, atSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .on('error', () => resolve(false))
      .on('end', () => resolve(true))
      .screenshots({
        timestamps: [Math.max(0, atSeconds)],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x180'
      });
  });
}

function probeDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err || !data || !data.format) resolve(0);
      else resolve(Number(data.format.duration) || 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Recording finalize -> convert temp webm to library mp4 + thumbnail + sidecar
// ---------------------------------------------------------------------------
ipcMain.handle('recording:finalize', async (event, { tempPath, meta }) => {
  const wc = event.sender;
  const id = crypto.randomUUID();
  const baseName = sanitizeFilename(meta.name || `Gravacao ${new Date().toLocaleString('pt-BR')}`);
  let finalName = baseName;
  let counter = 1;
  while (fs.existsSync(path.join(RECORDINGS_DIR, `${finalName}.mp4`))) {
    finalName = `${baseName} (${counter++})`;
  }
  const outputPath = path.join(RECORDINGS_DIR, `${finalName}.mp4`);
  const thumbPath = path.join(RECORDINGS_DIR, `${finalName}.jpg`);
  const jsonPath = path.join(RECORDINGS_DIR, `${finalName}.json`);

  try {
    await convertToMp4(tempPath, outputPath, meta.duration, (percent) => {
      if (!wc.isDestroyed()) wc.send('convert:progress', { percent, stage: 'recording' });
    });
    const duration = (await probeDuration(outputPath)) || meta.duration || 0;
    await makeThumbnail(outputPath, thumbPath, Math.min(1, duration / 2));
    const stats = await fsp.stat(outputPath);

    const record = {
      id,
      name: finalName,
      path: outputPath,
      thumbnail: fs.existsSync(thumbPath) ? thumbPath : null,
      duration,
      size: stats.size,
      createdAt: Date.now(),
      hasAudio: !!meta.hasAudio,
      followCursor: !!meta.followCursor
    };
    await fsp.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf-8');
    fsp.unlink(tempPath).catch(() => {});
    return { success: true, record };
  } catch (err) {
    fsp.unlink(tempPath).catch(() => {});
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
});

// ---------------------------------------------------------------------------
// Recordings library
// ---------------------------------------------------------------------------
ipcMain.handle('recordings:list', async () => {
  ensureDirs();
  const files = await fsp.readdir(RECORDINGS_DIR);
  const records = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(RECORDINGS_DIR, file), 'utf-8');
      const record = JSON.parse(raw);
      if (fs.existsSync(record.path)) records.push(record);
    } catch {
      /* skip corrupt sidecar */
    }
  }
  records.sort((a, b) => b.createdAt - a.createdAt);
  return records;
});

ipcMain.handle('recordings:delete', async (_e, recordId) => {
  return deleteRecordingById(recordId);
});

async function deleteRecordingById(recordId) {
  const files = await fsp.readdir(RECORDINGS_DIR);
  const jsonFile = files.find((f) => f.endsWith('.json'));
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(RECORDINGS_DIR, file), 'utf-8');
      const record = JSON.parse(raw);
      if (record.id === recordId) {
        const base = file.replace(/\.json$/, '');
        for (const ext of ['.mp4', '.jpg', '.json']) {
          await fsp.unlink(path.join(RECORDINGS_DIR, base + ext)).catch(() => {});
        }
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

ipcMain.handle('recordings:rename', async (_e, { id, newName }) => {
  const files = await fsp.readdir(RECORDINGS_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await fsp.readFile(path.join(RECORDINGS_DIR, file), 'utf-8').catch(() => null);
    if (!raw) continue;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      continue;
    }
    if (record.id !== id) continue;

    const oldBase = file.replace(/\.json$/, '');
    const cleanName = sanitizeFilename(newName);
    let finalBase = cleanName;
    let counter = 1;
    while (
      finalBase !== oldBase &&
      fs.existsSync(path.join(RECORDINGS_DIR, `${finalBase}.mp4`))
    ) {
      finalBase = `${cleanName} (${counter++})`;
    }

    for (const ext of ['.mp4', '.jpg', '.json']) {
      const from = path.join(RECORDINGS_DIR, oldBase + ext);
      const to = path.join(RECORDINGS_DIR, finalBase + ext);
      if (fs.existsSync(from)) await fsp.rename(from, to);
    }

    record.name = finalBase;
    record.path = path.join(RECORDINGS_DIR, finalBase + '.mp4');
    record.thumbnail = fs.existsSync(path.join(RECORDINGS_DIR, finalBase + '.jpg'))
      ? path.join(RECORDINGS_DIR, finalBase + '.jpg')
      : null;
    await fsp.writeFile(path.join(RECORDINGS_DIR, finalBase + '.json'), JSON.stringify(record, null, 2), 'utf-8');
    return { success: true, record };
  }
  return { success: false };
});

ipcMain.handle('recordings:reveal', (_e, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('app:getRecordingsDir', () => RECORDINGS_DIR);
ipcMain.handle('app:openRecordingsDir', async () => {
  ensureDirs();
  const err = await shell.openPath(RECORDINGS_DIR);
  return !err;
});

// ---------------------------------------------------------------------------
// Import video (editor)
// ---------------------------------------------------------------------------
ipcMain.handle('dialog:openVideo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar vídeo',
    properties: ['openFile'],
    filters: [{ name: 'Vídeos', extensions: ['mp4', 'webm', 'mov', 'mkv'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const duration = await probeDuration(filePath);
  return { path: filePath, name: path.basename(filePath, path.extname(filePath)), duration };
});

// ---------------------------------------------------------------------------
// Export finalize -> convert temp webm to a user-chosen mp4 destination
// ---------------------------------------------------------------------------
ipcMain.handle('export:finalize', async (event, { tempPath, suggestedName, duration }) => {
  const wc = event.sender;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar vídeo editado',
    defaultPath: path.join(app.getPath('videos'), sanitizeFilename(suggestedName || 'video-editado') + '.mp4'),
    filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }]
  });
  if (result.canceled || !result.filePath) {
    fsp.unlink(tempPath).catch(() => {});
    return { success: false, canceled: true };
  }
  try {
    await convertToMp4(tempPath, result.filePath, duration, (percent) => {
      if (!wc.isDestroyed()) wc.send('convert:progress', { percent, stage: 'export' });
    });
    fsp.unlink(tempPath).catch(() => {});
    return { success: true, path: result.filePath };
  } catch (err) {
    fsp.unlink(tempPath).catch(() => {});
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
});
