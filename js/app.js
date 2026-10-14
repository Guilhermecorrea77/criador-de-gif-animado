// Criador de GIF Animado — aplicação principal (JavaScript puro, sem build)
import { buildSequence, drawSeqItem, outputSize, renderFrame, gifDelay } from './render.js';
import { encodeGif } from './encoder.js';
import { extractFrames } from './video.js';

const MAX_FRAMES = 60;
const MAX_SIDE = 1600; // imagens maiores são reduzidas ao importar (economiza memória)
const STORAGE_KEY = 'gif-maker:settings:v1';

const DEFAULTS = {
  fps: 5,
  loop: 0,
  boomerang: false,
  reverse: false,
  aspect: 'original',
  width: 480,
  fit: 'cover',
  bg: '#000000',
  filter: 'none',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  text: { content: '', position: 'bottom', size: 9, color: '#ffffff', outline: true },
  transition: 'none',
  transitionMs: 300,
  transitionSteps: 4,
  quality: 'medium',
  dither: false,
};

// ---------------------------------------------------------------- utilidades
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const nf = (n, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = () => new Promise((r) => setTimeout(r, 0));

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${nf(b / 1024, 0)} KB`;
  return `${nf(b / 1024 / 1024, 2)} MB`;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('is-error', isError);
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) return { ...DEFAULTS, ...saved, text: { ...DEFAULTS.text, ...saved.text } };
  } catch { /* armazenamento indisponível */ }
  return structuredClone(DEFAULTS);
}
function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch { /* ignora */ }
}

// ---------------------------------------------------------------- estado
const state = {
  frames: [], // { id, url, img, name, crop, delay }
  settings: loadSettings(),
  selectedId: null,
  cache: [], // canvases renderizados no tamanho final (mesma ordem de frames)
  size: { W: 480, H: 480 },
  seq: [],
  renderToken: 0,
  dirty: true,
  playing: true,
  encoding: null,
  lastGif: null, // { blob, url }
};

// ---------------------------------------------------------------- importação
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = url;
  });
}

async function blobToFrame(blob, name) {
  let url = URL.createObjectURL(blob);
  let img = await loadImage(url);
  const big = Math.max(img.naturalWidth, img.naturalHeight);
  if (big > MAX_SIDE) {
    const k = MAX_SIDE / big;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const small = await new Promise((r) => c.toBlob(r, type, 0.92));
    URL.revokeObjectURL(url);
    url = URL.createObjectURL(small);
    img = await loadImage(url);
  }
  return { id: uid(), url, img, name, crop: null, delay: null };
}

async function addBlobs(blobs, { silent = false } = {}) {
  const room = MAX_FRAMES - state.frames.length;
  if (room <= 0) {
    toast(`Limite de ${MAX_FRAMES} quadros atingido.`, true);
    return 0;
  }
  const list = blobs.slice(0, room);
  let ok = 0;
  for (const b of list) {
    try {
      state.frames.push(await blobToFrame(b, b.name || 'quadro'));
      ok++;
    } catch {
      /* arquivo ignorado */
    }
  }
  if (!silent) {
    if (blobs.length > room) toast(`Somente ${room} quadro(s) adicionados (limite de ${MAX_FRAMES}).`);
    else if (ok < list.length) toast('Alguns arquivos não puderam ser lidos.', true);
  }
  if (ok) {
    showEditor();
    onFramesChanged();
  }
  return ok;
}

function imageFilesFrom(listLike) {
  return [...(listLike || [])].filter((f) => f && f.type && f.type.startsWith('image/'));
}

// ---------------------------------------------------------------- telas
function showEditor() {
  $('#viewUpload').hidden = true;
  $('#viewEditor').hidden = false;
  $('#btnReset').hidden = false;
}

function showUpload() {
  $('#viewUpload').hidden = false;
  $('#viewEditor').hidden = true;
  $('#btnReset').hidden = true;
}

function resetAll() {
  state.encoding?.abort();
  state.frames.forEach((f) => URL.revokeObjectURL(f.url));
  state.frames = [];
  state.cache = [];
  state.selectedId = null;
  if (state.lastGif) URL.revokeObjectURL(state.lastGif.url);
  state.lastGif = null;
  $('#fileInput').value = '';
  showUpload();
  renderFrameList();
}

// ---------------------------------------------------------------- renderização
function onFramesChanged() {
  renderFrameList();
  invalidate(true);
}

let renderTimer;
function invalidate(immediate = false) {
  state.dirty = true;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, immediate ? 0 : 90);
  updateSummary();
}

async function renderAll() {
  const token = ++state.renderToken;
  const s = state.settings;
  const frames = state.frames.slice();
  if (!frames.length) return;

  const { W, H } = outputSize(frames, s);
  state.size = { W, H };
  const prev = state.cache;
  const next = [];
  const t0 = performance.now();
  for (let i = 0; i < frames.length; i++) {
    next[i] = renderFrame(frames[i], W, H, s, prev[i]);
    // cede a vez à interface a cada ~30 ms em listas grandes
    if (performance.now() - t0 > 30 && i % 4 === 3) {
      await sleep();
      if (token !== state.renderToken) return;
    }
  }
  if (token !== state.renderToken) return;
  state.cache = next;
  state.seq = buildSequence(frames, s);
  state.dirty = false;

  const pc = $('#previewCanvas');
  if (pc.width !== W || pc.height !== H) {
    pc.width = W;
    pc.height = H;
  }
  player.restartIfOut();
  drawThumbs();
  updateSummary();
}

function ensureRendered() {
  if (!state.dirty) return Promise.resolve();
  clearTimeout(renderTimer);
  return renderAll();
}

// ---------------------------------------------------------------- player
const player = {
  i: 0,
  acc: 0,
  last: 0,
  raf: 0,
  start() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      const seq = state.seq;
      if (!seq.length) return;
      if (state.playing) {
        this.acc += now - this.last;
        let guard = 0;
        while (this.acc >= gifDelay(seq[this.i % seq.length].delay) && guard++ < 50) {
          this.acc -= gifDelay(seq[this.i % seq.length].delay);
          this.i = (this.i + 1) % seq.length;
        }
      }
      this.last = now;
      this.draw();
    };
    this.raf = requestAnimationFrame(tick);
  },
  draw() {
    const seq = state.seq;
    if (!seq.length) return;
    const item = seq[this.i % seq.length];
    const ctx = $('#previewCanvas').getContext('2d');
    drawSeqItem(ctx, item, state.cache);
    const frameNum = item.a + 1;
    $('#previewFrame').textContent = `${frameNum}/${state.frames.length}`;
  },
  restartIfOut() {
    if (this.i >= state.seq.length) this.i = 0;
    this.acc = 0;
  },
  showFrame(index) {
    const k = state.seq.findIndex((it) => it.a === index && it.b === null);
    if (k >= 0) {
      this.i = k;
      this.acc = 0;
    }
  },
};

function setPlaying(on) {
  state.playing = on;
  const b = $('#btnPlay');
  b.classList.toggle('is-paused', !on);
  b.setAttribute('aria-label', on ? 'Pausar' : 'Reproduzir');
}

// ---------------------------------------------------------------- lista de quadros
function renderFrameList() {
  const list = $('#frameList');
  list.textContent = '';
  const frag = document.createDocumentFragment();

  state.frames.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'frame' + (f.id === state.selectedId ? ' is-selected' : '');
    li.dataset.id = f.id;
    li.draggable = true;
    li.tabIndex = 0;
    li.setAttribute('aria-label', `Quadro ${i + 1}`);
    const c = document.createElement('canvas');
    li.append(c);
    const num = document.createElement('span');
    num.className = 'frame__num';
    num.textContent = i + 1;
    li.append(num);
    if (f.delay) {
      const b = document.createElement('span');
      b.className = 'frame__badge';
      b.textContent = `${f.delay}ms`;
      li.append(b);
    }
    if (f.crop) {
      const b = document.createElement('span');
      b.className = 'frame__badge frame__badge--crop';
      b.textContent = '✂';
      b.title = 'Recortado';
      li.append(b);
    }
    frag.append(li);
  });

  if (state.frames.length < MAX_FRAMES) {
    const add = document.createElement('li');
    add.innerHTML = `<button class="frame__add" type="button" aria-label="Adicionar imagens"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
    frag.append(add);
  }
  list.append(frag);
  $('#frameCount').textContent = state.frames.length;
  updateFrameTools();
  drawThumbs();
}

function drawThumbs() {
  const items = $$('#frameList .frame');
  items.forEach((li, i) => {
    const src = state.cache[i];
    const c = li.querySelector('canvas');
    if (!src || !c) return;
    const k = 160 / Math.max(src.width, src.height);
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  });
}

function selectedIndex() {
  return state.frames.findIndex((f) => f.id === state.selectedId);
}

function updateFrameTools() {
  const idx = selectedIndex();
  const box = $('#frameTools');
  box.hidden = idx < 0;
  if (idx < 0) return;
  const f = state.frames[idx];
  $('#frameToolsLabel').textContent = `Quadro ${idx + 1} de ${state.frames.length}`;
  $('[data-act="left"]', box).disabled = idx === 0;
  $('[data-act="right"]', box).disabled = idx === state.frames.length - 1;
  $('[data-act="dup"]', box).disabled = state.frames.length >= MAX_FRAMES;
  const di = $('#frameDelay');
  if (document.activeElement !== di) di.value = f.delay ?? '';
  di.placeholder = String(Math.round(1000 / state.settings.fps));
}

function selectFrame(id) {
  state.selectedId = state.selectedId === id ? null : id;
  $$('#frameList .frame').forEach((li) => li.classList.toggle('is-selected', li.dataset.id === state.selectedId));
  updateFrameTools();
  const idx = selectedIndex();
  if (idx >= 0) {
    setPlaying(false);
    player.showFrame(idx);
  }
}

function moveFrame(from, to) {
  if (to < 0 || to >= state.frames.length || from === to) return;
  const [f] = state.frames.splice(from, 1);
  state.frames.splice(to, 0, f);
  const [c] = state.cache.splice(from, 1);
  state.cache.splice(to, 0, c);
  onFramesChanged();
}

function frameAction(act) {
  const idx = selectedIndex();
  if (idx < 0) return;
  const f = state.frames[idx];
  switch (act) {
    case 'left': moveFrame(idx, idx - 1); break;
    case 'right': moveFrame(idx, idx + 1); break;
    case 'dup': {
      if (state.frames.length >= MAX_FRAMES) return;
      const copy = { ...f, id: uid(), crop: f.crop ? { ...f.crop } : null, _cropCache: null, _cropKey: null };
      state.frames.splice(idx + 1, 0, copy);
      state.cache.splice(idx + 1, 0, undefined);
      state.selectedId = copy.id;
      onFramesChanged();
      break;
    }
    case 'remove': {
      const stillUsed = state.frames.some((o) => o !== f && o.url === f.url);
      if (!stillUsed) URL.revokeObjectURL(f.url);
      state.frames.splice(idx, 1);
      state.cache.splice(idx, 1);
      const nextSel = state.frames[idx] || state.frames[idx - 1];
      state.selectedId = nextSel ? nextSel.id : null;
      if (!state.frames.length) { resetAll(); return; }
      onFramesChanged();
      break;
    }
    case 'crop': openCrop(f); break;
  }
}

// Arrastar para reordenar (desktop)
let dragId = null;
function bindFrameList() {
  const list = $('#frameList');

  list.addEventListener('click', (e) => {
    if (e.target.closest('.frame__add')) { $('#addInput').click(); return; }
    const li = e.target.closest('.frame');
    if (li) selectFrame(li.dataset.id);
  });
  list.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.frame');
    if (!li) return;
    state.selectedId = li.dataset.id;
    renderFrameList();
    frameAction('crop');
  });
  list.addEventListener('keydown', (e) => {
    const li = e.target.closest('.frame');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectFrame(li.dataset.id); }
  });

  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.frame');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const li = e.target.closest('.frame');
    e.preventDefault();
    $$('.frame.is-drop-target', list).forEach((x) => x !== li && x.classList.remove('is-drop-target'));
    if (li && li.dataset.id !== dragId) li.classList.add('is-drop-target');
  });
  list.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    const li = e.target.closest('.frame');
    const from = state.frames.findIndex((f) => f.id === dragId);
    const to = li ? state.frames.findIndex((f) => f.id === li.dataset.id) : state.frames.length - 1;
    dragId = null;
    moveFrame(from, to);
  });
  list.addEventListener('dragend', () => {
    dragId = null;
    $$('.frame', list).forEach((x) => x.classList.remove('is-dragging', 'is-drop-target'));
  });

  $('#frameTools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) frameAction(b.dataset.act);
  });

  const di = $('#frameDelay');
  di.addEventListener('change', () => {
    const f = state.frames[selectedIndex()];
    if (!f) return;
    const v = parseInt(di.value, 10);
    f.delay = Number.isFinite(v) && v > 0 ? Math.min(10000, Math.max(20, v)) : null;
    di.value = f.delay ?? '';
    renderFrameList();
    invalidate();
  });
}

// ---------------------------------------------------------------- configurações
function bindRange(id, key, fmt, transform = Number) {
  const el = $('#' + id);
  const out = $('#' + id + 'Out');
  const get = () => key.split('.').reduce((o, k) => o[k], state.settings);
  const set = (v) => {
    const parts = key.split('.');
    const last = parts.pop();
    parts.reduce((o, k) => o[k], state.settings)[last] = v;
  };
  el.value = get();
  if (out) out.textContent = fmt(get());
  el.addEventListener('input', () => {
    set(transform(el.value));
    if (out) out.textContent = fmt(get());
    onSettingsChanged();
  });
}

function bindToggleGroup(id, key, after) {
  const root = $('#' + id);
  const paint = () => $$('button', root).forEach((b) => {
    const on = b.dataset.v === String(state.settings[key]);
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on);
  });
  paint();
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    state.settings[key] = b.dataset.v;
    paint();
    after?.();
    onSettingsChanged();
  });
  return paint;
}

function bindCheck(id, key, after) {
  const el = $('#' + id);
  const parts = key.split('.');
  const obj = () => parts.slice(0, -1).reduce((o, k) => o[k], state.settings);
  const last = parts.at(-1);
  el.checked = !!obj()[last];
  el.addEventListener('change', () => {
    obj()[last] = el.checked;
    after?.();
    onSettingsChanged();
  });
}

function onSettingsChanged() {
  saveSettings();
  updateFrameTools();
  invalidate();
}

function updateConditional() {
  const s = state.settings;
  $$('[data-fade-only]').forEach((el) => (el.hidden = s.transition !== 'fade'));
}

const paints = {};
function bindSettings() {
  const s = state.settings;
  bindRange('fps', 'fps', (v) => `${nf(v)} qps · ${Math.round(1000 / v)} ms`);
  bindRange('brightness', 'brightness', (v) => (v > 0 ? '+' : '') + v);
  bindRange('contrast', 'contrast', (v) => (v > 0 ? '+' : '') + v);
  bindRange('saturation', 'saturation', (v) => (v > 0 ? '+' : '') + v);
  bindRange('textSize', 'text.size', (v) => `${nf(v)}%`);
  bindRange('transitionMs', 'transitionMs', (v) => `${v} ms`);
  bindRange('transitionSteps', 'transitionSteps', (v) => `${v} quadros`);

  const loop = $('#loop');
  loop.value = String(s.loop);
  loop.addEventListener('change', () => { s.loop = +loop.value; onSettingsChanged(); });

  const width = $('#width');
  width.value = String(s.width);
  if (!width.value) { width.value = '480'; s.width = 480; }
  width.addEventListener('change', () => { s.width = +width.value; onSettingsChanged(); });

  bindCheck('boomerang', 'boomerang');
  bindCheck('reverse', 'reverse');
  bindCheck('dither', 'dither');
  bindCheck('textOutline', 'text.outline');

  paints.aspect = bindToggleGroup('aspectChips', 'aspect');
  paints.fit = bindToggleGroup('fitSeg', 'fit', updateConditional);
  paints.filter = bindToggleGroup('filterChips', 'filter');
  paints.transition = bindToggleGroup('transitionSeg', 'transition', updateConditional);
  paints.quality = bindToggleGroup('qualitySeg', 'quality');

  // posição do texto fica em settings.text.position
  const tp = $('#textPosSeg');
  const paintTp = () => $$('button', tp).forEach((b) => b.classList.toggle('is-active', b.dataset.v === s.text.position));
  paintTp();
  tp.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    s.text.position = b.dataset.v;
    paintTp();
    onSettingsChanged();
  });

  const bg = $('#bg');
  bg.value = s.bg;
  bg.addEventListener('input', () => { s.bg = bg.value; onSettingsChanged(); });

  const tc = $('#textColor');
  tc.value = s.text.color;
  tc.addEventListener('input', () => { s.text.color = tc.value; onSettingsChanged(); });

  const tx = $('#textContent');
  tx.value = s.text.content;
  tx.addEventListener('input', () => { s.text.content = tx.value; onSettingsChanged(); });

  $('#btnResetFilters').addEventListener('click', () => {
    Object.assign(s, { filter: 'none', brightness: 0, contrast: 0, saturation: 0 });
    for (const id of ['brightness', 'contrast', 'saturation']) {
      $('#' + id).value = 0;
      $('#' + id + 'Out').textContent = '0';
    }
    paints.filter();
    onSettingsChanged();
  });

  updateConditional();
}

function totalDuration(seq) {
  return seq.reduce((a, it) => a + gifDelay(it.delay), 0);
}

function updateSummary() {
  const el = $('#genSummary');
  if (!state.frames.length) { el.textContent = ''; return; }
  const seq = buildSequence(state.frames, state.settings);
  const { W, H } = outputSize(state.frames, state.settings);
  const dur = totalDuration(seq) / 1000;
  const info = `${W}×${H} px · ${seq.length} quadros · ${nf(dur, 1)} s`;
  $('#previewInfo').textContent = info;
  $('#sizeOut').textContent = `${W}×${H}`;
  const heavy = seq.length * W * H > 90e6;
  el.textContent = heavy ? `${info} · arquivo grande, pode demorar` : info;
  el.classList.toggle('is-warn', heavy);
  $('#btnGenerate').disabled = state.frames.length < 2 || !!state.encoding;
  $('#btnGenerate').title = state.frames.length < 2 ? 'Adicione pelo menos 2 quadros' : '';
}

// ---------------------------------------------------------------- geração
async function generate() {
  if (state.frames.length < 2 || state.encoding) return;
  const btn = $('#btnGenerate');
  const prog = $('#progress');
  btn.disabled = true;
  prog.hidden = false;
  $('#progressBar').style.width = '0%';
  $('#progressText').textContent = 'Preparando quadros…';
  setPlaying(false);

  try {
    await ensureRendered();
    const { W, H } = state.size;
    const job = encodeGif({
      seq: state.seq,
      cache: state.cache,
      W, H,
      settings: state.settings,
      onProgress: (p) => {
        $('#progressBar').style.width = `${Math.round(p * 100)}%`;
        $('#progressText').textContent = `Gerando… ${Math.round(p * 100)}%`;
      },
    });
    state.encoding = job;
    const blob = await job.promise;
    if (state.lastGif) URL.revokeObjectURL(state.lastGif.url);
    state.lastGif = { blob, url: URL.createObjectURL(blob), W, H, frames: state.seq.length, dur: totalDuration(state.seq) };
    showResult();
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error(err);
      toast('Não foi possível gerar o GIF. Tente uma largura menor.', true);
    } else toast('Geração cancelada.');
  } finally {
    state.encoding = null;
    prog.hidden = true;
    setPlaying(true);
    updateSummary();
  }
}

function showResult() {
  const g = state.lastGif;
  $('#resultImg').src = g.url;
  $('#resultMeta').innerHTML = [
    ['Tamanho', formatBytes(g.blob.size)],
    ['Dimensões', `${g.W}×${g.H}`],
    ['Quadros', g.frames],
    ['Duração', `${nf(g.dur / 1000, 1)} s`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  const file = new File([g.blob], fileName(), { type: 'image/gif' });
  $('#btnShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  $('#resultModal').showModal();
}

function fileName() {
  const raw = ($('#fileName').value || 'meu-gif').trim().replace(/\.gif$/i, '');
  const safe = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
  return (safe || 'meu-gif') + '.gif';
}

function download() {
  const g = state.lastGif;
  if (!g) return;
  const a = document.createElement('a');
  a.href = g.url;
  a.download = fileName();
  document.body.append(a);
  a.click();
  a.remove();
}

async function share() {
  const g = state.lastGif;
  if (!g) return;
  try {
    await navigator.share({ files: [new File([g.blob], fileName(), { type: 'image/gif' })], title: 'Meu GIF' });
  } catch (e) {
    if (e.name !== 'AbortError') toast('Não foi possível compartilhar.', true);
  }
}

// ---------------------------------------------------------------- recorte
const cropState = { cropper: null, frame: null, aspect: 'free' };

function openCrop(frame) {
  /* global Cropper */
  if (typeof Cropper === 'undefined') { toast('Editor de recorte não carregou.', true); return; }
  cropState.frame = frame;
  const modal = $('#cropModal');
  const img = $('#cropImg');
  modal.showModal();
  img.onload = () => {
    cropState.cropper?.destroy();
    cropState.cropper = new Cropper(img, {
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      background: false,
      responsive: true,
      toggleDragModeOnDblclick: false,
      ready() {
        const c = frame.crop;
        if (!c) return applyCropAspect(cropState.aspect);
        const cr = cropState.cropper;
        cr.rotateTo(c.rotate || 0);
        cr.scaleX(c.scaleX || 1);
        cr.scaleY(c.scaleY || 1);
        const { rw, rh } = rotatedDims(cr);
        cr.setAspectRatio(NaN);
        cr.setData({ x: c.rx * rw, y: c.ry * rh, width: c.rw * rw, height: c.rh * rh });
        paintCropAspect('free');
      },
    });
  };
  img.src = frame.url;
}

function rotatedDims(cr) {
  const d = cr.getImageData();
  const rot = ((cr.getData().rotate || 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  return swap ? { rw: d.naturalHeight, rh: d.naturalWidth } : { rw: d.naturalWidth, rh: d.naturalHeight };
}

function paintCropAspect(v) {
  cropState.aspect = v;
  $$('#cropAspect button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === v));
}

function applyCropAspect(v) {
  const cr = cropState.cropper;
  if (!cr) return;
  paintCropAspect(v);
  let ratio = NaN;
  if (v === 'output') {
    const { W, H } = outputSize(state.frames, state.settings);
    ratio = state.settings.aspect === 'original' ? NaN : W / H;
  } else if (v !== 'free') ratio = parseFloat(v);
  cr.setAspectRatio(ratio);
}

function readCrop() {
  const cr = cropState.cropper;
  const d = cr.getData();
  const { rw, rh } = rotatedDims(cr);
  return {
    rx: Math.max(0, d.x / rw),
    ry: Math.max(0, d.y / rh),
    rw: Math.min(1, d.width / rw),
    rh: Math.min(1, d.height / rh),
    rotate: ((d.rotate || 0) % 360 + 360) % 360,
    scaleX: d.scaleX || 1,
    scaleY: d.scaleY || 1,
  };
}

function closeCrop() {
  cropState.cropper?.destroy();
  cropState.cropper = null;
  cropState.frame = null;
  $('#cropModal').close();
}

function bindCrop() {
  $('#cropAspect').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) applyCropAspect(b.dataset.v);
  });
  $('.crop__icons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-crop]');
    const cr = cropState.cropper;
    if (!b || !cr) return;
    if (b.dataset.crop === 'rotL') cr.rotate(-90);
    if (b.dataset.crop === 'rotR') cr.rotate(90);
    if (b.dataset.crop === 'flipH') cr.scaleX(-(cr.getData().scaleX || 1));
  });
  $('#btnCropSave').addEventListener('click', () => {
    if (!cropState.cropper) return;
    cropState.frame.crop = readCrop();
    closeCrop();
    onFramesChanged();
  });
  $('#btnCropAll').addEventListener('click', () => {
    if (!cropState.cropper) return;
    const c = readCrop();
    state.frames.forEach((f) => (f.crop = { ...c }));
    closeCrop();
    onFramesChanged();
    toast('Recorte aplicado em todos os quadros.');
  });
  $('#btnCropClear').addEventListener('click', () => {
    if (!cropState.frame) return;
    cropState.frame.crop = null;
    closeCrop();
    onFramesChanged();
  });
  $('#cropModal').addEventListener('close', () => {
    cropState.cropper?.destroy();
    cropState.cropper = null;
  });
}

// ---------------------------------------------------------------- vídeo
const videoState = { url: null, abort: null };
const fmtTime = (t) => `${nf(t, 2)} s`;

function openVideo(file) {
  const modal = $('#videoModal');
  const v = $('#videoEl');
  if (videoState.url) URL.revokeObjectURL(videoState.url);
  videoState.url = URL.createObjectURL(file);
  v.src = videoState.url;
  $('#videoProgress').hidden = true;
  $('#btnExtract').disabled = true;
  modal.showModal();

  v.onloadedmetadata = () => {
    if (!Number.isFinite(v.duration) || v.duration <= 0) {
      toast('Não foi possível ler a duração deste vídeo.', true);
      return;
    }
    const s = $('#vStart'), e = $('#vEnd');
    s.max = e.max = v.duration.toFixed(2);
    s.value = 0;
    e.value = Math.min(v.duration, 4).toFixed(2);
    $('#btnExtract').disabled = false;
    updateVideoHint();
  };
  v.onerror = () => toast('Formato de vídeo não suportado por este navegador.', true);
}

function videoParams() {
  let start = +$('#vStart').value;
  let end = +$('#vEnd').value;
  if (end < start) [start, end] = [end, start];
  const fps = +$('#vFps').value;
  const room = MAX_FRAMES - state.frames.length;
  const count = Math.min(room, Math.floor((end - start) * fps) + 1);
  return { start, end, fps, count, room };
}

function updateVideoHint() {
  const { start, end, fps, count, room } = videoParams();
  $('#vStartOut').textContent = fmtTime(start);
  $('#vEndOut').textContent = fmtTime(end);
  $('#vFpsOut').textContent = `${fps} qps`;
  const want = Math.floor((end - start) * fps) + 1;
  let msg = `Serão extraídos ${count} quadro(s) de ${nf(end - start, 2)} s.`;
  if (want > room) msg += ` Limite de ${MAX_FRAMES} quadros: diminua o trecho ou os quadros por segundo.`;
  $('#videoHint').textContent = msg;
  $('#btnExtract').disabled = count < 1;
}

function bindVideo() {
  const pick = () => $('#videoInput').click();
  $('#btnVideo').addEventListener('click', pick);
  $('#btnAddVideo').addEventListener('click', pick);
  $('#videoInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) openVideo(f);
  });
  for (const id of ['vStart', 'vEnd', 'vFps']) $('#' + id).addEventListener('input', () => {
    updateVideoHint();
    if (id !== 'vFps') $('#videoEl').currentTime = +$('#' + id).value;
  });
  $('#videoModal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mark]');
    if (!b) return;
    const t = $('#videoEl').currentTime.toFixed(2);
    $(b.dataset.mark === 'start' ? '#vStart' : '#vEnd').value = t;
    updateVideoHint();
  });
  $('#btnExtract').addEventListener('click', async () => {
    const v = $('#videoEl');
    const { start, end, fps, room } = videoParams();
    const ctrl = new AbortController();
    videoState.abort = ctrl;
    $('#btnExtract').disabled = true;
    $('#videoProgress').hidden = false;
    try {
      const blobs = await extractFrames(v, {
        start, end, fps, maxFrames: room, signal: ctrl.signal,
        onProgress: (p) => ($('#videoProgressBar').style.width = `${Math.round(p * 100)}%`),
      });
      blobs.forEach((b, i) => (b.name = `video-${i + 1}.jpg`));
      $('#videoModal').close();
      const wasEmpty = state.frames.length === 0;
      const n = await addBlobs(blobs, { silent: true });
      if (wasEmpty) {
        // mantém a velocidade real do vídeo
        state.settings.fps = fps;
        $('#fps').value = fps;
        $('#fpsOut').textContent = `${nf(fps)} qps · ${Math.round(1000 / fps)} ms`;
        onSettingsChanged();
      }
      toast(`${n} quadro(s) extraído(s) do vídeo.`);
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message || 'Falha ao extrair quadros.', true);
    } finally {
      videoState.abort = null;
      $('#btnExtract').disabled = false;
      $('#videoProgress').hidden = true;
    }
  });
  $('#videoModal').addEventListener('close', () => {
    videoState.abort?.abort();
    const v = $('#videoEl');
    v.pause();
    v.removeAttribute('src');
    v.load();
    if (videoState.url) URL.revokeObjectURL(videoState.url);
    videoState.url = null;
  });
}

// ---------------------------------------------------------------- exemplo
async function makeSample() {
  const blobs = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const c = document.createElement('canvas');
    c.width = c.height = 480;
    const ctx = c.getContext('2d');
    const hue = (i / N) * 360;
    const g = ctx.createLinearGradient(0, 0, 480, 480);
    g.addColorStop(0, `hsl(${hue} 80% 60%)`);
    g.addColorStop(1, `hsl(${(hue + 60) % 360} 80% 35%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 480, 480);
    const t = i / N;
    const y = 120 + Math.abs(Math.sin(t * Math.PI)) * -60 + 200 * (1 - Math.abs(Math.sin(t * Math.PI)));
    ctx.fillStyle = 'rgb(255 255 255 / .92)';
    ctx.beginPath();
    ctx.arc(240, y, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(0 0 0 / .18)';
    ctx.beginPath();
    ctx.ellipse(240, 420, 70 - (420 - y) / 8, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    blob.name = `exemplo-${i + 1}.png`;
    blobs.push(blob);
  }
  await addBlobs(blobs);
}

// ---------------------------------------------------------------- eventos globais
function bindGlobal() {
  $('#fileInput').addEventListener('change', (e) => { addBlobs(imageFilesFrom(e.target.files)); e.target.value = ''; });
  $('#addInput').addEventListener('change', (e) => { addBlobs(imageFilesFrom(e.target.files)); e.target.value = ''; });
  $('#btnSample').addEventListener('click', makeSample);
  $('#btnReset').addEventListener('click', () => {
    if (state.frames.length && !confirmReset()) return;
    resetAll();
  });
  $('#btnPlay').addEventListener('click', () => setPlaying(!state.playing));
  $('#btnGenerate').addEventListener('click', generate);
  $('#btnCancel').addEventListener('click', () => state.encoding?.abort());
  $('#btnDownload').addEventListener('click', download);
  $('#btnShare').addEventListener('click', share);

  // fechar modais
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) d.close();
      else if (e.target === d) d.close(); // clique fora da caixa
    });
  });

  // arrastar e soltar arquivos em qualquer lugar da página
  const dz = $('#dropzone');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    dz.classList.add('is-over');
  });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; dz.classList.remove('is-over'); } });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    depth = 0;
    dz.classList.remove('is-over');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    const video = files.find((f) => f.type.startsWith('video/'));
    const imgs = imageFilesFrom(files);
    if (imgs.length) addBlobs(imgs);
    else if (video) openVideo(video);
  });

  // colar (Ctrl+V)
  window.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.items || [])]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      addBlobs(files);
    }
  });

  // atalhos de teclado
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || $('#viewEditor').hidden) return;
    if (e.key === ' ' && !e.target.closest('button, .frame')) { e.preventDefault(); setPlaying(!state.playing); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) { e.preventDefault(); frameAction('remove'); }
    if (e.key === 'Escape' && state.selectedId) selectFrame(state.selectedId);
  });
}

function confirmReset() {
  // window.confirm é simples e funciona em todos os navegadores
  return window.confirm('Descartar todos os quadros e começar de novo?');
}

// ---------------------------------------------------------------- início
function init() {
  $('[data-max]').textContent = MAX_FRAMES;
  bindSettings();
  bindFrameList();
  bindCrop();
  bindVideo();
  bindGlobal();
  setPlaying(true);
  player.start();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
