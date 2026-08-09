"use strict";

const telegram = window.Telegram?.WebApp;
const video = document.querySelector("#preview");
const cameraFrame = document.querySelector(".camera-frame");
const scanBox = document.querySelector(".scan-box");
const hint = document.querySelector(".hint");
const statusNode = document.querySelector("#status");
const actions = document.querySelector("#actions");
const startButton = document.querySelector("#start");
const torchButton = document.querySelector("#torch");
const manualButton = document.querySelector("#manual");
const closeButton = document.querySelector("#close");
const manualForm = document.querySelector("#manual-form");
const manualValue = document.querySelector("#manual-value");
const confirmation = document.querySelector("#confirmation");
const confirmationTitle = document.querySelector("#confirmation-title");
const candidateNode = document.querySelector("#candidate");
const confirmButton = document.querySelector("#confirm");
const rescanButton = document.querySelector("#rescan");
const scanOnceButton = document.querySelector("#scan-once");
const cancelConfirmationButton = document.querySelector(
  "#cancel-confirmation",
);

const supportedFormats = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "itf",
  "upc_a",
  "upc_e",
  "qr_code",
  "data_matrix",
  "pdf417",
];
const HOLD_DELAY_MS = 320;
const HOLD_RETRY_MS = 170;
const HOLD_OCR_DELAY_MS = 700;
const HOLD_OCR_INTERVAL_MS = 1800;

let stream;
let detector;
let zxingReader;
let scanning = false;
let processing = false;
let completed = false;
let pendingTracking;
let torchEnabled = false;
let holdTimer;
let holdActive = false;
let holdSession = 0;
let pressedPointerId;
let longPressTriggered = false;

function setStatus(text, kind = "") {
  statusNode.textContent = text;
  statusNode.className = `status ${kind}`.trim();
}

function normalizeTracking(value) {
  return String(value || "").trim().toUpperCase().replaceAll(" ", "");
}

function isTracking(value) {
  return /^[A-Z0-9-]{3,100}$/.test(value);
}

function extractTrackingFromPayload(value) {
  const rawValue = String(value || "").trim();
  const directValue = normalizeTracking(rawValue);
  if (isTracking(directValue)) return directValue;

  const readablePayload = rawValue.replace(
    /[\u0000-\u001f\u007f-\u009f]+/g,
    "\n",
  );
  return window.PackageFlowOcr.extractTracking(readablePayload, {
    knownFormatsOnly: true,
  });
}

function stopCamera() {
  clearTimeout(holdTimer);
  holdActive = false;
  holdSession += 1;
  scanOnceButton.classList.remove("is-held");
  scanning = false;
  scanOnceButton.disabled = true;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }
  video.srcObject = null;
  detector = undefined;
}

function presentCandidate(value, source = "barcode") {
  if (completed || pendingTracking) return false;
  const tracking = normalizeTracking(value);
  if (!isTracking(tracking)) {
    setStatus(
      "Код распознан, но не похож на трек-номер. Продолжаем сканирование…",
      "error",
    );
    return false;
  }

  pendingTracking = tracking;
  stopCamera();
  cameraFrame.hidden = true;
  hint.hidden = true;
  actions.hidden = true;
  manualForm.hidden = true;
  confirmationTitle.textContent =
    source === "text" ? "Трек-номер найден в тексте" : "Распознан трек-номер";
  candidateNode.textContent = tracking;
  confirmation.hidden = false;
  setStatus(
    source === "text"
      ? "Текст распознан. Проверьте найденный номер."
      : "Проверьте распознанный номер.",
    "success",
  );
  navigator.vibrate?.(100);
  telegram?.HapticFeedback?.notificationOccurred("success");
  return true;
}

function confirmCandidate() {
  if (completed || !pendingTracking) return;
  completed = true;
  confirmButton.disabled = true;
  rescanButton.disabled = true;
  setStatus(`Передаём боту: ${pendingTracking}`, "success");

  if (telegram?.sendData) {
    telegram.sendData(
      JSON.stringify({ type: "barcode", value: pendingTracking }),
    );
  } else {
    setStatus(
      `Подтверждено локально: ${pendingTracking}. В Telegram номер будет передан боту.`,
      "success",
    );
  }
}

function rescan() {
  pendingTracking = undefined;
  completed = false;
  candidateNode.textContent = "";
  confirmation.hidden = true;
  cameraFrame.hidden = false;
  hint.hidden = false;
  actions.hidden = false;
  confirmButton.disabled = false;
  rescanButton.disabled = false;
  startScanner();
}

function loadZxing() {
  return new Promise((resolve, reject) => {
    if (window.ZXingBrowser) {
      resolve(window.ZXingBrowser);
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js";
    script.async = true;
    script.onload = () => resolve(window.ZXingBrowser);
    script.onerror = () => reject(new Error("ZXing failed to load"));
    document.head.append(script);
  });
}

function captureScanRegion(enhanceForText = false) {
  if (!video.videoWidth || !video.videoHeight) return undefined;

  const frameRect = cameraFrame.getBoundingClientRect();
  const boxRect = scanBox.getBoundingClientRect();
  const sourceAspect = video.videoWidth / video.videoHeight;
  const frameAspect = frameRect.width / frameRect.height;
  let renderedWidth = frameRect.width;
  let renderedHeight = frameRect.height;
  let hiddenX = 0;
  let hiddenY = 0;

  if (sourceAspect > frameAspect) {
    renderedWidth = renderedHeight * sourceAspect;
    hiddenX = (renderedWidth - frameRect.width) / 2;
  } else {
    renderedHeight = renderedWidth / sourceAspect;
    hiddenY = (renderedHeight - frameRect.height) / 2;
  }

  const sourceX =
    ((boxRect.left - frameRect.left + hiddenX) / renderedWidth) *
    video.videoWidth;
  const sourceY =
    ((boxRect.top - frameRect.top + hiddenY) / renderedHeight) *
    video.videoHeight;
  const sourceWidth =
    (boxRect.width / renderedWidth) * video.videoWidth;
  const sourceHeight =
    (boxRect.height / renderedHeight) * video.videoHeight;
  const scale = Math.max(1, Math.min(2.5, 1100 / sourceWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (enhanceForText) context.filter = "grayscale(1) contrast(1.8)";
  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

async function detectNativeBarcode(image) {
  if (!detector) return undefined;
  const results = await detector.detect(image);
  return results
    .map((result) => extractTrackingFromPayload(result.rawValue))
    .find(Boolean);
}

async function detectZxingBarcode(image) {
  const ZXingBrowser = await loadZxing();
  zxingReader ||= new ZXingBrowser.BrowserMultiFormatReader();
  try {
    const result = zxingReader.decodeFromCanvas(image);
    return extractTrackingFromPayload(result.getText());
  } catch (error) {
    console.debug("ZXing did not find a barcode", error);
    return undefined;
  }
}

async function detectBarcodeFromCurrentFrame() {
  const image = captureScanRegion();
  if (!image) throw new Error("FRAME_UNAVAILABLE");

  let tracking;
  try {
    tracking = await detectNativeBarcode(image);
  } catch (error) {
    console.debug("Native barcode scan failed", error);
  }
  if (!tracking) {
    try {
      tracking = await detectZxingBarcode(image);
    } catch (error) {
      console.debug("ZXing barcode scan failed", error);
    }
  }
  return tracking;
}

async function recognizeTrackingText(image, isActive = () => true) {
  const worker = await window.PackageFlowOcr.getWorker((message) => {
    if (
      message.status !== "recognizing text" ||
      !processing ||
      !isActive()
    ) {
      return;
    }
    const progress = Math.round((message.progress || 0) * 100);
    setStatus(`Распознаём напечатанный трек… ${progress}%`);
  });
  const {
    data: { text },
  } = await worker.recognize(image);
  return window.PackageFlowOcr.extractTracking(text);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function scanOnce() {
  if (!scanning || processing || completed) return;
  processing = true;
  scanOnceButton.disabled = true;
  cameraFrame.classList.add("is-processing");
  setStatus("Считываем штрихкод и QR…");

  try {
    let tracking = await detectBarcodeFromCurrentFrame();
    if (tracking) {
      presentCandidate(tracking);
      return;
    }

    setStatus("Трек в коде не найден. Распознаём напечатанный текст…");
    const textImage = captureScanRegion(true);
    tracking = await recognizeTrackingText(textImage);
    if (tracking) {
      presentCandidate(tracking, "text");
      return;
    }

    setStatus(
      "Трек-номер не найден. Выровняйте этикетку и нажмите «Сканировать» ещё раз.",
      "error",
    );
  } catch (error) {
    console.error(error);
    setStatus(
      "Не удалось распознать трек. Попробуйте ещё раз или введите его вручную.",
      "error",
    );
  } finally {
    processing = false;
    cameraFrame.classList.remove("is-processing");
    scanOnceButton.disabled = !scanning;
  }
}

async function scanWhileHeld(session) {
  if (!scanning || processing || completed) return;
  processing = true;
  cameraFrame.classList.add("is-processing");
  const startedAt = performance.now();
  let lastOcrAt = startedAt - HOLD_OCR_INTERVAL_MS;

  try {
    while (
      holdActive &&
      session === holdSession &&
      scanning &&
      !completed
    ) {
      setStatus("Сканируем, пока кнопка удерживается…");
      const tracking = await detectBarcodeFromCurrentFrame();
      if (!holdActive || session !== holdSession) return;
      if (tracking) {
        presentCandidate(tracking);
        return;
      }

      const now = performance.now();
      if (
        now - startedAt >= HOLD_OCR_DELAY_MS &&
        now - lastOcrAt >= HOLD_OCR_INTERVAL_MS
      ) {
        lastOcrAt = now;
        setStatus("Трек в коде не найден. Распознаём напечатанный текст…");
        const textImage = captureScanRegion(true);
        const textTracking = await recognizeTrackingText(
          textImage,
          () => holdActive && session === holdSession,
        );
        if (!holdActive || session !== holdSession) return;
        if (textTracking) {
          presentCandidate(textTracking, "text");
          return;
        }
      }

      await wait(HOLD_RETRY_MS);
    }
  } catch (error) {
    console.error(error);
    if (holdActive && session === holdSession) {
      setStatus(
        "Не удалось распознать трек. Измените положение камеры и продолжайте удерживать кнопку.",
        "error",
      );
    }
  } finally {
    processing = false;
    cameraFrame.classList.remove("is-processing");
    scanOnceButton.disabled = !scanning;
  }
}

function beginScanPress(event) {
  if (!scanning || processing || completed || event.button > 0) return;
  event.preventDefault();
  pressedPointerId = event.pointerId;
  longPressTriggered = false;
  scanOnceButton.classList.add("is-held");
  holdTimer = setTimeout(() => {
    longPressTriggered = true;
    holdActive = true;
    holdSession += 1;
    void scanWhileHeld(holdSession);
  }, HOLD_DELAY_MS);
  try {
    scanOnceButton.setPointerCapture?.(event.pointerId);
  } catch (error) {
    console.debug("Pointer capture is unavailable", error);
  }
}

function finishScanPress(event, cancelled = false) {
  if (pressedPointerId !== event.pointerId) return;
  event.preventDefault();
  clearTimeout(holdTimer);
  scanOnceButton.classList.remove("is-held");
  const wasLongPress = longPressTriggered;
  pressedPointerId = undefined;

  if (wasLongPress) {
    holdActive = false;
    holdSession += 1;
    if (!pendingTracking && scanning) {
      setStatus("Сканирование остановлено. Нажмите или удерживайте кнопку снова.");
    }
    return;
  }
  if (!cancelled) void scanOnce();
}

async function startScanner() {
  if (scanning || completed) return;
  startButton.hidden = true;
  setStatus("Запрашиваем доступ к камере…");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("CAMERA_UNAVAILABLE");
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = stream;
    await video.play();

    const track = stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities?.() || {};
    torchButton.hidden = !capabilities.torch;

    if ("BarcodeDetector" in window) {
      const available = await BarcodeDetector.getSupportedFormats();
      const formats = supportedFormats.filter((format) =>
        available.includes(format),
      );
      if (formats.length) detector = new BarcodeDetector({ formats });
    }
    scanning = true;
    scanOnceButton.disabled = false;
    setStatus("Камера готова. Наведите её и нажмите «Сканировать».");
  } catch (error) {
    console.error(error);
    stopCamera();
    startButton.hidden = false;
    setStatus(
      "Не удалось открыть камеру. Разрешите доступ к ней или введите трек вручную.",
      "error",
    );
  }
}

torchButton.addEventListener("click", async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchEnabled = !torchEnabled;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchEnabled }] });
    torchButton.textContent = torchEnabled ? "🔦 Выключить" : "🔦 Фонарик";
  } catch (error) {
    console.error(error);
    setStatus("Фонарик недоступен на этом устройстве.", "error");
  }
});

startButton.addEventListener("click", startScanner);
scanOnceButton.addEventListener("pointerdown", beginScanPress);
scanOnceButton.addEventListener("pointerup", (event) =>
  finishScanPress(event),
);
scanOnceButton.addEventListener("pointercancel", (event) =>
  finishScanPress(event, true),
);
scanOnceButton.addEventListener("click", (event) => event.preventDefault());
scanOnceButton.addEventListener("contextmenu", (event) =>
  event.preventDefault(),
);
scanOnceButton.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
    event.preventDefault();
    void scanOnce();
  }
});
manualButton.addEventListener("click", () => {
  manualForm.hidden = !manualForm.hidden;
  if (!manualForm.hidden) manualValue.focus();
});
manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  presentCandidate(manualValue.value);
});
confirmButton.addEventListener("click", confirmCandidate);
rescanButton.addEventListener("click", rescan);
cancelConfirmationButton.addEventListener("click", () => {
  stopCamera();
  telegram?.close();
});
closeButton.addEventListener("click", () => {
  stopCamera();
  telegram?.close();
});
window.addEventListener("pagehide", stopCamera);

telegram?.ready();
telegram?.expand();
startScanner();
