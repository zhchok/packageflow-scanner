"use strict";

(() => {
  const TESSERACT_URL =
    "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
  const TESSERACT_INTEGRITY =
    "sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM"; // pragma: allowlist secret

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
      script.integrity = TESSERACT_INTEGRITY;
      script.crossOrigin = "anonymous";
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
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-", // pragma: allowlist secret
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

  function normalizeAmazonTracking(candidate) {
    const compact = String(candidate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (compact.length !== 15) return undefined;

    const prefix = compact.slice(0, 3);
    if (!/^[T1IL7][B8][A4]$/.test(prefix)) return undefined;

    const digitCorrections = {
      O: "0",
      Q: "0",
      D: "0",
      I: "1",
      L: "1",
      Z: "2",
      S: "5",
      G: "6",
      B: "8",
    };
    const digits = [...compact.slice(3)]
      .map((character) => digitCorrections[character] || character)
      .join("");
    return /^\d{12}$/.test(digits) ? `TBA${digits}` : undefined;
  }

  function extractTracking(text, { knownFormatsOnly = false } = {}) {
    const candidates = new Map();

    for (const line of String(text || "").toUpperCase().split(/\n+/)) {
      const tokens = line.match(/[A-Z0-9]+/g) || [];
      const compactLine = tokens.join("");
      for (let offset = 0; offset <= compactLine.length - 15; offset += 1) {
        const amazonTracking = normalizeAmazonTracking(
          compactLine.slice(offset, offset + 15),
        );
        if (amazonTracking) candidates.set(amazonTracking, 125);
      }
      for (let start = 0; start < tokens.length; start += 1) {
        let candidate = "";
        for (
          let size = 1;
          size <= 3 && start + size <= tokens.length;
          size += 1
        ) {
          candidate += tokens[start + size - 1];
          if (candidate.length > 34) break;
          for (
            let offset = 0;
            offset <= Math.max(0, candidate.length - 15);
            offset += 1
          ) {
            const amazonTracking = normalizeAmazonTracking(
              candidate.slice(offset, offset + 15),
            );
            if (amazonTracking) {
              candidates.set(amazonTracking, 125);
            }
          }
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

  window.PackageFlowOcr = Object.freeze({
    extractTracking,
    getWorker,
    normalizeAmazonTracking,
  });
})();
