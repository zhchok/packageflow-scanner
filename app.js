"use strict";

const telegram = window.Telegram?.WebApp;
const video = document.querySelector("#preview");
const statusNode = document.querySelector("#status");
const startButton = document.querySelector("#start");
const torchButton = document.querySelector("#torch");
const manualButton = document.querySelector("#manual");
const closeButton = document.querySelector("#close");
const manualForm = document.querySelector("#manual-form");
const manualValue = document.querySelector("#manual-value");

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

let stream;
let controls;
let scanning = false;
let completed = false;
let torchEnabled = false;
let lastDetectionAt = 0;

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

function stopCamera() {
  scanning = false;
  if (controls) {
    controls.stop();
    controls = undefined;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }
  video.srcObject = null;
}

function deliver(value) {
  if (completed) return;
  const tracking = normalizeTracking(value);
  if (!isTracking(tracking)) {
    setStatus(
      "Код распознан, но не похож на трек-номер. Продолжаем сканирование…",
      "error",
    );
    return;
  }

  completed = true;
  stopCamera();
  setStatus(`Распознано: ${tracking}`, "success");
  navigator.vibrate?.(100);
  telegram?.HapticFeedback?.notificationOccurred("success");

  if (telegram?.sendData) {
    telegram.sendData(JSON.stringify({ type: "barcode", value: tracking }));
  } else {
    manualValue.value = tracking;
    manualForm.hidden = false;
    setStatus(
      `Распознано локально: ${tracking}. В Telegram код будет передан боту автоматически.`,
      "success",
    );
  }
}

async function startNativeScanner(formats) {
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

  const detector = new BarcodeDetector({ formats });
  scanning = true;
  setStatus("Камера включена. Наведите её на штрихкод.");

  async function scanFrame(now) {
    if (!scanning || completed) return;
    if (now - lastDetectionAt >= 90 && video.readyState >= 2) {
      lastDetectionAt = now;
      try {
        const results = await detector.detect(video);
        if (results.length) {
          deliver(results[0].rawValue);
          return;
        }
      } catch (error) {
        console.debug("Native barcode frame skipped", error);
      }
    }
    requestAnimationFrame(scanFrame);
  }
  requestAnimationFrame(scanFrame);
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

async function startZxingScanner() {
  setStatus("Подключаем совместимый модуль сканирования…");
  const ZXingBrowser = await loadZxing();
  const reader = new ZXingBrowser.BrowserMultiFormatReader();
  scanning = true;
  controls = await reader.decodeFromConstraints(
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    video,
    (result) => {
      if (result) deliver(result.getText());
    },
  );
  setStatus("Камера включена. Наведите её на штрихкод.");
}

async function startScanner() {
  if (scanning || completed) return;
  startButton.hidden = true;
  setStatus("Запрашиваем доступ к камере…");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("CAMERA_UNAVAILABLE");
    }

    if ("BarcodeDetector" in window) {
      const available = await BarcodeDetector.getSupportedFormats();
      const formats = supportedFormats.filter((format) =>
        available.includes(format),
      );
      if (formats.length) {
        await startNativeScanner(formats);
        return;
      }
    }
    await startZxingScanner();
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
manualButton.addEventListener("click", () => {
  manualForm.hidden = !manualForm.hidden;
  if (!manualForm.hidden) manualValue.focus();
});
manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  deliver(manualValue.value);
});
closeButton.addEventListener("click", () => {
  stopCamera();
  telegram?.close();
});
window.addEventListener("pagehide", stopCamera);

telegram?.ready();
telegram?.expand();
startScanner();
