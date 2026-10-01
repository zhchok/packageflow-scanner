const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const runnable = source.slice(0, source.indexOf("telegram?.ready();"));

function scanner({ failFirstLog = false, deferredPaths = [] } = {}) {
  const nodes = new Map();
  const requests = [];
  const pending = [];
  const haptics = [];
  let nextId = 0;
  let logFailures = failFirstLog ? 1 : 0;
  const node = (selector) => {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        hidden: false, disabled: false, readOnly: false, value: "", textContent: "",
        classList: { add() {}, remove() {} }, listeners: {}, children: [],
        addEventListener(type, handler) { this.listeners[type] = handler; },
        focus() {}, append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); },
        replaceChildren(...children) { this.children = children; },
        querySelectorAll() { return this.children.flatMap((child) => child.children || []); },
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: {
      querySelector: node,
      createElement: (tag) => node(`created-${tag}-${++nextId}`),
      head: { append() {} },
    },
    window: {
      Telegram: { WebApp: { initData: "signed", HapticFeedback: {
        impactOccurred: (value) => haptics.push(["impact", value]),
        notificationOccurred: (value) => haptics.push(["notification", value]),
      } } },
      location: { href: "https://scanner.example/dev/" },
      setTimeout, clearTimeout, addEventListener() {},
    },
    navigator: { vibrate() {} },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` },
    URL, AbortController, setTimeout, clearTimeout, console: { error() {}, debug() {} },
    fetch: (url, options) => {
      const body = JSON.parse(options.body);
      const pathname = new URL(url).pathname;
      requests.push({ path: pathname, body });
      if (deferredPaths.includes(pathname)) {
        return new Promise((resolve, reject) => pending.push({ pathname, body, resolve, reject }));
      }
      if (pathname.endsWith("/log") && logFailures-- > 0) {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) });
      }
      if (pathname.endsWith("/log")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ confirmed: true, tracking: body.tracking }) });
      }
      if (pathname.endsWith("/lookup")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ kind: "unknown", tracking: body.tracking }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        tracking: body.tracking, is_split: false, processed_count: 1,
        total_count: 1, finalized: true, final_status: "Забрал",
      }) });
    },
  });
  vm.runInContext(runnable, context);
  vm.runInContext("resumeScanner = async () => {};", context);
  return { context, node, requests, pending, haptics };
}

function resolvePending(app, suffix, payload) {
  const index = app.pending.findIndex((request) => request.pathname.endsWith(suffix));
  assert.notEqual(index, -1, `missing pending ${suffix} request`);
  const [request] = app.pending.splice(index, 1);
  request.resolve({ ok: true, status: 200, json: async () => payload });
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function showPackage(app, tracking, product = tracking) {
  vm.runInContext(`pendingTracking=${JSON.stringify(tracking)}; pendingEventId='event-${tracking}';
    pendingMethod='Barcode'; candidateLogged=true;
    showLookup({kind:'package',tracking:${JSON.stringify(tracking)},product:${JSON.stringify(product)},status:'Доставлено',is_split:false})`, app.context);
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
  assert.deepEqual(retry.requests.map((r) => r.path.split("/").pop()), ["log", "log", "lookup"]);
  assert.equal(retry.requests[0].body.event_id, retry.requests[1].body.event_id);
  vm.runInContext("rescan()", retry.context);
  await vm.runInContext("presentCandidate('TBA123')", retry.context);
  assert.notEqual(retry.requests[0].body.event_id, retry.requests[3].body.event_id);

  const delayed = scanner({ deferredPaths: ["/dev/api/receiving/complete"] });
  showPackage(delayed, "TBA-A");
  const completion = vm.runInContext("completePackage('taken')", delayed.context);
  await flush();
  assert.equal(delayed.requests.filter((r) => r.path.endsWith("/complete")).length, 1);
  assert.equal(delayed.node("#mark-taken").disabled, true);
  assert.equal(vm.runInContext("nextPackage()", delayed.context), false);
  assert.equal(vm.runInContext("rescan()", delayed.context), false);
  assert.equal(vm.runInContext("finishReceivingSession()", delayed.context), false);
  await vm.runInContext("completePackage('error')", delayed.context);
  assert.equal(delayed.requests.filter((r) => r.path.endsWith("/complete")).length, 1);
  resolvePending(delayed, "/complete", {
    tracking: "TBA-A", is_split: false, processed_count: 1, total_count: 1,
    finalized: true, final_status: "Забрал",
  });
  await completion;
  assert.equal(delayed.node("#receiving-label").textContent, "Приём сохранён");

  for (const outcome of ["success", "error"]) {
    const stale = scanner({ deferredPaths: ["/dev/api/receiving/complete"] });
    showPackage(stale, "SAME", "old");
    const pendingCompletion = vm.runInContext("completePackage('taken')", stale.context);
    await flush();
    showPackage(stale, "SAME", "new");
    vm.runInContext("receivingLabel.textContent='Посилка Б'; setStatus('Екран посилки Б'); markTakenButton.disabled=false", stale.context);
    const stateBefore = [stale.node("#receiving-label").textContent, stale.node("#status").textContent,
      stale.node("#mark-taken").disabled, stale.haptics.length];
    if (outcome === "success") {
      resolvePending(stale, "/complete", {
        tracking: "SAME", is_split: false, processed_count: 1, total_count: 1,
        finalized: true, final_status: "Забрал",
      });
    } else {
      const index = stale.pending.findIndex((request) => request.pathname.endsWith("/complete"));
      stale.pending.splice(index, 1)[0].reject(new Error("network down"));
    }
    await pendingCompletion;
    assert.deepEqual([stale.node("#receiving-label").textContent, stale.node("#status").textContent,
      stale.node("#mark-taken").disabled, stale.haptics.length], stateBefore);
  }

  const mismatch = scanner({ deferredPaths: ["/dev/api/receiving/complete"] });
  showPackage(mismatch, "TBA-A");
  const badResponse = vm.runInContext("completePackage('taken')", mismatch.context);
  await flush();
  resolvePending(mismatch, "/complete", {
    tracking: "TBA-B", is_split: false, processed_count: 1, total_count: 1,
    finalized: true, final_status: "Забрал",
  });
  await badResponse;
  assert.notEqual(mismatch.node("#receiving-label").textContent, "Приём сохранён");
  assert.match(mismatch.node("#status").textContent, /Проверьте статус посылки/);

  const split = scanner({ deferredPaths: ["/dev/api/receiving/complete-split"] });
  vm.runInContext(`pendingTracking='SPLIT'; pendingEventId='split-event'; pendingMethod='Barcode'; candidateLogged=true;
    showLookup({kind:'package',tracking:'SPLIT',product:'bundle',status:'Доставлено',is_split:true,
      split_contents:{remaining:[{name:'Cable',quantity:2}],previous_mismatch:false,is_last_part:false}});
    splitSelection={selected:{cable:1},replacements:[],extras:[]}`, split.context);
  const splitSave = vm.runInContext("completeSplitPackage()", split.context);
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(split.requests[0].body.selected)), { Cable: 1 });
  vm.runInContext("splitSelection.selected.cable=2", split.context);
  assert.deepEqual(JSON.parse(JSON.stringify(split.requests[0].body.selected)), { Cable: 1 });
  assert.equal(vm.runInContext("nextPackage()", split.context), false);
  resolvePending(split, "/complete-split", {
    tracking: "SPLIT", is_split: true, processed_count: 1, total_count: 2,
    finalized: false, final_status: "Доставлено",
  });
  await splitSave;
  assert.equal(split.node("#receiving-label").textContent, "Часть приёма сохранена");
  assert.match(split.node("#receiving-details").textContent, /Результат части сохранён/);

  for (const [kind, path, method] of [
    ["unknown", "/unknown", "saveUnknown()"],
    ["transfer", "/transfer", "transferPackage()"],
  ]) {
    const variant = scanner({ deferredPaths: [`/dev/api/receiving${path}`] });
    vm.runInContext(`pendingTracking='${kind.toUpperCase()}'; pendingEventId='event-${kind}'; pendingMethod='Barcode'; candidateLogged=true;
      showLookup({kind:'${kind}',tracking:'${kind.toUpperCase()}',assigned_receiver:'Receiver',assigned_status:'Доставлено'});
      receivingDetail.value='contents'`, variant.context);
    const save = vm.runInContext(method, variant.context);
    await flush();
    assert.equal(variant.requests.length, 1);
    assert.equal(vm.runInContext("nextPackage()", variant.context), false);
    await vm.runInContext(method, variant.context);
    assert.equal(variant.requests.length, 1);
    resolvePending(variant, path, { kind: "package", tracking: kind.toUpperCase(), product: "saved" });
    await save;
    assert.equal(variant.node("#receiving-tracking").textContent, kind.toUpperCase());

    const staleVariant = scanner({ deferredPaths: [`/dev/api/receiving${path}`] });
    vm.runInContext(`pendingTracking='SAME-${kind}'; pendingEventId='old-${kind}'; pendingMethod='Barcode'; candidateLogged=true;
      showLookup({kind:'${kind}',tracking:'SAME-${kind}',assigned_receiver:'Receiver',assigned_status:'Доставлено'});
      receivingDetail.value='old input'`, staleVariant.context);
    const staleSave = vm.runInContext(method, staleVariant.context);
    await flush();
    showPackage(staleVariant, `SAME-${kind}`, "next package");
    vm.runInContext("receivingLabel.textContent='Посилка Б'; setStatus('Екран посилки Б')", staleVariant.context);
    const state = [staleVariant.node("#receiving-label").textContent,
      staleVariant.node("#status").textContent];
    resolvePending(staleVariant, path, { kind: "package", tracking: `SAME-${kind}`, product: "saved" });
    await staleSave;
    assert.deepEqual([staleVariant.node("#receiving-label").textContent,
      staleVariant.node("#status").textContent], state);
  }
  console.log("Scanner flow: input methods, TrackingLog retry, duplicate-save lock, blocked navigation, stale success/error and mismatched tracking OK");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
