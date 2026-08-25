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
const switchCameraButton = document.querySelector("#switch-camera");
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
const receivingPanel = document.querySelector("#receiving");
const receivingLabel = document.querySelector("#receiving-label");
const receivingTracking = document.querySelector("#receiving-tracking");
const receivingDetails = document.querySelector("#receiving-details");
const receivingDecisions = document.querySelector("#receiving-decisions");
const markTakenButton = document.querySelector("#mark-taken");
const markErrorButton = document.querySelector("#mark-error");
const splitContentsPanel = document.querySelector("#split-contents");
const splitItemsNode = document.querySelector("#split-items");
const splitSummaryNode = document.querySelector("#split-summary");
const splitWarningNode = document.querySelector("#split-warning");
const splitReplacementButton = document.querySelector("#split-replacement");
const splitExtraButton = document.querySelector("#split-extra");
const splitConfirmButton = document.querySelector("#split-confirm");
const splitBackButton = document.querySelector("#split-back");
const splitManualForm = document.querySelector("#split-manual-form");
const splitManualLabel = document.querySelector("#split-manual-label");
const splitExpectedItem = document.querySelector("#split-expected-item");
const splitManualValue = document.querySelector("#split-manual-value");
const splitManualBackButton = document.querySelector("#split-manual-back");
const receivingDetailForm = document.querySelector("#receiving-detail-form");
const receivingDetailLabel = document.querySelector("#receiving-detail-label");
const receivingDetail = document.querySelector("#receiving-detail");
const saveDetailButton = document.querySelector("#save-detail");
const cancelDetailButton = document.querySelector("#cancel-detail");
const transferActions = document.querySelector("#transfer-actions");
const transferPackageButton = document.querySelector("#transfer-package");
const completedActions = document.querySelector("#completed-actions");
const nextPackageButton = document.querySelector("#next-package");
const finishSessionButton = document.querySelector("#finish-session");
const cancelReceivingButton = document.querySelector("#cancel-receiving");

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
const SINGLE_SCAN_BARCODE_ATTEMPTS = 2;
const FOCUS_SETTLE_MS = 320;
const PREFERRED_CAMERA_STORAGE_KEY = "packageflow.preferred-camera.v1";
const ZXING_INTEGRITY =
  "sha384-HRtzk9lZgkbSgvUyQrnfC/GxiXZgwaNyD7hC9wcXlsBpDhkS80ISl73juef2FRuf"; // pragma: allowlist secret

let stream;
let detector;
let zxingReader;
let nativeSupportedFormats = [];
let availableVideoDevices = [];
let activeVideoDeviceId;
let activeVideoDeviceLabel = "";
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
let currentLookup;
let detailMode;
let receiverName = "";
let splitSelection = { selected: {}, replacements: [], extras: [] };
let splitManualMode;

function receivingApiBaseUrl() {
  const currentUrl = new URL(window.location.href);
  const isDevScanner =
    currentUrl.pathname === "/dev" || currentUrl.pathname.startsWith("/dev/");
  const apiPrefix = isDevScanner ? "/dev/api/receiving/" : "/api/receiving/";

  // DEV и production обслуживаются одним доменом, поэтому относительный
  // путь вроде "api/..." может случайно уйти в production при URL "/dev".
  return new URL(apiPrefix, currentUrl.origin);
}

const receivingApiBase = receivingApiBaseUrl();

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

function extractTrackingFromPayload(value, { knownFormatsOnly = false } = {}) {
  const rawValue = String(value || "").trim();
  const directValue = normalizeTracking(rawValue);
  if (!knownFormatsOnly && isTracking(directValue)) return directValue;

  const readablePayload = rawValue.replace(
    /[\u0000-\u001f\u007f-\u009f]+/g,
    "\n",
  );
  return window.PackageFlowOcr.extractTracking(readablePayload, {
    knownFormatsOnly,
  });
}

function pauseScanning() {
  clearTimeout(holdTimer);
  holdActive = false;
  holdSession += 1;
  scanOnceButton.classList.remove("is-held");
  scanning = false;
  scanOnceButton.disabled = true;
}

function stopCamera() {
  pauseScanning();
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }
  video.srcObject = null;
  detector = undefined;
  nativeSupportedFormats = [];
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
  // Поток остаётся живым на экране подтверждения, потому что Telegram
  // показывает системный запрос при каждом новом getUserMedia в одной сессии.
  pauseScanning();
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

async function receivingApi(path, { method = "GET", body } = {}) {
  if (!telegram?.initData) {
    throw new Error("Откройте сканер через персональную кнопку в боте.");
  }
  const controller = new AbortController();
  const requestTimeout = window.setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(new URL(path, receivingApiBase), {
      method,
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        Authorization: `tma ${telegram.initData}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Google Sheets не ответил вовремя. Проверьте таблицу и повторите сохранение.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(requestTimeout);
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    console.debug("Receiving API returned a non-JSON response", error);
  }
  if (!response.ok) {
    throw new Error(
      payload?.error || "Сервис приёма временно недоступен. Попробуйте ещё раз.",
    );
  }
  return payload;
}

function hideScannerViews() {
  cameraFrame.hidden = true;
  hint.hidden = true;
  actions.hidden = true;
  manualForm.hidden = true;
  confirmation.hidden = true;
}

function resetWorkflowControls() {
  receivingDecisions.hidden = true;
  receivingDetailForm.hidden = true;
  splitContentsPanel.hidden = true;
  splitManualForm.hidden = true;
  transferActions.hidden = true;
  completedActions.hidden = true;
  cancelReceivingButton.hidden = false;
  receivingDetail.value = "";
  detailMode = undefined;
  splitManualMode = undefined;
}

function productKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function resetSplitSelection() {
  splitSelection = { selected: {}, replacements: [], extras: [] };
  splitManualMode = undefined;
  splitManualValue.value = "";
}

function splitRemainingItems() {
  return Array.isArray(currentLookup?.split_contents?.remaining)
    ? currentLookup.split_contents.remaining
    : [];
}

function replacementCountFor(name) {
  const key = productKey(name);
  return splitSelection.replacements
    .filter((replacement) => productKey(replacement.expected) === key)
    .reduce((total, replacement) => total + replacement.quantity, 0);
}

function selectableQuantity(item) {
  return Math.max(0, item.quantity - replacementCountFor(item.name));
}

function availableReplacementItems() {
  return splitRemainingItems()
    .map((item) => ({
      ...item,
      quantity:
        selectableQuantity(item) -
        (splitSelection.selected[productKey(item.name)] || 0),
    }))
    .filter((item) => item.quantity > 0);
}

function selectedSplitCount() {
  return (
    Object.values(splitSelection.selected).reduce(
      (total, quantity) => total + quantity,
      0,
    ) +
    splitSelection.replacements.reduce(
      (total, replacement) => total + replacement.quantity,
      0,
    ) +
    splitSelection.extras.reduce(
      (total, item) => total + item.quantity,
      0,
    )
  );
}

function splitMissingAfterSelection() {
  return splitRemainingItems()
    .map((item) => ({
      name: item.name,
      quantity:
        selectableQuantity(item) -
        (splitSelection.selected[productKey(item.name)] || 0),
    }))
    .filter((item) => item.quantity > 0);
}

function splitWillBeError() {
  return Boolean(
    currentLookup?.split_contents?.previous_mismatch ||
      splitSelection.replacements.length ||
      splitSelection.extras.length ||
      (currentLookup?.split_contents?.is_last_part &&
        splitMissingAfterSelection().length),
  );
}

function renderSplitSummary() {
  const displayNames = Object.fromEntries(
    splitRemainingItems().map((item) => [productKey(item.name), item.name]),
  );
  const lines = [];
  for (const [key, quantity] of Object.entries(splitSelection.selected)) {
    if (quantity > 0) lines.push(`• ${quantity} × ${displayNames[key] || key}`);
  }
  for (const replacement of splitSelection.replacements) {
    lines.push(`• Замена: ${replacement.expected} → ${replacement.actual}`);
  }
  for (const item of splitSelection.extras) {
    lines.push(`• Дополнительно: ${item.quantity} × ${item.name}`);
  }
  splitSummaryNode.textContent = lines.length
    ? `Выбрано:\n${lines.join("\n")}`
    : "";

  const warnings = [];
  if (currentLookup?.split_contents?.is_last_part) {
    const missing = splitMissingAfterSelection();
    if (missing.length) {
      warnings.push(
        `Это последняя коробка. Не получено: ${missing
          .map((item) => `${item.quantity} × ${item.name}`)
          .join("; ")}.`,
      );
    }
  }
  if (
    currentLookup?.split_contents?.previous_mismatch ||
    splitSelection.replacements.length ||
    splitSelection.extras.length
  ) {
    warnings.push("Итоговый статус будет «Ошибка».");
  }
  splitWarningNode.textContent = warnings.join(" ");
  splitWarningNode.hidden = !warnings.length;
  splitConfirmButton.disabled = selectedSplitCount() === 0;
  splitConfirmButton.textContent = splitWillBeError()
    ? "⚠️ Сохранить с ошибкой"
    : "✅ Подтвердить содержимое";
}

function renderSplitSelector() {
  splitItemsNode.replaceChildren();
  for (const item of splitRemainingItems()) {
    const key = productKey(item.name);
    const maximum = selectableQuantity(item);
    const selected = Math.min(
      maximum,
      splitSelection.selected[key] || 0,
    );
    splitSelection.selected[key] = selected;

    const row = document.createElement("div");
    row.className = "split-item";
    const subtract = document.createElement("button");
    subtract.className = "split-stepper";
    subtract.type = "button";
    subtract.textContent = "−";
    subtract.disabled = selected === 0;
    subtract.addEventListener("click", () => {
      splitSelection.selected[key] = Math.max(
        0,
        (splitSelection.selected[key] || 0) - 1,
      );
      renderSplitSelector();
    });

    const label = document.createElement("div");
    label.className = "split-item-name";
    label.textContent = item.name;
    const count = document.createElement("span");
    count.className = "split-item-count";
    count.textContent = `${selected} из ${maximum}`;
    label.append(count);

    const add = document.createElement("button");
    add.className = "split-stepper";
    add.type = "button";
    add.textContent = "+";
    add.disabled = selected >= maximum;
    add.addEventListener("click", () => {
      splitSelection.selected[key] = Math.min(
        maximum,
        (splitSelection.selected[key] || 0) + 1,
      );
      renderSplitSelector();
    });
    row.append(subtract, label, add);
    splitItemsNode.append(row);
  }
  splitReplacementButton.disabled = !availableReplacementItems().length;
  renderSplitSummary();
}

function showSplitSelector({ reset = false } = {}) {
  if (reset) resetSplitSelection();
  receivingDecisions.hidden = true;
  receivingDetailForm.hidden = true;
  splitManualForm.hidden = true;
  splitContentsPanel.hidden = false;
  renderSplitSelector();
  setStatus("Отметьте содержимое текущей коробки.");
}

function showSplitManualForm(mode) {
  splitManualMode = mode;
  splitContentsPanel.hidden = true;
  splitManualForm.hidden = false;
  splitManualValue.value = "";
  if (mode === "replacement") {
    splitManualLabel.textContent =
      "Выберите ожидаемый товар и укажите, что пришло фактически:";
    splitExpectedItem.replaceChildren();
    for (const item of availableReplacementItems()) {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = `${item.quantity} × ${item.name}`;
      splitExpectedItem.append(option);
    }
    splitExpectedItem.hidden = false;
  } else {
    splitManualLabel.textContent =
      "Введите неожиданный товар и количество, например «2 Cable»:";
    splitExpectedItem.hidden = true;
  }
  splitManualValue.focus();
}

function showDetailForm(mode) {
  detailMode = mode;
  receivingDecisions.hidden = true;
  transferActions.hidden = true;
  receivingDetailForm.hidden = false;
  receivingDetailLabel.textContent =
    mode === "unknown"
      ? "Введите содержимое неизвестной посылки. Оно будет записано в комментарий:"
      : mode === "taken"
        ? "Введите содержимое этой части split-посылки:"
        : "Опишите ошибку одним сообщением:";
  receivingDetail.focus();
}

function showLookup(lookup) {
  currentLookup = lookup;
  resetWorkflowControls();
  resetSplitSelection();
  hideScannerViews();
  receivingPanel.hidden = false;
  receivingTracking.textContent = lookup.tracking;

  if (lookup.kind === "package") {
    receivingLabel.textContent = "Посылка найдена";
    receivingDetails.textContent = [
      `Товар: ${lookup.product || "не указан"}`,
      `Текущий статус: ${lookup.status || "не указан"}`,
      ...(lookup.is_split
        ? [
            `Обработано частей: ${lookup.processed_count} из ${lookup.total_count}`,
            `Осталось товаров: ${
              lookup.split_contents?.remaining
                ?.map((item) => `${item.quantity} × ${item.name}`)
                .join("; ") || "нет"
            }`,
          ]
        : []),
    ].join("\n");
    receivingDecisions.hidden = false;
    setStatus("Выберите результат приёма.", "success");
    return;
  }

  if (lookup.kind === "unknown") {
    receivingLabel.textContent = "Посылка не найдена";
    receivingDetails.textContent =
      "После ввода содержимого будет создана новая строка со статусом «Доставлено».";
    showDetailForm("unknown");
    setStatus("Укажите содержимое неизвестной посылки.");
    return;
  }

  receivingLabel.textContent = "Трек закреплён за другим приёмщиком";
  receivingDetails.textContent = [
    `Приёмщик: ${lookup.assigned_receiver}`,
    `Статус: ${lookup.assigned_status}`,
    ...(lookup.is_split
      ? [`Будет перенесена вся группа из ${lookup.total_count} треков.`]
      : []),
    "Если посылка физически у вас, перенесите её в свою таблицу.",
  ].join("\n");
  transferActions.hidden = false;
  setStatus("Подтвердите перенос или отмените приём.", "error");
}

async function confirmCandidate() {
  if (completed || !pendingTracking) return;
  completed = true;
  confirmButton.disabled = true;
  rescanButton.disabled = true;
  setStatus(`Проверяем посылку ${pendingTracking}…`);
  try {
    const lookup = await receivingApi("lookup", {
      method: "POST",
      body: { tracking: pendingTracking },
    });
    showLookup(lookup);
  } catch (error) {
    console.error(error);
    completed = false;
    confirmButton.disabled = false;
    rescanButton.disabled = false;
    setStatus(error.message, "error");
  }
}

async function saveUnknown() {
  const originalButtonText = saveDetailButton.textContent;
  saveDetailButton.disabled = true;
  saveDetailButton.textContent = "Сохраняем…";
  setStatus("Добавляем неизвестную посылку…");
  try {
    const lookup = await receivingApi("unknown", {
      method: "POST",
      body: {
        tracking: currentLookup.tracking,
        contents: receivingDetail.value,
      },
    });
    showLookup(lookup);
  } catch (error) {
    console.error(error);
    setStatus(error.message, "error");
  } finally {
    saveDetailButton.disabled = false;
    saveDetailButton.textContent = originalButtonText;
  }
}

function completionMessage(result) {
  if (result.is_split && !result.finalized) {
    return [
      "Результат части сохранён.",
      `Обработано: ${result.processed_count} из ${result.total_count}.`,
      "Статус всей посылки пока не изменён.",
    ].join("\n");
  }
  return `Готово. Итоговый статус: ${result.final_status}.`;
}

async function completePackage(result, detail = "") {
  const attemptedDetailMode = detailMode;
  receivingDecisions.hidden = true;
  receivingDetailForm.hidden = true;
  setStatus("Сохраняем результат в Google Sheets…");
  try {
    const completion = await receivingApi("complete", {
      method: "POST",
      body: {
        tracking: currentLookup.tracking,
        result,
        detail,
      },
    });
    receivingLabel.textContent = "Приём сохранён";
    receivingDetails.textContent = completionMessage(completion);
    completedActions.hidden = false;
    cancelReceivingButton.hidden = true;
    setStatus("Можно сканировать следующую посылку.", "success");
    navigator.vibrate?.([80, 40, 80]);
    telegram?.HapticFeedback?.notificationOccurred("success");
  } catch (error) {
    console.error(error);
    if (attemptedDetailMode === "taken" || attemptedDetailMode === "error") {
      showDetailForm(attemptedDetailMode);
    } else {
      receivingDecisions.hidden = false;
    }
    setStatus(error.message, "error");
  }
}

async function completeSplitPackage() {
  splitConfirmButton.disabled = true;
  setStatus("Сохраняем содержимое в Google Sheets…");
  const selected = Object.fromEntries(
    splitRemainingItems()
      .map((item) => [
        item.name,
        splitSelection.selected[productKey(item.name)] || 0,
      ])
      .filter(([, quantity]) => quantity > 0),
  );
  try {
    const completion = await receivingApi("complete-split", {
      method: "POST",
      body: {
        tracking: currentLookup.tracking,
        selected,
        replacements: splitSelection.replacements,
        extras: splitSelection.extras,
      },
    });
    splitContentsPanel.hidden = true;
    receivingLabel.textContent = "Приём сохранён";
    receivingDetails.textContent = completionMessage(completion);
    completedActions.hidden = false;
    cancelReceivingButton.hidden = true;
    setStatus("Можно сканировать следующую посылку.", "success");
    navigator.vibrate?.([80, 40, 80]);
    telegram?.HapticFeedback?.notificationOccurred("success");
  } catch (error) {
    console.error(error);
    splitConfirmButton.disabled = false;
    showSplitSelector();
    setStatus(error.message, "error");
  }
}

async function transferPackage() {
  transferPackageButton.disabled = true;
  setStatus("Переносим посылку в вашу таблицу…");
  try {
    const lookup = await receivingApi("transfer", {
      method: "POST",
      body: { tracking: currentLookup.tracking },
    });
    showLookup(lookup);
  } catch (error) {
    console.error(error);
    setStatus(error.message, "error");
  } finally {
    transferPackageButton.disabled = false;
  }
}

function nextPackage() {
  currentLookup = undefined;
  pendingTracking = undefined;
  completed = false;
  candidateNode.textContent = "";
  receivingPanel.hidden = true;
  confirmation.hidden = true;
  cameraFrame.hidden = false;
  hint.hidden = false;
  actions.hidden = false;
  confirmButton.disabled = false;
  rescanButton.disabled = false;
  void resumeScanner();
}

function finishReceivingSession() {
  stopCamera();
  telegram?.close();
}

function hasLiveCamera() {
  return Boolean(
    stream?.getVideoTracks().some((track) => track.readyState === "live"),
  );
}

async function resumeScanner() {
  if (!hasLiveCamera()) {
    await startScanner(activeVideoDeviceId);
    return;
  }

  await video.play();
  const track = stream.getVideoTracks()[0];
  scanning = true;
  scanOnceButton.disabled = false;
  setStatus(
    `Камера: ${cameraDiagnostics(track)}. Держите этикетку в 20–30 см и нажмите «Сканировать».`,
  );
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
  void resumeScanner();
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
    script.integrity = ZXING_INTEGRITY;
    script.crossOrigin = "anonymous";
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

function enhancedBarcodeCanvas(source, threshold) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.filter = "grayscale(1) contrast(2.2)";
  context.drawImage(source, 0, 0);
  if (threshold === undefined) return canvas;

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const value = image.data[offset] < threshold ? 0 : 255;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function rotatedCanvas(source, degrees) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function barcodeCanvasVariants(source) {
  const contrast = enhancedBarcodeCanvas(source);
  const binary = enhancedBarcodeCanvas(source, 155);
  return [
    source,
    contrast,
    binary,
    rotatedCanvas(binary, -3),
    rotatedCanvas(binary, 3),
  ];
}

async function detectNativeBarcode(image, options) {
  if (!detector) return undefined;
  const results = await detector.detect(image);
  return results
    .map((result) => extractTrackingFromPayload(result.rawValue, options))
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

async function detectQuaggaCode128(image) {
  if (!window.Quagga?.decodeSingle) return undefined;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(undefined), 2500);

    try {
      window.Quagga.decodeSingle(
        {
          src: image.toDataURL("image/jpeg", 0.96),
          numOfWorkers: 0,
          locate: true,
          inputStream: { size: 0, singleChannel: false },
          locator: { halfSample: false, patchSize: "small" },
          decoder: { readers: ["code_128_reader"] },
        },
        (result) => {
          finish(extractTrackingFromPayload(result?.codeResult?.code));
        },
      );
    } catch (error) {
      console.debug("Quagga Code 128 scan failed", error);
      finish(undefined);
    }
  });
}

async function detectBarcodeFromCurrentFrame() {
  const image = captureScanRegion();
  if (!image) throw new Error("FRAME_UNAVAILABLE");

  let tracking;
  try {
    tracking = await detectNativeBarcode(video, { knownFormatsOnly: true });
    if (!tracking) tracking = await detectNativeBarcode(image);
  } catch (error) {
    console.debug("Native barcode scan failed", error);
  }
  if (!tracking) {
    tracking = await detectQuaggaCode128(image);
  }
  if (!tracking) {
    for (const variant of barcodeCanvasVariants(image)) {
      try {
        tracking = await detectZxingBarcode(variant);
      } catch (error) {
        console.debug("ZXing barcode scan failed", error);
      }
      if (tracking) break;
    }
  }
  return tracking;
}

function textRegionCanvas(source, startRatio = 0, heightRatio = 1) {
  const sourceY = Math.round(source.height * startRatio);
  const sourceHeight = Math.max(
    1,
    Math.min(source.height - sourceY, Math.round(source.height * heightRatio)),
  );
  const scale = Math.max(1, Math.min(2, 1700 / source.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "grayscale(1) contrast(2.2)";
  context.drawImage(
    source,
    0,
    sourceY,
    source.width,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
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
  const pageModes = window.Tesseract?.PSM || {};
  const variants = [
    {
      image: textRegionCanvas(image, 0.55, 0.45),
      pageMode: pageModes.SPARSE_TEXT ?? "11",
    },
    {
      image: textRegionCanvas(image, 0.4, 0.6),
      pageMode: pageModes.SPARSE_TEXT ?? "11",
    },
    {
      image: textRegionCanvas(image),
      pageMode: pageModes.SPARSE_TEXT ?? "11",
    },
  ];

  for (const variant of variants) {
    if (!isActive()) return undefined;
    await worker.setParameters({
      tessedit_pageseg_mode: variant.pageMode,
      user_defined_dpi: "300",
    });
    const {
      data: { text },
    } = await worker.recognize(variant.image);
    const tracking = window.PackageFlowOcr.extractTracking(text, {
      knownFormatsOnly: true,
    });
    if (tracking) return tracking;
  }
  return undefined;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function applyCameraConstraint(track, constraint) {
  try {
    await track.applyConstraints({ advanced: [constraint] });
    return true;
  } catch (error) {
    console.debug("Camera constraint is unavailable", constraint, error);
    return false;
  }
}

function cameraFocusModes(track) {
  const modes = track?.getCapabilities?.().focusMode;
  return Array.isArray(modes) ? modes : [];
}

async function enableContinuousFocus(track) {
  if (!cameraFocusModes(track).includes("continuous")) return false;
  return applyCameraConstraint(track, { focusMode: "continuous" });
}

async function optimizeCameraTrack(track) {
  try {
    track.contentHint = "detail";
  } catch (error) {
    console.debug("Detailed camera content hint is unavailable", error);
  }
  await enableContinuousFocus(track);

  const capabilities = track.getCapabilities?.() || {};
  if (Array.isArray(capabilities.exposureMode)) {
    if (capabilities.exposureMode.includes("continuous")) {
      await applyCameraConstraint(track, { exposureMode: "continuous" });
    }
  }
  if (
    Array.isArray(capabilities.whiteBalanceMode) &&
    capabilities.whiteBalanceMode.includes("continuous")
  ) {
    await applyCameraConstraint(track, { whiteBalanceMode: "continuous" });
  }
  if (
    capabilities.exposureCompensation &&
    Number.isFinite(capabilities.exposureCompensation.min) &&
    Number.isFinite(capabilities.exposureCompensation.max)
  ) {
    const compensation = Math.min(
      capabilities.exposureCompensation.max,
      Math.max(capabilities.exposureCompensation.min, -0.5),
    );
    await applyCameraConstraint(track, { exposureCompensation: compensation });
  }
}

function isLikelyBackCamera(device) {
  return !/(front|user|facetime|передн)/i.test(device.label || "");
}

function isIosCameraOrder() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function cameraPreferenceScore(device, originalIndex = 0) {
  const label = String(device.label || "").toLowerCase();
  let score = -originalIndex;
  const androidCameraNumber = label.match(/camera\s*([0-9]+)\b/i);

  if (/(front|user|facetime|selfie|передн)/i.test(label)) score -= 1000;
  if (/(back|rear|environment|задн)/i.test(label)) score += 100;

  // Обычный модуль 1× фокусируется на этикетке с рабочего расстояния лучше,
  // чем широкоугольный и telephoto-объективы.
  if (/(main|primary|standard|default|основн)/i.test(label)) score += 160;
  if (/(^|[^0-9])1(?:[.,]0)?\s*[x×]([^0-9]|$)/i.test(label)) score += 140;
  if (androidCameraNumber) {
    const cameraNumber = Number(androidCameraNumber[1]);
    if (cameraNumber === 0) score += 320;
    if (cameraNumber >= 2) score -= cameraNumber * 90;
  }
  if (/(ultra[\s_-]*wide|ultrawide|super[\s_-]*wide|0[.,][56]\s*[x×]?|fisheye|рыб.*глаз)/i.test(label)) {
    score -= 500;
  }
  if (/(telephoto|tele\b|2\s*[x×]|3\s*[x×]|5\s*[x×])/i.test(label)) {
    score -= 260;
  }
  return score;
}

function rankVideoDevices(cameras) {
  return cameras
    .map((device, originalIndex) => ({
      device,
      originalIndex,
      score: cameraPreferenceScore(device, originalIndex),
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ device }) => device);
}

function readStoredPreferredCameraId() {
  try {
    return localStorage.getItem(PREFERRED_CAMERA_STORAGE_KEY) || undefined;
  } catch (error) {
    console.debug("Camera preference storage is unavailable", error);
    return undefined;
  }
}

function storePreferredCameraId(deviceId) {
  if (!deviceId) return;
  try {
    localStorage.setItem(PREFERRED_CAMERA_STORAGE_KEY, deviceId);
  } catch (error) {
    console.debug("Camera preference storage is unavailable", error);
  }
}

async function preferredCameraBeforeAccess() {
  const storedDeviceId = readStoredPreferredCameraId();
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    if (
      storedDeviceId &&
      (!cameras.length ||
        cameras.some((device) => device.deviceId === storedDeviceId))
    ) {
      return storedDeviceId;
    }

    // До первого разрешения браузер скрывает названия камер. Выбираем
    // конкретный объектив заранее только когда метки уже доступны, иначе
    // facingMode безопаснее случайного выбора фронтальной камеры.
    if (!cameras.some((device) => device.label)) return undefined;
    if (isIosCameraOrder() && cameras.length >= 2) {
      return cameras[1].deviceId || undefined;
    }
    const backCameras = cameras.filter(isLikelyBackCamera);
    return rankVideoDevices(
      backCameras.length ? backCameras : cameras,
    )[0]?.deviceId;
  } catch (error) {
    console.debug("Camera list is unavailable before access", error);
    return storedDeviceId;
  }
}

async function refreshVideoDevices(track) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    if (isIosCameraOrder() && cameras.length >= 2) {
      // WebKit локализует названия, но после разрешения обычная задняя камера
      // идёт второй. Ставим её первой, а фронтальную переносим в конец списка.
      availableVideoDevices = [
        cameras[1],
        ...cameras.slice(2),
        cameras[0],
      ];
    } else {
      const backCameras = cameras.filter(isLikelyBackCamera);
      availableVideoDevices = rankVideoDevices(
        backCameras.length ? backCameras : cameras,
      );
    }
    activeVideoDeviceId = track.getSettings?.().deviceId;
    const activeCamera = availableVideoDevices.find(
      (device) => device.deviceId === activeVideoDeviceId,
    );
    activeVideoDeviceLabel = activeCamera?.label || track.label || "";
    switchCameraButton.hidden = availableVideoDevices.length < 2;
    return availableVideoDevices[0];
  } catch (error) {
    console.debug("Camera list is unavailable", error);
    availableVideoDevices = [];
    activeVideoDeviceId = track.getSettings?.().deviceId;
    activeVideoDeviceLabel = track.label || "";
    switchCameraButton.hidden = true;
    return undefined;
  }
}

function cameraDiagnostics(track) {
  const settings = track.getSettings?.() || {};
  const modes = cameraFocusModes(track);
  const resolution =
    settings.width && settings.height
      ? `${settings.width}×${settings.height}`
      : "разрешение не указано";
  const focus =
    settings.focusMode ||
    (modes.includes("continuous") ? "continuous" : "управляет телефон");
  const nativeCode128 = nativeSupportedFormats.includes("code_128")
    ? "да"
    : "нет";
  const exposure = settings.exposureMode || "авто";
  const cameraName = activeVideoDeviceLabel || "основная задняя камера";
  return `${cameraName}; ${resolution}; фокус: ${focus}; экспозиция: ${exposure}; системный Code 128: ${nativeCode128}`;
}

async function refocusCamera() {
  const track = stream?.getVideoTracks()[0];
  if (!track) return false;

  const modes = cameraFocusModes(track);
  let focused = false;
  if (modes.includes("single-shot")) {
    focused = await applyCameraConstraint(track, { focusMode: "single-shot" });
  } else if (modes.includes("continuous")) {
    focused = await enableContinuousFocus(track);
  }

  if (focused) {
    await wait(FOCUS_SETTLE_MS);
    await enableContinuousFocus(track);
  }
  return focused;
}

async function scanOnce() {
  if (!scanning || processing || completed) return;
  processing = true;
  scanOnceButton.disabled = true;
  cameraFrame.classList.add("is-processing");
  setStatus("Фокусируем камеру…");

  try {
    await refocusCamera();
    setStatus("Считываем штрихкод и QR…");
    let tracking;
    for (let attempt = 0; attempt < SINGLE_SCAN_BARCODE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await wait(140);
      tracking = await detectBarcodeFromCurrentFrame();
      if (tracking) {
        presentCandidate(tracking);
        return;
      }
    }

    setStatus("Трек в коде не найден. Распознаём напечатанный текст…");
    const textImage = captureScanRegion();
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
    await refocusCamera();
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
        const textImage = captureScanRegion();
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

async function startScanner(deviceId) {
  if (scanning || completed) return;
  startButton.hidden = true;
  setStatus("Запрашиваем доступ к камере…");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("CAMERA_UNAVAILABLE");
    }

    const requestedDeviceId =
      deviceId || (await preferredCameraBeforeAccess());

    const videoConstraints = {
      width: { ideal: 2560 },
      height: { ideal: 1440 },
      frameRate: { ideal: 30 },
      focusMode: { ideal: "continuous" },
      resizeMode: { ideal: "none" },
    };
    if (requestedDeviceId) {
      videoConstraints.deviceId = { exact: requestedDeviceId };
    } else {
      videoConstraints.facingMode = { ideal: "environment" };
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });
    video.srcObject = stream;
    await video.play();

    const track = stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities?.() || {};
    await optimizeCameraTrack(track);
    const preferredDevice = await refreshVideoDevices(track);
    // Запоминаем основную камеру для следующего открытия, но не вызываем
    // getUserMedia второй раз: Telegram показывает на такой вызов новый диалог.
    storePreferredCameraId(
      preferredDevice?.deviceId || activeVideoDeviceId,
    );
    torchButton.hidden = !capabilities.torch;

    if ("BarcodeDetector" in window) {
      const available = await BarcodeDetector.getSupportedFormats();
      const formats = supportedFormats.filter((format) =>
        available.includes(format),
      );
      nativeSupportedFormats = formats;
      if (formats.length) detector = new BarcodeDetector({ formats });
    }
    scanning = true;
    scanOnceButton.disabled = false;
    setStatus(
      `Камера: ${cameraDiagnostics(track)}. Держите этикетку в 20–30 см и нажмите «Сканировать».`,
    );
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

switchCameraButton.addEventListener("click", async () => {
  if (availableVideoDevices.length < 2 || processing || completed) return;
  const currentIndex = availableVideoDevices.findIndex(
    (device) => device.deviceId === activeVideoDeviceId,
  );
  const nextIndex = (currentIndex + 1) % availableVideoDevices.length;
  const nextDevice = availableVideoDevices[nextIndex];
  setStatus("Переключаем камеру…");
  stopCamera();
  await startScanner(nextDevice.deviceId);
});

cameraFrame.addEventListener("click", async () => {
  if (!scanning || processing || completed) return;
  setStatus("Фокусируем камеру по центру рамки…");
  const focused = await refocusCamera();
  setStatus(
    focused
      ? "Фокус готов. Нажмите «Сканировать»."
      : "Автофокус управляется телефоном. Держите этикетку в 20–30 см от камеры.",
  );
});

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

startButton.addEventListener("click", () => startScanner());
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
confirmButton.addEventListener("click", () => void confirmCandidate());
rescanButton.addEventListener("click", rescan);
cancelConfirmationButton.addEventListener("click", () => {
  rescan();
});
markTakenButton.addEventListener("click", () => {
  if (currentLookup?.is_split) {
    if (!currentLookup.split_contents) {
      setStatus(
        "Не удалось загрузить остаток товаров. Закройте Mini App и повторите поиск.",
        "error",
      );
      return;
    }
    showSplitSelector({ reset: true });
    return;
  }
  void completePackage("taken");
});
markErrorButton.addEventListener("click", () => showDetailForm("error"));
splitReplacementButton.addEventListener("click", () => {
  if (!availableReplacementItems().length) {
    setStatus("Нет ожидаемых товаров для замены.", "error");
    return;
  }
  showSplitManualForm("replacement");
});
splitExtraButton.addEventListener("click", () => showSplitManualForm("extra"));
splitConfirmButton.addEventListener("click", () => void completeSplitPackage());
splitBackButton.addEventListener("click", () => {
  splitContentsPanel.hidden = true;
  receivingDecisions.hidden = false;
  setStatus("Выберите результат приёма.");
});
splitManualBackButton.addEventListener("click", () => showSplitSelector());
splitManualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const rawValue = splitManualValue.value.trim().replace(/\s+/g, " ");
  if (!rawValue) {
    setStatus("Введите фактически полученный товар.", "error");
    return;
  }
  if (splitManualMode === "replacement") {
    const expected = splitExpectedItem.value;
    if (!expected) {
      setStatus("Выберите ожидаемый товар.", "error");
      return;
    }
    splitSelection.replacements.push({
      expected,
      actual: rawValue,
      quantity: 1,
    });
  } else {
    const match = rawValue.match(/^(\d+)\s+(.+)$/);
    const quantity = match ? Number(match[1]) : 1;
    const name = (match ? match[2] : rawValue).trim();
    if (!name || !Number.isInteger(quantity) || quantity < 1) {
      setStatus("Используйте формат «2 Cable» или «Cable».", "error");
      return;
    }
    splitSelection.extras.push({ name, quantity });
  }
  showSplitSelector();
});
receivingDetailForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (detailMode === "unknown") {
    void saveUnknown();
    return;
  }
  void completePackage(detailMode, receivingDetail.value);
});
cancelDetailButton.addEventListener("click", () => {
  if (currentLookup?.kind === "unknown") {
    nextPackage();
    return;
  }
  receivingDetailForm.hidden = true;
  if (currentLookup?.kind === "package") receivingDecisions.hidden = false;
  if (currentLookup?.kind === "transfer") transferActions.hidden = false;
});
transferPackageButton.addEventListener("click", () => void transferPackage());
nextPackageButton.addEventListener("click", nextPackage);
finishSessionButton.addEventListener("click", finishReceivingSession);
cancelReceivingButton.addEventListener("click", nextPackage);
closeButton.addEventListener("click", () => {
  stopCamera();
  telegram?.close();
});
window.addEventListener("pagehide", stopCamera);

telegram?.ready();
telegram?.expand();

async function initializeReceiving() {
  setStatus("Проверяем доступ к непрерывному приёму…");
  try {
    const session = await receivingApi("session");
    receiverName = session.receiver || "";
    await startScanner();
    if (receiverName) {
      setStatus(`Приёмщик: ${receiverName}. Камера готова.`);
    }
  } catch (error) {
    console.error(error);
    startButton.hidden = true;
    scanOnceButton.disabled = true;
    setStatus(error.message, "error");
  }
}

void initializeReceiving();
