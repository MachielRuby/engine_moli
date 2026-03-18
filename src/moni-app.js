import { createMatcher } from './match/create-matcher.js';
import { ModelOverlay } from './render/model-overlay.js';

const elements = {
  video: document.getElementById('cameraPreview'),
  captureCanvas: document.getElementById('captureCanvas'),
  guideCanvas: document.getElementById('guideCanvas'),
  overlayCanvas: document.getElementById('overlay3d'),
  info: document.getElementById('info'),
  statusText: document.getElementById('statusText'),
  matcherMode: document.getElementById('matcherMode'),
  matchScore: document.getElementById('matchScore'),
  targetText: document.getElementById('targetText'),
  debugText: document.getElementById('debugText'),
  startButton: document.getElementById('startCameraButton'),
  scanButton: document.getElementById('scanNowButton'),
  autoButton: document.getElementById('toggleAutoButton'),
};

const state = {
  stream: null,
  matcher: null,
  overlay: null,
  autoScan: true,
  busy: false,
  misses: 0,
  intervalId: null,
  matcherInfo: null,
};

boot().catch((error) => {
  console.error(error);
  setStatus(`初始化失败: ${error.message}`, 'error');
});

async function boot() {
  state.matcher = createMatcher();
  state.matcherInfo = await state.matcher.init();
  elements.matcherMode.textContent = state.matcherInfo.mode.toUpperCase();

  state.overlay = new ModelOverlay({ canvas: elements.overlayCanvas });
  syncViewport();
  window.addEventListener('resize', syncViewport);
  window.addEventListener('orientationchange', syncViewport);

  elements.startButton.addEventListener('click', () => {
    void startCamera();
  });
  elements.scanButton.addEventListener('click', () => {
    void runMatchCycle({ reason: 'manual' });
  });
  elements.autoButton.addEventListener('click', toggleAutoScan);

  setStatus('Matcher 已准备，点击开始摄像头。', 'neutral');
  updateButtons();
}

async function startCamera() {
  if (state.stream) {
    return;
  }

  setStatus('正在打开摄像头...', 'neutral');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    state.stream = stream;
    elements.video.srcObject = state.stream;
    await elements.video.play();
    await waitForMetadata(elements.video);

    syncViewport();
    startAutoLoop();
    updateButtons();
    setStatus('摄像头已启动，等待采样匹配。', 'success');
  } catch (error) {
    state.stream = null;
    elements.video.srcObject = null;
    updateButtons();
    setStatus(`打开摄像头失败: ${formatErrorMessage(error)}`, 'error');
  }
}

function startAutoLoop() {
  stopAutoLoop();

  state.intervalId = window.setInterval(() => {
    if (state.autoScan) {
      void runMatchCycle({ reason: 'auto' });
    }
  }, 900);
}

function stopAutoLoop() {
  if (state.intervalId) {
    window.clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

function toggleAutoScan() {
  state.autoScan = !state.autoScan;
  elements.autoButton.textContent = state.autoScan ? '自动识别: 开' : '自动识别: 关';

  if (state.autoScan) {
    setStatus('自动识别已开启。', 'neutral');
  } else {
    setStatus('自动识别已关闭，可手动点一次识别。', 'neutral');
  }
}

async function runMatchCycle(options = {}) {
  if (!state.stream || state.busy || elements.video.readyState < 2) {
    return;
  }

  state.busy = true;
  elements.scanButton.disabled = true;
  setStatus(options.reason === 'manual' ? '正在手动识别...' : '正在采样识别...', 'neutral');

  try {
    const frame = await captureFrame();
    const matchResult = await state.matcher.matchFrame(frame);
    const viewportResult = remapMatchToViewport(matchResult, frame);
    await handleMatchResult(viewportResult);
  } catch (error) {
    console.error(error);
    setStatus(`识别失败: ${error.message}`, 'error');
  } finally {
    state.busy = false;
    updateButtons();
  }
}

async function handleMatchResult(result) {
  if (!result.matched) {
    state.misses += 1;
    elements.targetText.textContent = '未命中';
    elements.matchScore.textContent = `${Math.round(result.score * 100)}%`;
    elements.debugText.textContent = formatDebug(result.debug);

    if (state.misses >= 2) {
      state.overlay.hide();
      clearGuide();
      setStatus('当前帧未匹配到目标图。', 'neutral');
    } else {
      setStatus('本次未命中，暂时保留上一次结果。', 'neutral');
    }

    return;
  }

  state.misses = 0;
  elements.targetText.textContent = result.targetName || result.targetId;
  elements.matchScore.textContent = `${Math.round(result.score * 100)}%`;
  elements.debugText.textContent = formatDebug(result.debug);
  drawGuide(result.corners);
  await state.overlay.showMatch(result);
  setStatus(`匹配成功: ${result.targetName || result.targetId}`, 'success');
}

async function captureFrame() {
  const videoWidth = elements.video.videoWidth;
  const videoHeight = elements.video.videoHeight;

  elements.captureCanvas.width = videoWidth;
  elements.captureCanvas.height = videoHeight;

  const context = elements.captureCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(elements.video, 0, 0, videoWidth, videoHeight);

  const blob = await new Promise((resolve, reject) => {
    elements.captureCanvas.toBlob((value) => {
      if (value) {
        resolve(value);
        return;
      }

      reject(new Error('Failed to export capture blob.'));
    }, 'image/jpeg', 0.86);
  });

  return {
    canvas: elements.captureCanvas,
    blob,
    timestamp: Date.now(),
    videoWidth,
    videoHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

function remapMatchToViewport(result, frame) {
  if (!result.matched) {
    return result;
  }

  const scale = Math.max(frame.viewportWidth / frame.videoWidth, frame.viewportHeight / frame.videoHeight);
  const renderedWidth = frame.videoWidth * scale;
  const renderedHeight = frame.videoHeight * scale;
  const offsetX = (frame.viewportWidth - renderedWidth) / 2;
  const offsetY = (frame.viewportHeight - renderedHeight) / 2;

  return {
    ...result,
    corners: result.corners.map((corner) => ({
      x: corner.x * scale + offsetX,
      y: corner.y * scale + offsetY,
    })),
  };
}

function drawGuide(corners) {
  const context = elements.guideCanvas.getContext('2d');
  context.clearRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);

  context.lineWidth = 3;
  context.strokeStyle = '#58f29c';
  context.fillStyle = 'rgba(88, 242, 156, 0.14)';

  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((corner) => {
    context.lineTo(corner.x, corner.y);
  });
  context.closePath();
  context.fill();
  context.stroke();
}

function clearGuide() {
  const context = elements.guideCanvas.getContext('2d');
  context.clearRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);
}

function syncViewport() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  elements.guideCanvas.width = width;
  elements.guideCanvas.height = height;
  elements.overlayCanvas.width = width;
  elements.overlayCanvas.height = height;
  state.overlay?.resize(width, height);
}

function updateButtons() {
  const hasStream = Boolean(state.stream);
  elements.startButton.disabled = hasStream;
  elements.scanButton.disabled = !hasStream || state.busy;
  elements.autoButton.disabled = !hasStream;
}

function setStatus(text, tone) {
  elements.statusText.textContent = text;
  elements.info.dataset.tone = tone;
}

function formatDebug(debug) {
  const parts = [];

  if (debug?.matcherMode) {
    parts.push(`matcher=${debug.matcherMode}`);
  }

  if (Number.isFinite(debug?.latencyMs)) {
    parts.push(`latency=${debug.latencyMs}ms`);
  }

  if (Number.isFinite(debug?.threshold)) {
    parts.push(`threshold=${debug.threshold.toFixed(2)}`);
  }

  if (Number.isFinite(debug?.gap)) {
    parts.push(`gap=${debug.gap.toFixed(2)}`);
  }

  if (Number.isFinite(debug?.structureScore)) {
    parts.push(`structure=${debug.structureScore.toFixed(2)}`);
  }

  return parts.join(' | ') || '-';
}

function waitForMetadata(video) {
  if (video.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
}

function formatErrorMessage(error) {
  if (error?.name === 'NotAllowedError') {
    return '没有摄像头权限';
  }

  if (error?.name === 'NotReadableError') {
    return '摄像头被其他程序占用';
  }

  return error?.message || '未知错误';
}
