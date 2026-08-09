"use strict";

(() => {
  const TESSERACT_URL =
    "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";

  let workerPromise;
  let progressListener;

  function loadTesseract() {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) {
        resolve(window.Tesseract);
        return;
      }

      const script = document.createElement("script");
      script.src = TESSERACT_URL;
      script.async = true;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error("Tesseract failed to load"));
      document.head.append(script);
    });
  }

  async function getWorker(onProgress) {
    progressListener = onProgress;
    if (!workerPromise) {
      workerPromise = (async () => {
        const Tesseract = await loadTesseract();
        const worker = await Tesseract.createWorker("eng", 1, {
          logger: (message) => progressListener?.(message),
        });
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
          tessedit_pageseg_mode: Tesseract.PSM?.SPARSE_TEXT ?? "11",
          preserve_interword_spaces: "1",
          user_defined_dpi: "150",
        });
        return worker;
      })().catch((error) => {
        workerPromise = undefined;
        throw error;
      });
    }
    return workerPromise;
  }

  function candidateScore(candidate) {
    if (/^TBA\d{12}$/.test(candidate)) return 120;
    if (/^TBA[A-Z0-9]{8,25}$/.test(candidate)) return 100;
    if (/^1Z[A-Z0-9]{16}$/.test(candidate)) return 98;
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(candidate)) return 96;
    if (/^(?:JJD|JD|GM|YT|SF|LP)[A-Z0-9]{8,30}$/.test(candidate)) {
      return 92;
    }
    if (/^\d{12,34}$/.test(candidate)) return 85;
    if (
      /^[A-Z0-9]{10,34}$/.test(candidate) &&
      /[A-Z]/.test(candidate) &&
      /\d/.test(candidate)
    ) {
      return 60;
    }
    return 0;
  }

  function extractTracking(text, { knownFormatsOnly = false } = {}) {
    const candidates = new Map();

    for (const line of String(text || "").toUpperCase().split(/\n+/)) {
      const tokens = line.match(/[A-Z0-9]+/g) || [];
      for (let start = 0; start < tokens.length; start += 1) {
        let candidate = "";
        for (
          let size = 1;
          size <= 3 && start + size <= tokens.length;
          size += 1
        ) {
          candidate += tokens[start + size - 1];
          if (candidate.length > 34) break;
          const score = candidateScore(candidate);
          if (score && (!knownFormatsOnly || score >= 85)) {
            candidates.set(candidate, score);
          }
        }
      }
    }

    return [...candidates.entries()].sort(
      ([firstCandidate, firstScore], [secondCandidate, secondScore]) =>
        secondScore - firstScore ||
        firstCandidate.length - secondCandidate.length,
    )[0]?.[0];
  }

  window.PackageFlowOcr = Object.freeze({ extractTracking, getWorker });
})();
