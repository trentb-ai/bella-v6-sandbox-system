// ============================================================
// V3 CHUNK 1 STUB — /snapshot/{lid} Debug Endpoint
// Purpose: Provides a test endpoint to verify KV intel shape during C1.
//          Returns current `lead:{lid}:intel` from KV for curl-based verification.
//          C8 (Tools state machine) will add full production endpoints below this block.
//          This stub is safe and does NOT affect any existing V2 routes.
// ============================================================
//
// To test during C1:
//   curl https://<tools-worker-url>/snapshot/test123
//   → returns { intel: <NormalizedIntel | null>, memory: <MemoryRecord | null>, status: "ok" }
//
// Route is handled FIRST in the worker's fetch handler (see injection point below).
// ============================================================
//
//  ⚠️  INJECTION POINT FOR RUNTIME:
//  In the worker's fetch() handler, add this at the TOP of routing (before existing routes):
//
//  const snapshotMatch = url.pathname.match(/^\/snapshot\/([a-z0-9_-]+)$/i);
//  if (snapshotMatch) {
//    const lid = snapshotMatch[1];
//    const intel = await env.LEADS_KV.get(`lead:${lid}:intel`, { type: "json" });
//    const memory = await env.LEADS_KV.get(`lead:${lid}:memory`, { type: "json" });
//    return new Response(JSON.stringify({ lid, intel, memory, status: "ok", ts: new Date().toISOString() }), {
//      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
//    });
//  }
//
// ============================================================
// END V3 CHUNK 1 STUB HEADER
// ============================================================

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), {
  bigint: /* @__PURE__ */ __name(function bigint() {
    return BigInt(Date.now() * 1e6);
  }, "bigint")
});

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// ../../../../../usr/local/lib/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// ../../../../../usr/local/lib/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/index.ts
var j = /* @__PURE__ */ __name((d, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
}), "j");
function auth(req, env2) {
  const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return tok === env2.BEARER_TOKEN;
}
__name(auth, "auth");
async function getLeadData(lid, env2) {
  const [rawJson, rawBare, intelJson, bellaJson, nameJson] = await Promise.all([
    env2.LEADS_KV.get("lead:" + lid),
    env2.LEADS_KV.get(lid),
    env2.LEADS_KV.get("lead:" + lid + ":intel"),
    env2.LEADS_KV.get("lead:" + lid + ":bella:plan"),
    env2.LEADS_KV.get("lead:" + lid + ":name")
  ]);
  const resolvedRaw = rawJson ?? rawBare;
  if (!resolvedRaw && !intelJson) return null;
  let raw = {};
  let bare = {};
  let intel = {};
  let bellaPlan = {};
  let nameData = {};
  try {
    if (resolvedRaw) raw = JSON.parse(resolvedRaw);
  } catch {
  }
  try {
    if (rawBare) bare = JSON.parse(rawBare);
  } catch {
  }
  try {
    if (intelJson) intel = JSON.parse(intelJson);
  } catch {
  }
  try {
    if (bellaJson) bellaPlan = JSON.parse(bellaJson);
  } catch {
  }
  try {
    if (nameJson) nameData = JSON.parse(nameJson);
  } catch {
  }
  return {
    ...raw,
    first_name: nameData.first_name || bare.firstName || bare.first_name || raw.firstName || raw.first_name || "",
    bella_plan: bellaPlan,
    _intel: intel,
    _pipeline_status: intelJson ? "complete" : "raw_only"
  };
}
__name(getLeadData, "getLeadData");
async function handleResolveIntelHot(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const data = await getLeadData(lid, env2);
  if (!data) return j({ success: false, reason: "no_data_for_lid", lid });
  const intel = data._intel ?? {};
  const bellaPlan = data.bella_plan ?? {};
  const flags = intel.flags ?? {};
  // V3 fast_context + deep track reads
  const fc = intel.fast_context ?? {};
  const fcBiz = fc.business ?? {};
  const fcPerson = fc.person ?? {};
  const fcHero = fc.hero ?? {};
  const deepTrack = intel.deep ?? intel.intel?.deep ?? {};
  const deepGMaps = deepTrack.googleMaps ?? {};
  const websiteHealth = intel.website_health ?? {};
  const industryBenchmark = intel.industry_benchmark ?? {};
  const topFix = intel.top_fix ?? {};
  const routing = intel.routing ?? {};
  const agentRanking = intel.agent_ranking?.length ? intel.agent_ranking : intel.recommended_agents?.length ? intel.recommended_agents : routing.top_agents?.length ? routing.top_agents : [];
  const bellaOpener = intel.bella_opener ?? "";
  const pipelineStatus = data._pipeline_status ?? "raw_only";
  const marketingIntel = data.marketing_intelligence ?? {};
  const consultIntel = data.consultative_intelligence ?? {};
  const prioritizedFixes = data.prioritized_fixes ?? {};
  const criticalFixes = data.critical_fixes ?? {};
  const reputationIntel = marketingIntel.reputationIntelligence ?? {};
  const adIntel = marketingIntel.adIntelligence ?? {};
  const topFixes = [];
  if (topFix.agent) {
    topFixes.push(topFix);
  } else {
    const scraperFixes = prioritizedFixes.topFixes ?? [];
    for (const fix of scraperFixes.slice(0, 5)) {
      topFixes.push({
        agent: fix.agent ?? "",
        title: fix.title ?? "",
        monthly_revenue: Number(fix.monthlyRevenue ?? 0),
        copy_headline: fix.copyHeadline ?? "",
        confidence: fix.confidence ?? "estimate",
        id: fix.id ?? ""
      });
    }
  }
  if (agentRanking.length === 0 && topFixes.length > 0) {
    const seen = /* @__PURE__ */ new Set();
    for (const fix of topFixes) {
      const a = String(fix.agent ?? "").toLowerCase();
      if (a && !seen.has(a)) {
        agentRanking.push(a);
        seen.add(a);
      }
    }
    const agentCopy = consultIntel.agentCopy ?? {};
    for (const a of ["alex", "chris", "maddie", "james", "sarah"]) {
      if (!seen.has(a) && agentCopy[a]) {
        agentRanking.push(a);
        seen.add(a);
      }
    }
  }
  let businessName = data.business_name ?? data.businessName ?? "";
  if (!businessName || businessName === "your business" || businessName === "Unknown Business") {
    const coreId = intel.core_identity ?? {};
    businessName = coreId.business_name ?? "";
  }
  if ((!businessName || businessName === "your business") && bellaOpener) {
    const commaIdx = bellaOpener.indexOf(",");
    if (commaIdx > 0 && commaIdx < 60) businessName = bellaOpener.substring(0, commaIdx).trim();
  }
  if (!businessName || businessName === "your business" || businessName === "Unknown Business") {
    const rawUrl = data.url ?? data.websiteUrl ?? "";
    if (rawUrl) {
      try {
        const hostname = new URL(rawUrl.startsWith("http") ? rawUrl : "https://" + rawUrl).hostname.replace(/^www\./, "");
        const domainBase = hostname.split(".")[0];
        businessName = domainBase.charAt(0).toUpperCase() + domainBase.slice(1);
      } catch {
      }
    }
  }
  const topAgents = agentRanking.slice(0, 5);
  const roiResults = {};
  let totalMonthlyROI = 0;
  const roiReads = topAgents.map(async (agent) => {
    let roi = null;
    const confirmedStr = await env2.LEADS_KV.get(`lead:${lid}:${agent}:roi_confirmed`);
    if (confirmedStr) {
      try {
        roi = JSON.parse(confirmedStr);
        roi._source = "confirmed";
      } catch {
      }
    }
    if (!roi) {
      const estimateStr = await env2.LEADS_KV.get(`lead:${lid}:${agent}:roi_estimate`);
      if (estimateStr) {
        try {
          roi = JSON.parse(estimateStr);
          roi._source = "estimate";
        } catch {
        }
      }
    }
    return { agent, roi };
  });
  for (const { agent, roi } of await Promise.all(roiReads)) {
    if (roi) {
      roiResults[agent] = roi;
      totalMonthlyROI += Number(roi.monthly_opportunity ?? 0);
    }
  }
  let acvConfirmed = null;
  try {
    const acvStr = await env2.LEADS_KV.get(`lead:${lid}:acv`);
    if (acvStr) acvConfirmed = JSON.parse(acvStr)?.value ?? null;
  } catch {
  }
  return j({
    success: true,
    lid,
    pipeline_status: pipelineStatus,
    data_available: pipelineStatus === "complete",
    first_name: data.first_name,
    business_name: businessName,
    tagline: data.tagline ?? "",
    industry: data.industry ?? intel.core_identity?.industry ?? "",
    location: data.location ?? intel.core_identity?.location ?? "",
    years_in_business: data.years_in_business ?? "",
    target_audience: data.target_audience ?? "",
    pain_points: data.pain_points ?? [],
    services: data.services ?? "",
    star_rating: data.star_rating ?? websiteHealth.google_rating ?? reputationIntel.googleRating ?? deepGMaps.rating ?? fcBiz.rating ?? null,
    review_count: data.review_count ?? websiteHealth.review_count ?? reputationIntel.reviewCount ?? deepGMaps.review_count ?? fcBiz.review_count ?? null,
    is_running_ads: flags.is_running_ads ?? data.is_running_ads ?? adIntel.isRunningAds ?? criticalFixes.isRunningGoogleAds ?? false,
    ad_funnel_verdict: flags.ad_funnel_verdict ?? data.ad_funnel_verdict ?? "",
    total_monthly_opportunity: totalMonthlyROI > 0 ? totalMonthlyROI : Number(prioritizedFixes.totalMonthlyOpportunity ?? topFix.monthly_revenue ?? 0),
    top_fixes: topFixes,
    agent_ranking: agentRanking,
    top_agents: topAgents,
    bella_opener: bellaOpener || ((consultIntel.agentCopy ?? {})[agentRanking[0] ?? ""] ?? ""),
    industry_benchmark: Object.keys(industryBenchmark).length > 0 ? industryBenchmark : data.industry_benchmark ?? {},
    flags,
    intelligence_brief: bellaPlan.intelligence_brief ?? "",
    stage1_script: bellaPlan.stage1_script ?? "",
    routing_recommendation: bellaPlan.routing_recommendation ?? "",
    // Enrichment from scrape fallbacks
    agent_snippets: Object.keys(intel.agent_snippets ?? {}).length > 0 ? intel.agent_snippets : consultIntel.agentCopy ?? {},
    strongest_agent: consultIntel.strongestAgent ?? agentRanking[0] ?? "",
    primary_pain_point: consultIntel.primaryPainPoint ?? "",
    overall_grade: marketingIntel.overallGrade ?? data.overall_grade ?? "",
    // ROI bundle — full figures for voice delivery
    roi: roiResults,
    total_roi_monthly: totalMonthlyROI,
    acv_confirmed: acvConfirmed,
    acv_benchmark: industryBenchmark.acv ?? data.industry_benchmark?.acv ?? null,
    // Pre-built voice lines
    roi_voice_lines: Object.entries(roiResults).map(([agent, roi]) => {
      const mo = Number(roi.monthly_opportunity ?? 0);
      return mo > 0 ? `${agent}: ${mo >= 1e3 ? Math.round(mo / 1e3) + " thousand" : mo} dollars a month` : null;
    }).filter(Boolean),
    // Ad ecosystem data (from Apify/Firecrawl scraper pipeline)
    facebook_ads_data: data.facebook_ads_data ?? null,
    google_ads_data: data.google_ads_data ?? null,
    campaign_analysis: data.campaign_analysis ?? null,
    // V3 fields: hero, person, deep track, google maps
    hero_h1: fcHero.h1 ?? "",
    hero_meta: fcHero.meta_description ?? "",
    person_job_title: fcPerson.job_title ?? "",
    person_tenure: fcPerson.tenure ?? "",
    deep_track_status: deepTrack.status ?? "not_started",
    google_maps_data: Object.keys(deepGMaps).length > 0 ? deepGMaps : null,
    review_highlights: (deepGMaps.reviews_sample ?? []).slice(0, 3)
  });
}
__name(handleResolveIntelHot, "handleResolveIntelHot");
async function handleKvGetFact(req, env2) {
  const body = await req.json();
  const key = String(body.key ?? "").trim();
  if (!key) return j({ error: "key required" }, 400);
  const val = await env2.LEADS_KV.get(key);
  if (!val) return j({ found: false, key });
  try {
    return j({ found: true, key, value: JSON.parse(val) });
  } catch {
    return j({ found: true, key, value: val });
  }
}
__name(handleKvGetFact, "handleKvGetFact");
async function handleKvWrite(req, env2) {
  const body = await req.json();
  const key = String(body.key ?? "").trim();
  if (!key) return j({ error: "key required" }, 400);
  if (body.value === void 0) return j({ error: "value required" }, 400);
  const ttl = Number(body.ttl ?? 0);
  const opts = ttl > 0 ? { expirationTtl: ttl } : void 0;
  await env2.LEADS_KV.put(key, JSON.stringify(body.value), opts);
  return j({ success: true, key });
}
__name(handleKvWrite, "handleKvWrite");
async function handleKvSearch(req, env2) {
  const body = await req.json();
  const prefix = String(body.prefix ?? "").trim();
  const limit = Math.min(Number(body.limit ?? 10), 50);
  if (!prefix) return j({ error: "prefix required" }, 400);
  const list = await env2.LEADS_KV.list({ prefix, limit });
  if (list.keys.length === 0) return j({ found: false, prefix, keys: [] });
  const out = {};
  for (const k of list.keys) {
    const v = await env2.LEADS_KV.get(k.name);
    try {
      out[k.name] = JSON.parse(v);
    } catch {
      out[k.name] = v;
    }
  }
  return j({ found: true, prefix, keys: list.keys.map((k) => k.name), values: out });
}
__name(handleKvSearch, "handleKvSearch");
async function handleSaveLeadPatch(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const patch = body.patch ?? {};
  const existing = await env2.LEADS_KV.get("lead:" + lid);
  let data = {};
  try {
    if (existing) data = JSON.parse(existing);
  } catch {
  }
  const merged = { ...data, ...patch, _updated: (/* @__PURE__ */ new Date()).toISOString() };
  await env2.LEADS_KV.put("lead:" + lid, JSON.stringify(merged));
  return j({ success: true, lid, updated: Object.keys(patch) });
}
__name(handleSaveLeadPatch, "handleSaveLeadPatch");
async function handleLogEvent(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  const event = String(body.event ?? "").trim();
  if (!lid || !event) return j({ error: "lid and event required" }, 400);
  const logKey = "event:" + lid + ":" + Date.now();
  await env2.LEADS_KV.put(logKey, JSON.stringify({ event, data: body.data ?? {}, ts: (/* @__PURE__ */ new Date()).toISOString() }), { expirationTtl: 604800 });
  console.log(JSON.stringify({ event, lid, ts: (/* @__PURE__ */ new Date()).toISOString() }));
  return j({ success: true, lid, event });
}
__name(handleLogEvent, "handleLogEvent");
async function handleHandoffAction(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  const action = String(body.action ?? "").trim();
  if (!lid || !action) return j({ error: "lid and action required" }, 400);
  await env2.LEADS_KV.put("handoff:" + lid, JSON.stringify({
    action,
    agent: body.agent ?? "",
    notes: body.notes ?? "",
    ts: (/* @__PURE__ */ new Date()).toISOString()
  }), { expirationTtl: 86400 });
  console.log(JSON.stringify({ event: "handoff", lid, action, ts: (/* @__PURE__ */ new Date()).toISOString() }));
  return j({ success: true, lid, action });
}
__name(handleHandoffAction, "handleHandoffAction");
async function handleWriteOutcome(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const outcome = {
    qualified: body.qualified === true,
    pain_confirmed: String(body.pain_confirmed ?? ""),
    ltv_estimate: String(body.ltv_estimate ?? ""),
    next_step: String(body.next_step ?? ""),
    booked: body.booked === true,
    notes: String(body.notes ?? ""),
    call_timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  await env2.LEADS_KV.put("outcome:" + lid, JSON.stringify(outcome), { expirationTtl: 2592e3 });
  console.log(JSON.stringify({ event: "write_outcome", lid, qualified: outcome.qualified, booked: outcome.booked }));
  return j({ success: true, lid });
}
__name(handleWriteOutcome, "handleWriteOutcome");
async function handleCaptureAcv(req, env2, ctx) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  const acvRaw = body.acv ?? body.value ?? body.ltv ?? body.customer_value;
  if (!lid) return j({ error: "lid required" }, 400);
  if (acvRaw === void 0 || acvRaw === null) return j({ error: "acv required" }, 400);
  const acv = parseFloat(String(acvRaw).replace(/[^0-9.]/g, ""));
  if (isNaN(acv) || acv <= 0) return j({ error: "acv must be a positive number (AUD)" }, 400);
  const source = String(body.source ?? "bella_voice");
  const bizName = String(body.business_name ?? "your business");
  console.log(JSON.stringify({ event: "capture_acv", lid, acv, source, bizName }));
  await env2.LEADS_KV.put(`lead:${lid}:user_acv`, String(acv));
  console.log(JSON.stringify({ event: "capture_acv_written", lid, acv }));
  return j({
    success: true,
    lid,
    acv,
    currency: "AUD",
    message: `ACV $${acv.toLocaleString()} captured`,
    bella_bridge: `Perfect \u2014 got your average customer value at ${acv.toLocaleString()} dollars. Let me crunch the exact numbers for ${bizName}.`
  });
}
__name(handleCaptureAcv, "handleCaptureAcv");
async function handleSaveConversationData(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const data = body.data ?? {};
  if (!data || Object.keys(data).length === 0) return j({ error: "data required (key-value object)" }, 400);
  const keyMap = {
    acv: "user_acv",
    customer_value: "user_acv",
    ltv: "user_acv",
    website_leads: "user_website_leads",
    leads_per_week: "user_website_leads",
    ad_leads: "user_ad_leads",
    phone_leads: "user_phone_leads",
    phone_bookings: "user_phone_leads",
    reviews: "user_reviews",
    google_reviews: "user_reviews",
    old_crm: "user_old_crm",
    crm_size: "user_old_crm",
    followup_rate: "user_followup_rate",
    follow_up_rate: "user_followup_rate"
  };
  const savedKeys = [];
  for (const [field, val] of Object.entries(data)) {
    const schemaKey = keyMap[field];
    if (schemaKey) {
      await env2.LEADS_KV.put(`lead:${lid}:${schemaKey}`, String(val));
      savedKeys.push(`lead:${lid}:${schemaKey}`);
    }
  }
  console.log(JSON.stringify({ event: "save_conversation_data", lid, saved_keys: savedKeys }));
  return j({ success: true, lid, saved: savedKeys });
}
__name(handleSaveConversationData, "handleSaveConversationData");
async function handleGetConversationMemory(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const [acvStr, websiteStr, adStr, phoneStr, reviewsStr, crmStr, followupStr] = await Promise.all([
    env2.LEADS_KV.get(`lead:${lid}:user_acv`),
    env2.LEADS_KV.get(`lead:${lid}:user_website_leads`),
    env2.LEADS_KV.get(`lead:${lid}:user_ad_leads`),
    env2.LEADS_KV.get(`lead:${lid}:user_phone_leads`),
    env2.LEADS_KV.get(`lead:${lid}:user_reviews`),
    env2.LEADS_KV.get(`lead:${lid}:user_old_crm`),
    env2.LEADS_KV.get(`lead:${lid}:user_followup_rate`)
  ]);
  const acv = acvStr ? Number(acvStr) || null : null;
  const memory = {
    user_acv: acv,
    user_website_leads: websiteStr ? Number(websiteStr) : null,
    user_ad_leads: adStr ? Number(adStr) : null,
    user_phone_leads: phoneStr ? Number(phoneStr) : null,
    user_reviews: reviewsStr ? Number(reviewsStr) : null,
    user_old_crm: crmStr ? Number(crmStr) : null,
    user_followup_rate: followupStr ? Number(followupStr) : null
  };
  const known = Object.entries(memory).filter(([_, v]) => v !== null).map(([k]) => k);
  const summary = known.length > 0 ? `User has shared: ${known.join(", ")}.${acv ? ` ACV confirmed at $${acv}.` : ""}` : `No conversation data saved yet.`;
  return j({ success: true, lid, memory, acv_captured: acv, fields_available: known, summary });
}
__name(handleGetConversationMemory, "handleGetConversationMemory");
async function handleGetRoiConfirmed(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  let agentRanking = [];
  let businessName = "";
  try {
    const intelStr = await env2.LEADS_KV.get(`lead:${lid}:intel`);
    if (intelStr) {
      const intel = JSON.parse(intelStr);
      const routing = intel.routing ?? {};
      agentRanking = intel.agent_ranking?.length ? intel.agent_ranking : intel.recommended_agents?.length ? intel.recommended_agents : routing.top_agents?.length ? routing.top_agents : [];
      businessName = intel.core_identity?.business_name ?? "";
    }
  } catch {
  }
  if (agentRanking.length === 0) {
    try {
      const rawStr = await env2.LEADS_KV.get(`lead:${lid}`) ?? await env2.LEADS_KV.get(lid);
      if (rawStr) {
        const raw = JSON.parse(rawStr);
        businessName = businessName || raw.business_name || raw.businessName || "";
        const pf = raw.prioritized_fixes?.topFixes ?? [];
        const seen = /* @__PURE__ */ new Set();
        for (const fix of pf) {
          const a = String(fix.agent ?? "").toLowerCase();
          if (a && !seen.has(a)) {
            agentRanking.push(a);
            seen.add(a);
          }
        }
        const ac = raw.consultative_intelligence?.agentCopy ?? {};
        for (const a of ["alex", "chris", "maddie", "james", "sarah"]) {
          if (!seen.has(a) && ac[a]) {
            agentRanking.push(a);
            seen.add(a);
          }
        }
        if (!businessName || businessName === "your business") {
          const rawUrl = raw.url || raw.websiteUrl || "";
          if (rawUrl) {
            try {
              const hostname = new URL(rawUrl.startsWith("http") ? rawUrl : "https://" + rawUrl).hostname.replace(/^www\./, "");
              businessName = hostname.split(".")[0].charAt(0).toUpperCase() + hostname.split(".")[0].slice(1);
            } catch {
            }
          }
        }
      }
    } catch {
    }
  }
  let acvValue = null;
  try {
    const acvStr = await env2.LEADS_KV.get(`lead:${lid}:acv`);
    if (acvStr) acvValue = JSON.parse(acvStr)?.value ?? null;
  } catch {
  }
  const topAgents = agentRanking.slice(0, 5);
  const results = {};
  let totalMonthly = 0;
  const roiReads = topAgents.map(async (agent) => {
    let roi = null;
    const confirmedStr = await env2.LEADS_KV.get(`lead:${lid}:${agent}:roi_confirmed`);
    if (confirmedStr) {
      try {
        roi = JSON.parse(confirmedStr);
        roi._source = "confirmed";
      } catch {
      }
    }
    if (!roi) {
      const estimateStr = await env2.LEADS_KV.get(`lead:${lid}:${agent}:roi_estimate`);
      if (estimateStr) {
        try {
          roi = JSON.parse(estimateStr);
          roi._source = "estimate";
        } catch {
        }
      }
    }
    return { agent, roi };
  });
  for (const { agent, roi } of await Promise.all(roiReads)) {
    if (roi) {
      results[agent] = roi;
      totalMonthly += Number(roi.monthly_opportunity ?? 0);
    }
  }
  function toWords(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(".0", "")} million`;
    if (n >= 1e3) return `${Math.round(n / 1e3)} thousand`;
    return String(Math.round(n));
  }
  __name(toWords, "toWords");
  const summaryLines = [];
  for (const [agent, roi] of Object.entries(results)) {
    const mo = Number(roi.monthly_opportunity ?? 0);
    if (mo > 0) summaryLines.push(`${agent} \u2014 ${toWords(mo)} dollars a month`);
  }
  const combinedSpoken = totalMonthly > 0 ? `Total combined opportunity: ${toWords(totalMonthly)} dollars a month` : "ROI still calculating \u2014 use benchmark estimates";
  console.log(JSON.stringify({ event: "get_roi_confirmed", lid, totalMonthly, agentsFound: Object.keys(results) }));
  return j({
    success: true,
    lid,
    business_name: businessName,
    acv_confirmed: acvValue,
    currency: "AUD",
    top_agents: topAgents,
    roi: results,
    total_monthly_opportunity: totalMonthly,
    spoken_summary: summaryLines,
    combined_spoken: combinedSpoken,
    voice_ready: `Here are the numbers for ${businessName || "your business"}. ${summaryLines.join(". ")}. ${combinedSpoken}.`
  });
}
__name(handleGetRoiConfirmed, "handleGetRoiConfirmed");
async function handleFetchScriptStage(req, env2) {
  const body = await req.json();
  const lid = String(body.lid ?? "").trim();
  const stage = String(body.stage ?? "").trim().toLowerCase();
  if (!lid) return j({ error: "lid required" }, 400);
  if (!stage) return j({ error: "stage required" }, 400);
  const [stagesJson, intelJson, rawLeadJson, acvJson] = await Promise.all([
    env2.LEADS_KV.get(`lead:${lid}:script_stages`),
    env2.LEADS_KV.get(`lead:${lid}:intel`),
    env2.LEADS_KV.get(`lead:${lid}`),
    env2.LEADS_KV.get(`lead:${lid}:acv`)
  ]);
  if (!stagesJson) {
    return j({ found: false, stage, instructions: null, message: "No script stages loaded for this lead yet." });
  }
  let stages = {};
  try {
    stages = JSON.parse(stagesJson);
  } catch {
    return j({ error: "script_stages corrupted \u2014 re-seed KV" }, 500);
  }
  const stageData = stages[stage] ?? null;
  if (!stageData) {
    return j({ found: false, stage, available_stages: Object.keys(stages), instructions: null });
  }
  let text;
  let fallbacks = [];
  if (typeof stageData === "string") {
    text = stageData;
  } else if (typeof stageData === "object" && stageData.text) {
    text = String(stageData.text);
    fallbacks = Array.isArray(stageData.fallbacks) ? stageData.fallbacks : [];
  } else {
    text = JSON.stringify(stageData);
  }
  const vars = {};
  try {
    const intel = intelJson ? JSON.parse(intelJson) : {};
    const raw = rawLeadJson ? JSON.parse(rawLeadJson) : {};
    const ci = intel.core_identity ?? {};
    const wh = intel.website_health ?? {};
    const flags = intel.flags ?? {};
    const acvData = acvJson ? JSON.parse(acvJson) : null;
    vars["first_name"] = ci.first_name ?? raw.firstName ?? raw.first_name ?? "";
    vars["business_name"] = ci.business_name ?? raw.businessName ?? raw.business_name ?? "";
    vars["industry"] = ci.industry ?? raw.industry ?? "";
    vars["location"] = ci.location ?? raw.location ?? "";
    vars["years_in_business"] = String(ci.years_in_business ?? raw.years_in_business ?? "");
    vars["star_rating"] = String(wh.google_rating ?? raw.star_rating ?? "");
    vars["review_count"] = String(wh.review_count ?? raw.review_count ?? "");
    vars["acv_benchmark"] = String(intel.industry_benchmark?.acv ?? raw.acv_benchmark ?? "");
    vars["acv_value"] = String(acvData?.value ?? intel.industry_benchmark?.acv ?? "");
    vars["ad_funnel_verdict"] = String(flags.ad_funnel_verdict ?? raw.ad_funnel_verdict ?? "");
    vars["hero_header_quote"] = String(raw.hero_header_quote ?? ci.tagline ?? "");
    vars["website_positive_comment"] = String(raw.website_positive_comment ?? "it presents well");
    vars["icp_guess"] = String(raw.icp_guess ?? raw.target_audience ?? "");
    vars["reference_offer"] = String(raw.reference_offer ?? "");
    vars["top_2_website_ctas"] = String(raw.top_2_website_ctas ?? "calls to action");
    vars["ads_platforms"] = flags.is_running_ads ? "Facebook and Google" : "";
    const ca = raw.campaign_analysis ?? {};
    vars["campaign_analysis.offer"] = String(ca.offer ?? "");
    vars["campaign_analysis.icp_guess"] = String(ca.icp_guess ?? raw.icp_guess ?? raw.target_audience ?? "");
    vars["campaign_analysis.campaign_summary"] = String(ca.headline ?? ca.funnel_type ?? "ads running");
    const ranking = intel.agent_ranking ?? [];
    vars["agent_1"] = ranking[0] ?? "";
    vars["agent_2"] = ranking[1] ?? "";
    vars["agent_3"] = ranking[2] ?? "";
  } catch {
  }
  const inject = /* @__PURE__ */ __name((s) => s.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const val = vars[key.trim()];
    return val !== void 0 && val !== "" && val !== "undefined" ? val : match;
  }), "inject");
  const injectedText = inject(text);
  const injectedFallbacks = fallbacks.map(inject);
  console.log(JSON.stringify({ event: "fetch_script_stage", lid, stage }));
  return j({ found: true, stage, instructions: injectedText, fallbacks: injectedFallbacks });
}
__name(handleFetchScriptStage, "handleFetchScriptStage");
var index_default = {
  async fetch(req, env2, ctx) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization"
        }
      });
    }
    const url = new URL(req.url);
    const path = url.pathname;

    // ── V3 CHUNK 1 STUB: /snapshot/{lid} ──
    const snapshotMatch = path.match(/^\/snapshot\/([a-z0-9_-]+)$/i);
    if (snapshotMatch) {
      const lid = snapshotMatch[1];
      const intel = await env2.LEADS_KV.get(`lead:${lid}:intel`, { type: "json" });
      const memory = await env2.LEADS_KV.get(`lead:${lid}:memory`, { type: "json" });
      return new Response(JSON.stringify({ lid, intel, memory, status: "ok", ts: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    // ──────────────────────────────────────

    if (path === "/health") {
      return j({
        status: "ok",
        worker: "bella-tools-worker-v9",
        endpoints: [
          "/resolve_intel_hot",
          "/kv_get_fact",
          "/kv_search",
          "/save_lead_patch",
          "/log_event",
          "/handoff_action",
          "/write_outcome",
          "/capture_acv",
          "/get_roi_confirmed",
          "/save_conversation_data",
          "/get_conversation_memory",
          "/fetch_script_stage"
        ]
      });
    }
    if (req.method !== "POST") return j({ error: "POST required" }, 405);
    if (!auth(req, env2)) return j({ error: "Unauthorized" }, 401);
    if (path === "/resolve_intel_hot") return handleResolveIntelHot(req, env2);
    if (path === "/kv_get_fact") return handleKvGetFact(req, env2);
    if (path === "/kv_write") return handleKvWrite(req, env2);
    if (path === "/kv_search") return handleKvSearch(req, env2);
    if (path === "/save_lead_patch") return handleSaveLeadPatch(req, env2);
    if (path === "/log_event") return handleLogEvent(req, env2);
    if (path === "/handoff_action") return handleHandoffAction(req, env2);
    if (path === "/write_outcome") return handleWriteOutcome(req, env2);
    if (path === "/capture_acv") return handleCaptureAcv(req, env2, ctx);
    if (path === "/get_roi_confirmed") return handleGetRoiConfirmed(req, env2);
    if (path === "/save_conversation_data") return handleSaveConversationData(req, env2);
    if (path === "/get_conversation_memory") return handleGetConversationMemory(req, env2);
    if (path === "/fetch_script_stage") return handleFetchScriptStage(req, env2);
    return j({ error: "Not found" }, 404);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

