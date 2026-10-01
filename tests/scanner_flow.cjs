const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const runnable = source.slice(0, source.indexOf("telegram?.ready();"));

function scanner({ failFirstLog = false } = {}) {
  const nodes = new Map();
  const requests = [];
  let nextId = 0;
  let logFailures = failFirstLog ? 1 : 0;
  const node = (selector) => {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        hidden: false, disabled: false, value: "", textContent: "",
        classList: { add() {}, remove() {} }, listeners: {},
        addEventListener(type, handler) { this.listeners[type] = handler; },
        focus() {},
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node },
    window: {
      Telegram: { WebApp: { initData: "signed" } },
      location: { href: "https://scanner.example/dev/" },
      setTimeout, clearTimeout, addEventListener() {},
    },
    navigator: { vibrate() {} },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` },
    URL, AbortController, setTimeout, clearTimeout, console,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ path: new URL(url).pathname, body });
      if (String(url).endsWith("/log") && logFailures-- > 0) {
        return { ok: false, json: async () => ({ error: "unavailable" }) };
      }
      if (String(url).endsWith("/log")) {
        return { ok: true, json: async () => ({ confirmed: true, tracking: body.tracking }) };
      }
      return { ok: true, json: async () => ({ kind: "unknown", tracking: body.tracking }) };
    },
  });
  vm.runInContext(runnable, context);
  vm.runInContext("resumeScanner = async () => {}; showLookup = () => {};", context);
  return { context, node, requests };
}

async function main() {
  const app = scanner();
  assert.equal(await vm.runInContext("presentCandidate('00123')", app.context), true);
  assert.equal(await vm.runInContext("presentCandidate('00123')", app.context), false);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].body.method, "Barcode");
  assert.equal(app.requests[0].body.tracking, "00123");
  await vm.runInContext("confirmCandidate()", app.context);
  assert.deepEqual(app.requests.map((r) => r.path.split("/").pop()), ["log", "lookup"]);
  vm.runInContext("nextPackage()", app.context);
  await vm.runInContext("presentCandidate('00123', 'text')", app.context);
  assert.equal(app.requests[2].body.method, "OCR");
  vm.runInContext("rescan()", app.context);
  app.node("#manual-value").value = "00123";
  await app.node("#manual-form").listeners.submit({ preventDefault() {} });
  assert.equal(app.requests[3].body.method, "Вручную");
  assert.notEqual(app.requests[0].body.event_id, app.requests[3].body.event_id);

  const retry = scanner({ failFirstLog: true });
  await vm.runInContext("presentCandidate('TBA123')", retry.context);
  assert.match(retry.node("#status").textContent, /Не удалось подтвердить/);
  assert.equal(retry.requests.length, 1);
  await vm.runInContext("confirmCandidate()", retry.context);
  assert.deepEqual(retry.requests.map((r) => r.path.split("/").pop()),
                   ["log", "log", "lookup"]);
  assert.equal(retry.requests[0].body.event_id, retry.requests[1].body.event_id);
  vm.runInContext("rescan()", retry.context);
  await vm.runInContext("presentCandidate('TBA123')", retry.context);
  assert.notEqual(retry.requests[0].body.event_id, retry.requests[3].body.event_id);
  console.log("Scanner flow: barcode, OCR, manual, retry, cancellation, duplicate frames OK");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
