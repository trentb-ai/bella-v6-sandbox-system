var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

function extractAIText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result?.response === 'string') return result.response;
  if (typeof result?.result?.response === 'string') return result.result.response;
  if (Array.isArray(result?.result)) return result.result.map(r => r?.response || '').join('');
  return '';
}

// ../../node_modules/unenv/dist/runtime/_internal/utils.mjs
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

// ../../node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
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

// ../../node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../../node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
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
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// ../../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../../node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
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

// ../../node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
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
  getColorDepth(env3) {
    return 1;
  }
  hasColors(count, env3) {
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

// ../../node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process2 extends EventEmitter {
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
    for (const prop of [...Object.getOwnPropertyNames(_Process2.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
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
  chdir(cwd3) {
    this.#cwd = cwd3;
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

// ../../node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
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

// ../../node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/index.js
import { EventEmitter as EventEmitter2 } from "node:events";
import { WorkflowEntrypoint } from "cloudflare:workers";
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
// @__NO_SIDE_EFFECTS__
function createNotImplementedError2(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError2, "createNotImplementedError");
__name2(createNotImplementedError2, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented2(name) {
  const fn = /* @__PURE__ */ __name2(() => {
    throw /* @__PURE__ */ createNotImplementedError2(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented2, "notImplemented");
__name2(notImplemented2, "notImplemented");
var _timeOrigin2 = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow2 = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin2;
var nodeTiming2 = {
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
var PerformanceEntry2 = class {
  static {
    __name(this, "PerformanceEntry");
  }
  static {
    __name2(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow2();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow2() - this.startTime;
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
var PerformanceMark3 = class PerformanceMark22 extends PerformanceEntry2 {
  static {
    __name(this, "PerformanceMark2");
  }
  static {
    __name2(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure2 = class extends PerformanceEntry2 {
  static {
    __name(this, "PerformanceMeasure");
  }
  static {
    __name2(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming2 = class extends PerformanceEntry2 {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  static {
    __name2(this, "PerformanceResourceTiming");
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
var PerformanceObserverEntryList2 = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  static {
    __name2(this, "PerformanceObserverEntryList");
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
var Performance2 = class {
  static {
    __name(this, "Performance");
  }
  static {
    __name2(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin2;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw /* @__PURE__ */ createNotImplementedError2("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming2;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming2("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin2) {
      return _performanceNow2();
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
    const entry = new PerformanceMark3(name, options);
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
    const entry = new PerformanceMeasure2(measureName, {
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
    throw /* @__PURE__ */ createNotImplementedError2("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw /* @__PURE__ */ createNotImplementedError2("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw /* @__PURE__ */ createNotImplementedError2("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver2 = class {
  static {
    __name(this, "PerformanceObserver");
  }
  static {
    __name2(this, "PerformanceObserver");
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
    throw /* @__PURE__ */ createNotImplementedError2("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw /* @__PURE__ */ createNotImplementedError2("PerformanceObserver.observe");
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
var performance2 = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance2();
globalThis.performance = performance2;
globalThis.Performance = Performance2;
globalThis.PerformanceEntry = PerformanceEntry2;
globalThis.PerformanceMark = PerformanceMark3;
globalThis.PerformanceMeasure = PerformanceMeasure2;
globalThis.PerformanceObserver = PerformanceObserver2;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList2;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming2;
var hrtime4 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name2(/* @__PURE__ */ __name(function hrtime22(startTime) {
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
}, "hrtime2"), "hrtime"), { bigint: /* @__PURE__ */ __name2(/* @__PURE__ */ __name(function bigint2() {
  return BigInt(Date.now() * 1e6);
}, "bigint"), "bigint") });
var ReadStream2 = class {
  static {
    __name(this, "ReadStream");
  }
  static {
    __name2(this, "ReadStream");
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
var WriteStream2 = class {
  static {
    __name(this, "WriteStream");
  }
  static {
    __name2(this, "WriteStream");
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
  getColorDepth(env22) {
    return 1;
  }
  hasColors(count, env22) {
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
var NODE_VERSION2 = "22.14.0";
var Process2 = class _Process extends EventEmitter2 {
  static {
    __name(this, "_Process");
  }
  static {
    __name2(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter2.prototype)]) {
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
    return this.#stdin ??= new ReadStream2(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream2(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream2(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd22) {
    this.#cwd = cwd22;
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
    return `v${NODE_VERSION2}`;
  }
  get versions() {
    return { node: NODE_VERSION2 };
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
    throw /* @__PURE__ */ createNotImplementedError2("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw /* @__PURE__ */ createNotImplementedError2("process.getActiveResourcesInfo");
  }
  exit() {
    throw /* @__PURE__ */ createNotImplementedError2("process.exit");
  }
  reallyExit() {
    throw /* @__PURE__ */ createNotImplementedError2("process.reallyExit");
  }
  kill() {
    throw /* @__PURE__ */ createNotImplementedError2("process.kill");
  }
  abort() {
    throw /* @__PURE__ */ createNotImplementedError2("process.abort");
  }
  dlopen() {
    throw /* @__PURE__ */ createNotImplementedError2("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw /* @__PURE__ */ createNotImplementedError2("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw /* @__PURE__ */ createNotImplementedError2("process.loadEnvFile");
  }
  disconnect() {
    throw /* @__PURE__ */ createNotImplementedError2("process.disconnect");
  }
  cpuUsage() {
    throw /* @__PURE__ */ createNotImplementedError2("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw /* @__PURE__ */ createNotImplementedError2("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw /* @__PURE__ */ createNotImplementedError2("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw /* @__PURE__ */ createNotImplementedError2("process.initgroups");
  }
  openStdin() {
    throw /* @__PURE__ */ createNotImplementedError2("process.openStdin");
  }
  assert() {
    throw /* @__PURE__ */ createNotImplementedError2("process.assert");
  }
  binding() {
    throw /* @__PURE__ */ createNotImplementedError2("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented2("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented2("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented2("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented2("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented2("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented2("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name2(() => 0, "rss") });
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
var globalProcess2 = globalThis["process"];
var getBuiltinModule2 = globalProcess2.getBuiltinModule;
var workerdProcess2 = getBuiltinModule2("node:process");
var unenvProcess2 = new Process2({
  env: globalProcess2.env,
  hrtime: hrtime4,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess2.nextTick
});
var { exit: exit2, features: features2, platform: platform2 } = workerdProcess2;
var {
  _channel: _channel2,
  _debugEnd: _debugEnd2,
  _debugProcess: _debugProcess2,
  _disconnect: _disconnect2,
  _events: _events2,
  _eventsCount: _eventsCount2,
  _exiting: _exiting2,
  _fatalException: _fatalException2,
  _getActiveHandles: _getActiveHandles2,
  _getActiveRequests: _getActiveRequests2,
  _handleQueue: _handleQueue2,
  _kill: _kill2,
  _linkedBinding: _linkedBinding2,
  _maxListeners: _maxListeners2,
  _pendingMessage: _pendingMessage2,
  _preload_modules: _preload_modules2,
  _rawDebug: _rawDebug2,
  _send: _send2,
  _startProfilerIdleNotifier: _startProfilerIdleNotifier2,
  _stopProfilerIdleNotifier: _stopProfilerIdleNotifier2,
  _tickCallback: _tickCallback2,
  abort: abort2,
  addListener: addListener2,
  allowedNodeEnvironmentFlags: allowedNodeEnvironmentFlags2,
  arch: arch2,
  argv: argv2,
  argv0: argv02,
  assert: assert2,
  availableMemory: availableMemory2,
  binding: binding2,
  channel: channel2,
  chdir: chdir2,
  config: config2,
  connected: connected2,
  constrainedMemory: constrainedMemory2,
  cpuUsage: cpuUsage2,
  cwd: cwd2,
  debugPort: debugPort2,
  disconnect: disconnect2,
  dlopen: dlopen2,
  domain: domain2,
  emit: emit2,
  emitWarning: emitWarning2,
  env: env2,
  eventNames: eventNames2,
  execArgv: execArgv2,
  execPath: execPath2,
  exitCode: exitCode2,
  finalization: finalization2,
  getActiveResourcesInfo: getActiveResourcesInfo2,
  getegid: getegid2,
  geteuid: geteuid2,
  getgid: getgid2,
  getgroups: getgroups2,
  getMaxListeners: getMaxListeners2,
  getuid: getuid2,
  hasUncaughtExceptionCaptureCallback: hasUncaughtExceptionCaptureCallback2,
  hrtime: hrtime32,
  initgroups: initgroups2,
  kill: kill2,
  listenerCount: listenerCount2,
  listeners: listeners2,
  loadEnvFile: loadEnvFile2,
  mainModule: mainModule2,
  memoryUsage: memoryUsage2,
  moduleLoadList: moduleLoadList2,
  nextTick: nextTick2,
  off: off2,
  on: on2,
  once: once2,
  openStdin: openStdin2,
  permission: permission2,
  pid: pid2,
  ppid: ppid2,
  prependListener: prependListener2,
  prependOnceListener: prependOnceListener2,
  rawListeners: rawListeners2,
  reallyExit: reallyExit2,
  ref: ref2,
  release: release2,
  removeAllListeners: removeAllListeners2,
  removeListener: removeListener2,
  report: report2,
  resourceUsage: resourceUsage2,
  send: send2,
  setegid: setegid2,
  seteuid: seteuid2,
  setgid: setgid2,
  setgroups: setgroups2,
  setMaxListeners: setMaxListeners2,
  setSourceMapsEnabled: setSourceMapsEnabled2,
  setuid: setuid2,
  setUncaughtExceptionCaptureCallback: setUncaughtExceptionCaptureCallback2,
  sourceMapsEnabled: sourceMapsEnabled2,
  stderr: stderr2,
  stdin: stdin2,
  stdout: stdout2,
  throwDeprecation: throwDeprecation2,
  title: title2,
  traceDeprecation: traceDeprecation2,
  umask: umask2,
  unref: unref2,
  uptime: uptime2,
  version: version2,
  versions: versions2
} = unenvProcess2;
var _process2 = {
  abort: abort2,
  addListener: addListener2,
  allowedNodeEnvironmentFlags: allowedNodeEnvironmentFlags2,
  hasUncaughtExceptionCaptureCallback: hasUncaughtExceptionCaptureCallback2,
  setUncaughtExceptionCaptureCallback: setUncaughtExceptionCaptureCallback2,
  loadEnvFile: loadEnvFile2,
  sourceMapsEnabled: sourceMapsEnabled2,
  arch: arch2,
  argv: argv2,
  argv0: argv02,
  chdir: chdir2,
  config: config2,
  connected: connected2,
  constrainedMemory: constrainedMemory2,
  availableMemory: availableMemory2,
  cpuUsage: cpuUsage2,
  cwd: cwd2,
  debugPort: debugPort2,
  dlopen: dlopen2,
  disconnect: disconnect2,
  emit: emit2,
  emitWarning: emitWarning2,
  env: env2,
  eventNames: eventNames2,
  execArgv: execArgv2,
  execPath: execPath2,
  exit: exit2,
  finalization: finalization2,
  features: features2,
  getBuiltinModule: getBuiltinModule2,
  getActiveResourcesInfo: getActiveResourcesInfo2,
  getMaxListeners: getMaxListeners2,
  hrtime: hrtime32,
  kill: kill2,
  listeners: listeners2,
  listenerCount: listenerCount2,
  memoryUsage: memoryUsage2,
  nextTick: nextTick2,
  on: on2,
  off: off2,
  once: once2,
  pid: pid2,
  platform: platform2,
  ppid: ppid2,
  prependListener: prependListener2,
  prependOnceListener: prependOnceListener2,
  rawListeners: rawListeners2,
  release: release2,
  removeAllListeners: removeAllListeners2,
  removeListener: removeListener2,
  report: report2,
  resourceUsage: resourceUsage2,
  setMaxListeners: setMaxListeners2,
  setSourceMapsEnabled: setSourceMapsEnabled2,
  stderr: stderr2,
  stdin: stdin2,
  stdout: stdout2,
  title: title2,
  throwDeprecation: throwDeprecation2,
  traceDeprecation: traceDeprecation2,
  umask: umask2,
  uptime: uptime2,
  version: version2,
  versions: versions2,
  // @ts-expect-error old API
  domain: domain2,
  initgroups: initgroups2,
  moduleLoadList: moduleLoadList2,
  reallyExit: reallyExit2,
  openStdin: openStdin2,
  assert: assert2,
  binding: binding2,
  send: send2,
  exitCode: exitCode2,
  channel: channel2,
  getegid: getegid2,
  geteuid: geteuid2,
  getgid: getgid2,
  getgroups: getgroups2,
  getuid: getuid2,
  setegid: setegid2,
  seteuid: seteuid2,
  setgid: setgid2,
  setgroups: setgroups2,
  setuid: setuid2,
  permission: permission2,
  mainModule: mainModule2,
  _events: _events2,
  _eventsCount: _eventsCount2,
  _exiting: _exiting2,
  _maxListeners: _maxListeners2,
  _debugEnd: _debugEnd2,
  _debugProcess: _debugProcess2,
  _fatalException: _fatalException2,
  _getActiveHandles: _getActiveHandles2,
  _getActiveRequests: _getActiveRequests2,
  _kill: _kill2,
  _preload_modules: _preload_modules2,
  _rawDebug: _rawDebug2,
  _startProfilerIdleNotifier: _startProfilerIdleNotifier2,
  _stopProfilerIdleNotifier: _stopProfilerIdleNotifier2,
  _tickCallback: _tickCallback2,
  _disconnect: _disconnect2,
  _handleQueue: _handleQueue2,
  _pendingMessage: _pendingMessage2,
  _channel: _channel2,
  _send: _send2,
  _linkedBinding: _linkedBinding2
};
var process_default2 = _process2;
globalThis.process = process_default2;
var BellaV9Orchestrator = class extends WorkflowEntrypoint {
  static {
    __name(this, "BellaV9Orchestrator");
  }
  static {
    __name2(this, "BellaV9Orchestrator");
  }
  async run(event, step) {
    console.log("type:WF_START:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":eventTimestamp:" + event.timestamp + ":payload:" + JSON.stringify(event.payload));
    const _workflowResults = {};
    const _workflowState = {};
    try {
      console.log("type:WF_NODE_START:nodeId:node-entry:nodeName:entry:nodeType:entry:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_entry_0 = event.payload || {};
      _workflowState["node-entry"] = {
        input: event.payload,
        output: _workflowResults.step_entry_0
      };
      _workflowState["node-entry"] = _workflowState["node-entry"] || { output: _workflowResults.step_entry_0 };
      console.log("type:WF_NODE_END:nodeId:node-entry:nodeName:entry:nodeType:entry:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-entry"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-entry:nodeName:entry:nodeType:entry:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-kv-stub:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_kv_put_1 = await step.do("step_kv_put_1", async () => {
        const inputData = _workflowState["node-entry"]?.output || event.payload;
        const key = `lead:${_workflowResults.step_entry_0.lid}:stub`;
        const value = `{"status": "pending", "basics": {"name": "${_workflowResults.step_entry_0.name}", "url": "${_workflowResults.step_entry_0.url}", "firstName": "${_workflowResults.step_entry_0.firstName}"}}`;
        await this.env["WORKFLOWS_KV"].put(key, value, {
          expirationTtl: 3600
        });
        const result = { success: true, key };
        _workflowState["node-kv-stub"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-kv-stub"] = _workflowState["node-kv-stub"] || { output: _workflowResults.step_kv_put_1 };
      console.log("type:WF_NODE_END:nodeId:node-kv-stub:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-kv-stub"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-kv-stub:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-firecrawl:nodeName:http-request:nodeType:http-request:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_http_request_2 = await step.do("step_http_request_2", async () => {
        const inputData = _workflowState["node-kv-stub"]?.output || event.payload;
        const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.env.FIRECRAWL_KEY}`,
            "Content-Type": "application/json"
          },
          body: `{"url": "${_workflowResults.step_entry_0.url}", "formats": ["markdown"], "onlyMainContent": true}`,
          signal: AbortSignal.timeout(15e4)
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const body = await response.json();
        const result = {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body,
          message: "HTTP request completed successfully"
        };
        _workflowState["node-firecrawl"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-firecrawl"] = _workflowState["node-firecrawl"] || { output: _workflowResults.step_http_request_2 };
      console.log("type:WF_NODE_END:nodeId:node-firecrawl:nodeName:http-request:nodeType:http-request:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-firecrawl"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-firecrawl:nodeName:http-request:nodeType:http-request:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-truncate-content:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_transform_3 = await step.do("step_transform_3", async () => {
        const inputData = _workflowState["node-firecrawl"]?.output || event.payload;
        const result = await (async () => {
          const fcResp = _workflowState["node-firecrawl"]?.output?.body || {};
          const entries = Object.entries(fcResp);
          const mainEntry = entries.find(([k]) => k !== "success");
          const scrapeObj = mainEntry ? mainEntry[1] : {};
          const md = (scrapeObj?.markdown || "").slice(0, 4e3);
          return { content: md };
        })();
        _workflowState["node-truncate-content"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-truncate-content"] = _workflowState["node-truncate-content"] || { output: _workflowResults.step_transform_3 };
      console.log("type:WF_NODE_END:nodeId:node-truncate-content:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-truncate-content"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-truncate-content:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_transform_4 = await step.do("step_transform_4", async () => {
        const inputData = _workflowState["node-truncate-content"]?.output || event.payload;
        const result = await (async () => {
          const entry = _workflowState["node-entry"]?.output || {};
          const lid = entry.lid || "";

          // CHECK FOR PRE-FIRED RUNS from /fire-apify endpoint (T=0 optimization)
          if (lid) {
            try {
              const prefiredRaw = await this.env.WORKFLOWS_KV.get("lead:" + lid + ":apify_runs");
              if (prefiredRaw) {
                const prefired = JSON.parse(prefiredRaw);
                const hasRuns = Object.values(prefired).some(r => r && r.runId);
                if (hasRuns) {
                  console.log("[fire-apify] REUSING pre-fired runs for lid=" + lid);
                  return prefired;
                }
              }
            } catch (e) {
              console.log("[fire-apify] Failed to read pre-fired runs: " + e.message);
            }
          }

          // FALLBACK: fire actors now (no pre-fired runs found)
          // Workflow runs AFTER fast-intel, so Consultant name should be in KV already
          const siteUrl = entry.url || "";
          const fallbackName = entry.name || "";
          let bizName = "";
          let bizLocation = "";
          // PRIMARY: Consultant's corrected name + location from KV (should already exist)
          try {
            const fiRaw = await this.env["WORKFLOWS_KV"].get("lead:" + lid + ":fast-intel", { type: "json" });
            if (fiRaw) {
              bizName = fiRaw.business_name || (fiRaw.core_identity && fiRaw.core_identity.business_name) || "";
              bizLocation = (fiRaw.core_identity && fiRaw.core_identity.location) || "";
              if (bizName) console.log("[fire-apify-fallback] Got bizName from Consultant KV: " + bizName + " location: " + bizLocation);
            }
          } catch (e) { /* ignore */ }
          // FALLBACK: HTML title extraction if Consultant name missing
          if (!bizName && siteUrl) {
            try {
              const pageResp = await fetch(siteUrl, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(3000) });
              const html = await pageResp.text();
              const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
              if (titleMatch) {
                bizName = titleMatch[1].trim()
                  .replace(/^(home|welcome|about|main)\s*[\|\-\u2013\u2014:]\s*/i, "")
                  .replace(/\s*[\|\-\u2013\u2014:]\s*(home|welcome|official|about|main|site|page|australia|au).*$/i, "")
                  .replace(/\s*[\|\-\u2013\u2014:]\s*$/, "")
                  .trim();
                console.log("[fire-apify-fallback] Got bizName from page title: " + bizName);
              }
            } catch (e) {
              console.log("[fire-apify-fallback] Title fetch failed: " + e.message);
            }
          }
          if (!bizName) {
            bizName = fallbackName || (siteUrl ? new URL(siteUrl).hostname.replace("www.", "") : "");
            console.log("[fire-apify-fallback] WARN: falling back to: " + bizName);
          }
          const linkedinSlug = bizName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").replace(/^-|-$/g, "");
          const mapsSearch = bizLocation ? bizName + " " + bizLocation : bizName;
          const apifyTk = this.env.APIFY_TOKEN || this.env.APIFY_API_KEY;
          const actors = [
            { key: "facebook_ads", actor: "apify~facebook-ads-scraper", payload: { startUrls: [{ url: "https://www.facebook.com/ads/library/?search_term=" + encodeURIComponent(bizName) }], maxAds: 5 } },
            { key: "google_ads", actor: "apify~google-search-scraper", payload: { queries: bizName + " ads", maxPagesPerQuery: 1 } },
            { key: "indeed", actor: "misceres~indeed-scraper", payload: { position: "", company: bizName, country: "AU", maxItems: 5 } },
            { key: "google_maps", actor: "compass~google-maps-reviews-scraper", payload: { searchStringsArray: [mapsSearch], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 5 } },
            { key: "linkedin", actor: "curious_coder~linkedin-company-scraper", payload: { urls: ["https://www.linkedin.com/company/" + linkedinSlug], proxy: { useApifyProxy: true } } }
          ];
          const startResults = await Promise.all(
            actors.map(
              (a) => fetch("https://api.apify.com/v2/acts/" + a.actor + "/runs?token=" + apifyTk, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(a.payload)
              }).then((r) => r.json()).then((j) => {
                const dObj = Object.values(j || {}).find((v) => v && typeof v === "object") || {};
                return { key: a.key, runId: dObj.id || null, status: "started" };
              }).catch((e) => ({ key: a.key, runId: null, status: "failed", error: e.message }))
            )
          );
          const runs = {};
          startResults.forEach((r) => {
            runs[r.key] = r;
          });
          return runs;
        })();
        _workflowState["node-fire-apify"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-fire-apify"] = _workflowState["node-fire-apify"] || { output: _workflowResults.step_transform_4 };
      console.log("type:WF_NODE_END:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-fire-apify"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-consultant-ai:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_workers_ai_5 = await step.do("step_workers_ai_5", async () => {
        const inputData = _workflowState["node-fire-apify"]?.output || event.payload;
        const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          prompt: `The business name is ${JSON.stringify(_workflowState["node-entry"].output.name)}. Using content from ${JSON.stringify(_workflowResults.step_transform_3.content)}, output one polished paragraph only. Flattery + sophisticated insight on market positioning, who they help, how they help. Always use the business name naturally the way a human would say it in conversation \u2014 e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no tone analysis, no bullets.`,
          temperature: 0.7
        });
        const result = {
          response,
          text: response.response || response.text || JSON.stringify(response),
          usage: response.usage || {}
        };
        _workflowState["node-consultant-ai"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-consultant-ai"] = _workflowState["node-consultant-ai"] || { output: _workflowResults.step_workers_ai_5 };
      console.log("type:WF_NODE_END:nodeId:node-consultant-ai:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-consultant-ai"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-consultant-ai:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-kv-phase-a:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_kv_put_6 = await step.do("step_kv_put_6", async () => {
        const inputData = _workflowState["node-consultant-ai"]?.output || event.payload;
        const key = `lead:${_workflowResults.step_entry_0.lid}:phase_a`;
        const value = `${_workflowResults.step_workers_ai_5.text}`;
        await this.env["WORKFLOWS_KV"].put(key, value, {
          expirationTtl: 3600
        });
        const result = { success: true, key };
        _workflowState["node-kv-phase-a"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-kv-phase-a"] = _workflowState["node-kv-phase-a"] || { output: _workflowResults.step_kv_put_6 };
      console.log("type:WF_NODE_END:nodeId:node-kv-phase-a:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-kv-phase-a"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-kv-phase-a:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    // ── OPTIMIZATION 2: Write script_stages early (only needs lid + name from step_0) ──
    try {
      console.log("type:WF_NODE_START:nodeId:node-early-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_early_stages = await step.do("step_early_stages", async () => {
        const lid = _workflowResults.step_entry_0.lid;
        const bizName = _workflowResults.step_entry_0.name || "your business";
        const stages = [
          { id: 1, key: "wow", agent: "Bella", active: true, script: "WOW \u2014 HOOK IN 30 SECONDS\n\nSAY: \"" + bizName + " audit complete.\"\n\nAsk: \"Before I walk you through the numbers, who typically handles your marketing over there?\"" },
          { id: 2, key: "demo_value_bridge", agent: "Bella", active: true, script: "VALUE BRIDGE\n\nSAY: \"The reason I'm calling is we've benchmarked " + bizName + " against our AI performance standards. I've got some ROI projections I want to show you.\"\n\nAsk: \"Takes about 90 seconds. Sound fair?\"" },
          { id: 3, key: "anchor_acv", agent: "Bella", active: true, capture: "average_customer_value", script: "ANCHOR \u2014 ACV\n\nAsk: \"What's a typical customer worth to " + bizName + " on average? Just a ballpark.\"" },
          { id: 4, key: "anchor_volume", agent: "Bella", active: true, capture: "leads_per_week", script: "ANCHOR \u2014 Volume\n\nAsk: \"Roughly how many enquiries are you seeing per week?\"" }
        ];
        var key = "lead:" + lid + ":script_stages";
        var value = JSON.stringify({ stages: stages });
        await this.env["WORKFLOWS_KV"].put(key, value, { expirationTtl: 86400 });
        return { success: true, key: key, count: stages.length };
      });
      console.log("type:WF_NODE_END:nodeId:node-early-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowResults.step_early_stages));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-early-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
    }
    // waitForEvent removed — event can never arrive (4 mismatches), was a 5-min dead wait
    console.log("type:WF_NODE_START:nodeId:node-wait-call-connected:nodeName:wait-event:nodeType:wait-event:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
    _workflowResults.step_wait_event_7 = { event: null, timedOut: true };
    _workflowState["node-wait-call-connected"] = _workflowState["node-wait-call-connected"] || { output: _workflowResults.step_wait_event_7 };
    console.log("type:WF_NODE_END:nodeId:node-wait-call-connected:nodeName:wait-event:nodeType:wait-event:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-wait-call-connected"]?.output));
    // ── OPTIMIZATION 1: Parallel WOW chain + Apify poll (was steps 8-12) ──
    try {
      console.log("type:WF_NODE_START:nodeId:node-parallel-wow-apify:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      const _parallelResult = await step.do("step_parallel_7", async () => {
        const lid = _workflowResults.step_entry_0.lid;
        const firstName = _workflowState["node-entry"].output.firstName;
        const bizName = _workflowState["node-entry"].output.name;

        const [wowResult, apifyResult] = await Promise.all([
          // ── Chain A: WOW refinement (was steps 8-11) ──
          (async () => {
            // step_8: Read phase_a
            const phaseAKey = `lead:${lid}:phase_a`;
            const phaseAValue = await this.env["WORKFLOWS_KV"].get(phaseAKey, { type: "text" });
            console.log("[PARALLEL] Chain A: phase_a read, chars=" + (phaseAValue?.length || 0));

            // step_9: AI refine WOW
            const aiResp = await this.env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
              prompt: `You are writing the opening 25-40 second WOW script for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is ${JSON.stringify(firstName)}. Their business name is ${JSON.stringify(bizName)}. They just connected to a personalized demo call. Using this background on their business:

        ${JSON.stringify(phaseAValue)}

        Write Bella's opening that: 1) Greets ${JSON.stringify(firstName)} warmly by first name and welcomes them to their personalized demo, 2) References one strong specific observation about their website \u2014 hero message, positioning, or value proposition, 3) Mentions their offer, CTA, ICP, or social proof with genuine appreciation, 4) Connects this intelligence to how the AI team has been pre-trained: 'This is exactly the kind of business intelligence we've already used to pre-train your AI team, so they feel like they've been inside [business] for years.'

        Rules: 3-5 sentences max. Use the business name naturally the way a human would say it in conversation \u2014 e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Never say 'your organization' or 'your firm'. Consultative, warm, confident \u2014 like a trusted strategic advisor who has done deep homework. No criticism, no implied gaps, no fixes \u2014 pure positive. Never say 'As an AI' or '100 data points'. Do NOT ask for numbers or mention ROI yet. Write as spoken dialogue only, no labels or stage directions.`,
              temperature: 0.7,
              max_tokens: 512
            });
            const rawSnippet = aiResp.response || aiResp.text || JSON.stringify(aiResp);
            console.log("[PARALLEL] Chain A: AI refine done, chars=" + rawSnippet.length);

            // step_10: Workers AI polish
            let polished = rawSnippet;
            let geminiStatus = "skipped";
            if (this.env.AI && rawSnippet.length >= 10) {
              try {
                const result = await this.env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
                  messages: [{ role: 'user', content: `You are Bella, a confident, warm female strategic advisor. Polish this script so every single word sounds like natural spoken conversation. Contractions always (it is \u2192 it's, we have \u2192 we've, they are \u2192 they're). Natural rhythm and flow. Shorten any business name to how a human would actually say it aloud (KPMG Australia \u2192 KPMG, Smith & Sons Plumbing \u2192 Smith and Sons). Remove any stiff corporate language \u2014 no "your organization", "your firm", "leverage", "utilize". Keep the meaning and structure identical. Do not shorten or remove any sentences. Output ONLY the polished dialogue, nothing else:\n\n` + rawSnippet }],
                  max_tokens: 2048
                });
                polished = extractAIText(result) || rawSnippet;
                geminiStatus = "wai_ok";
              } catch(e) {
                console.log("[PARALLEL] Chain A: Workers AI error: " + e.message);
                geminiStatus = "wai_error";
              }
            }
            console.log("[PARALLEL] Chain A: Workers AI polish done, status=" + geminiStatus);

            // step_11: Write snippet
            const snippetKey = `lead:${lid}:stage1_snippet`;
            await this.env["WORKFLOWS_KV"].put(snippetKey, polished, { expirationTtl: 3600 });
            console.log("[PARALLEL] Chain A: snippet written");

            return { phaseA: phaseAValue, rawSnippet, polished, geminiStatus, aiUsage: aiResp.usage || {} };
          })(),

          // ── Chain B: Apify poll (was step 12) ──
          (async () => {
            const runs = _workflowState["node-fire-apify"]?.output || {};
            const apifyTk = this.env.APIFY_TOKEN || this.env.APIFY_API_KEY;
            const ACTOR_TIMEOUT_MS = 45000;
            const withTimeout = (promise, ms) =>
              Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
            const pollRun = async (key, runId) => {
              if (!runId) return { key, items: [], status: "no_run" };
              try {
                for (let i = 0; i < 15; i++) {
                  const statusResp = await fetch("https://api.apify.com/v2/actor-runs/" + runId + "?token=" + apifyTk);
                  if (!statusResp.ok) return { key, items: [], status: "api_error_" + statusResp.status };
                  const statusJson = await statusResp.json();
                  const dObj = Object.values(statusJson || {}).find((v) => v && typeof v === "object") || {};
                  const runStatus = dObj.status || "";
                  if (runStatus === "SUCCEEDED") {
                    const dsId = dObj.defaultDatasetId;
                    if (!dsId) return { key, items: [], status: "no_dataset" };
                    const itemsResp = await fetch("https://api.apify.com/v2/datasets/" + dsId + "/items?token=" + apifyTk + "&limit=10");
                    const items = await itemsResp.json();
                    return { key, items: items || [], status: "done" };
                  }
                  if (runStatus === "FAILED" || runStatus === "ABORTED" || runStatus === "TIMED-OUT") {
                    return { key, items: [], status: runStatus.toLowerCase() };
                  }
                  await new Promise((resolve) => setTimeout(resolve, 2e3));
                }
                return { key, items: [], status: "poll_timeout" };
              } catch (e) {
                return { key, items: [], status: "error", error: e.message };
              }
            };
            const results = await Promise.all(
              Object.entries(runs).map(([key, run]) =>
                withTimeout(pollRun(key, run?.runId), ACTOR_TIMEOUT_MS)
                  .then(r => r || { key, items: [], status: "timeout_race" })
              )
            );
            const out = {};
            results.forEach((r) => {
              out[r.key] = r.items;
              if (r.status !== "done") out[r.key + "_status"] = r.status;
            });
            console.log("[PARALLEL] Chain B: Apify poll done, keys=" + Object.keys(out).join(","));
            return out;
          })()
        ]);

        return { wow: wowResult, apify: apifyResult };
      });

      // Populate _workflowResults for downstream steps (13+)
      _workflowResults.step_kv_get_8 = { value: _parallelResult.wow.phaseA, exists: true, metadata: { key: `lead:${_workflowResults.step_entry_0.lid}:phase_a` } };
      _workflowResults.step_workers_ai_9 = { text: _parallelResult.wow.rawSnippet, usage: _parallelResult.wow.aiUsage };
      _workflowResults.step_transform_10 = { text: _parallelResult.wow.polished, raw: _parallelResult.wow.rawSnippet, gemini_status: _parallelResult.wow.geminiStatus };
      _workflowResults.step_kv_put_11 = { success: true, key: `lead:${_workflowResults.step_entry_0.lid}:stage1_snippet` };
      _workflowResults.step_transform_12 = _parallelResult.apify;

      // Populate _workflowState for downstream steps
      _workflowState["node-kv-get-fast"] = { output: _workflowResults.step_kv_get_8 };
      _workflowState["node-ai-refine-wow"] = { output: _workflowResults.step_workers_ai_9 };
      _workflowState["node-gemini-polish"] = { output: _workflowResults.step_transform_10 };
      _workflowState["node-kv-write-snippet"] = { output: _workflowResults.step_kv_put_11 };
      _workflowState["node-collect-apify"] = { output: _workflowResults.step_transform_12 };

      console.log("type:WF_NODE_END:nodeId:node-parallel-wow-apify:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify({ wow_chars: (_parallelResult.wow?.polished?.length || 0), apify_keys: Object.keys(_parallelResult.apify || {}).length }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-parallel-wow-apify:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-extract-deep:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_transform_13 = await step.do("step_transform_13", async () => {
        const inputData = _workflowState["node-collect-apify"]?.output || event.payload;
        const result = await (async () => {
          const scrape = _workflowState["node-collect-apify"]?.output || {};
          const place = (Array.isArray(scrape.google_maps) ? scrape.google_maps[0] : scrape.google_maps) || {};
          const reviews = (place.reviews || []).slice(0, 5).map((r) => ({ text: (r?.text || "").slice(0, 200), stars: r?.stars, name: r?.name }));
          const fbAds = Array.isArray(scrape.facebook_ads) ? scrape.facebook_ads : [];
          const googleAds = Array.isArray(scrape.google_ads) ? scrape.google_ads : [];
          const indeedJobs = Array.isArray(scrape.indeed) ? scrape.indeed : [];
          const linkedinInfo = (Array.isArray(scrape.linkedin) ? scrape.linkedin[0] : scrape.linkedin) || {};
          return { google_rating: place.totalScore || place.rating || null, review_count: place.reviewsCount || 0, address: place.address || null, categories: place.categories || [], reviews_sample: reviews, is_running_fb_ads: fbAds.length > 0, fb_ads_count: fbAds.length, fb_ads_sample: fbAds.slice(0, 3).map((a) => ({ text: (a?.bodyText || a?.caption || "").slice(0, 200), cta: a?.callToActionType || "" })), is_running_google_ads: googleAds.length > 0, google_ads_count: googleAds.length, is_hiring: indeedJobs.length > 0, job_count: indeedJobs.length, jobs_sample: indeedJobs.slice(0, 3).map((j) => ({ title: j?.title || j?.positionName || "", salary: j?.salary || "" })), linkedin_employees: linkedinInfo?.employeeCount || linkedinInfo?.staffCount || null, linkedin_industry: linkedinInfo?.industryName || linkedinInfo?.industry || null, linkedin_description: (linkedinInfo?.description || "").slice(0, 300), raw_json: JSON.stringify({ google_maps: place, fb_ads_count: fbAds.length, google_ads_count: googleAds.length, indeed_count: indeedJobs.length, linkedin: linkedinInfo }) };
        })();
        _workflowState["node-extract-deep"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-extract-deep"] = _workflowState["node-extract-deep"] || { output: _workflowResults.step_transform_13 };
      console.log("type:WF_NODE_END:nodeId:node-extract-deep:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-extract-deep"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-extract-deep:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-kv-deep-flags:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_kv_put_14 = await step.do("step_kv_put_14", async () => {
        const inputData = _workflowState["node-extract-deep"]?.output || event.payload;
        const key = `lead:${_workflowResults.step_entry_0.lid}:deep_flags`;
        const value = `${_workflowResults.step_transform_13.raw_json}`;
        await this.env["WORKFLOWS_KV"].put(key, value, {
          expirationTtl: 86400
        });
        const result = { success: true, key };
        _workflowState["node-kv-deep-flags"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-kv-deep-flags"] = _workflowState["node-kv-deep-flags"] || { output: _workflowResults.step_kv_put_14 };
      console.log("type:WF_NODE_END:nodeId:node-kv-deep-flags:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-kv-deep-flags"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-kv-deep-flags:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-kv-get-deep:nodeName:kv-get:nodeType:kv-get:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_kv_get_15 = await step.do("step_kv_get_15", async () => {
        const inputData = _workflowState["node-kv-deep-flags"]?.output || event.payload;
        const key = `lead:${_workflowResults.step_entry_0.lid}:deep_flags`;
        const value = await this.env["WORKFLOWS_KV"].get(key, { type: "json" });
        const result = {
          value,
          exists: value !== null,
          metadata: value ? { key } : null
        };
        _workflowState["node-kv-get-deep"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-kv-get-deep"] = _workflowState["node-kv-get-deep"] || { output: _workflowResults.step_kv_get_15 };
      console.log("type:WF_NODE_END:nodeId:node-kv-get-deep:nodeName:kv-get:nodeType:kv-get:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-kv-get-deep"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-kv-get-deep:nodeName:kv-get:nodeType:kv-get:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-consultant-ai-v2:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_workers_ai_16 = await step.do("step_workers_ai_16", async () => {
        const inputData = _workflowState["node-kv-get-deep"]?.output || event.payload;
        const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          prompt: `The business name is ${JSON.stringify(_workflowState["node-entry"].output.name)}. Using this deep intelligence about the prospect's business (Google Maps reviews, ads activity, hiring signals, LinkedIn profile):

        ${JSON.stringify(_workflowResults.step_kv_get_15.value)}

        Output one polished paragraph of flattery and insight. Reference their Google rating, reviews, ad campaigns, hiring growth, or LinkedIn presence where available. Focus on their reputation, market activity, and growth trajectory. Always use the business name naturally the way a human would say it in conversation \u2014 e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no negativity. Pure positive positioning. One paragraph only, written as natural speech.`,
          temperature: 0.7
        });
        const result = {
          response,
          text: response.response || response.text || JSON.stringify(response),
          usage: response.usage || {}
        };
        _workflowState["node-consultant-ai-v2"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-consultant-ai-v2"] = _workflowState["node-consultant-ai-v2"] || { output: _workflowResults.step_workers_ai_16 };
      console.log("type:WF_NODE_END:nodeId:node-consultant-ai-v2:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-consultant-ai-v2"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-consultant-ai-v2:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-build-intel-json:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_transform_17 = await step.do("step_transform_17", async () => {
        const inputData = _workflowState["node-consultant-ai-v2"]?.output || event.payload;
        const result = await (async () => {
          const summary = inputData.text || "";
          const deepVal = _workflowResults.step_kv_get_15.value || {};
          return { json: JSON.stringify({ summary, deep_data: deepVal }) };
        })();
        _workflowState["node-build-intel-json"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-build-intel-json"] = _workflowState["node-build-intel-json"] || { output: _workflowResults.step_transform_17 };
      console.log("type:WF_NODE_END:nodeId:node-build-intel-json:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-build-intel-json"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-build-intel-json:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_kv_put_18 = await step.do("step_kv_put_18", async () => {
        const inputData = _workflowState["node-build-intel-json"]?.output || event.payload;
        const key = `lead:${_workflowResults.step_entry_0.lid}:intel`;
        const value = `${_workflowResults.step_transform_17.json}`;
        await this.env["WORKFLOWS_KV"].put(key, value, {
          expirationTtl: 3600
        });
        const result = { success: true, key };
        _workflowState["node-kv-write-intel"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-kv-write-intel"] = _workflowState["node-kv-write-intel"] || { output: _workflowResults.step_kv_put_18 };
      console.log("type:WF_NODE_END:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-kv-write-intel"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-kv-write-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_kv_put_script_stages = await step.do("step_kv_put_script_stages", async () => {
        const lid = _workflowResults.step_entry_0.lid;
        const bizName = _workflowResults.step_entry_0.name || "your business";
        const stages = [
          { id: 1, key: "wow", agent: "Bella", active: true, script: "WOW \u2014 HOOK IN 30 SECONDS\n\nSAY: \"" + bizName + " audit complete.\"\n\nAsk: \"Before I walk you through the numbers, who typically handles your marketing over there?\"" },
          { id: 2, key: "demo_value_bridge", agent: "Bella", active: true, script: "VALUE BRIDGE\n\nSAY: \"The reason I'm calling is we've benchmarked " + bizName + " against our AI performance standards. I've got some ROI projections I want to show you.\"\n\nAsk: \"Takes about 90 seconds. Sound fair?\"" },
          { id: 3, key: "anchor_acv", agent: "Bella", active: true, capture: "average_customer_value", script: "ANCHOR \u2014 ACV\n\nAsk: \"What's a typical customer worth to " + bizName + " on average? Just a ballpark.\"" },
          { id: 4, key: "anchor_volume", agent: "Bella", active: true, capture: "leads_per_week", script: "ANCHOR \u2014 Volume\n\nAsk: \"Roughly how many enquiries are you seeing per week?\"" }
        ];
        var key = "lead:" + lid + ":script_stages";
        var value = JSON.stringify({ stages: stages });
        await this.env["WORKFLOWS_KV"].put(key, value, { expirationTtl: 86400 });
        var result = { success: true, key: key, count: stages.length };
        _workflowState["node-kv-write-stages"] = { input: {}, output: result };
        return result;
      });
      _workflowState["node-kv-write-stages"] = _workflowState["node-kv-write-stages"] || { output: _workflowResults.step_kv_put_script_stages };
      console.log("type:WF_NODE_END:nodeId:node-kv-write-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-kv-write-stages"]?.output));
    } catch (error2) {
      var errorMessage2 = error2 instanceof Error ? error2.message : String(error2);
      console.log("type:WF_NODE_ERROR:nodeId:node-kv-write-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage2);
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-signal-update-kv:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_transform_19 = await step.do("step_transform_19", async () => {
        const inputData = _workflowState["node-kv-write-intel"]?.output || event.payload;
        const result = await (async () => {
          return { signal: "update-kv", status: "intel-ready" };
        })();
        _workflowState["node-signal-update-kv"] = {
          input: inputData,
          output: result
        };
        return result;
      });
      _workflowState["node-signal-update-kv"] = _workflowState["node-signal-update-kv"] || { output: _workflowResults.step_transform_19 };
      console.log("type:WF_NODE_END:nodeId:node-signal-update-kv:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-signal-update-kv"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-signal-update-kv:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    try {
      console.log("type:WF_NODE_START:nodeId:node-return:nodeName:return:nodeType:return:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_return_20 = await step.do("step_return_20", async () => {
        const result = { status: "complete", lid: _workflowResults.step_entry_0.lid, intel: _workflowResults.step_workers_ai_16.text };
        _workflowState["node-return"] = {
          input: _workflowState["node-signal-update-kv"]?.output || event.payload,
          output: result
        };
        return result;
      });
      _workflowState["node-return"] = _workflowState["node-return"] || { output: _workflowResults.step_return_20 };
      console.log("type:WF_NODE_END:nodeId:node-return:nodeName:return:nodeType:return:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-return"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-return:nodeName:return:nodeType:return:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }
    console.log("type:WF_END:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":results:" + JSON.stringify(_workflowResults));
    return _workflowResults;
  }
};
var index_default = {
  async fetch(req, env22) {
    const _cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: _cors });
    }
    const url = new URL(req.url);
    const path = url.pathname;
    if (path.startsWith("/status/")) {
      const instanceId = path.split("/status/")[1];
      if (!instanceId) return Response.json({ error: "Missing instanceId" }, { status: 400 });
      try {
        const instance2 = await env22.BELLAV9ORCHESTRATOR_WORKFLOW.get(instanceId);
        return Response.json({ id: instanceId, details: await instance2.status() });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 404 });
      }
    }
    // ── /fire-apify — T=0 Apify actor pre-fire from capture.html ──────────────
    // Waits for fast-intel Consultant to deliver real business name before firing.
    if (req.method === "POST" && path === "/fire-apify") {
      try {
        const body = await req.json();
        const lid = body.lid;
        const siteUrl = body.url || body.websiteUrl || "";
        const fallbackName = body.name || body.businessName || "";
        const domainName = siteUrl ? new URL(siteUrl).hostname.replace("www.", "") : "";
        const apifyTk = env22.APIFY_TOKEN || env22.APIFY_API_KEY;

        if (!lid || !apifyTk) {
          return Response.json({ error: "Missing lid or APIFY_TOKEN" }, { status: 400, headers: _cors });
        }

        // ── PARALLEL: HTML cross-reference (T=0, ~1-2s) + KV poll for Consultant name (~8-12s) ──
        // Consultant is PRIMARY (reads full homepage copy via Firecrawl+Gemini)
        // HTML signals are CROSS-REFERENCE / FALLBACK

        // 1. Fire HTML fetch immediately (non-blocking) — extracts og:site_name, JSON-LD, title, h1
        const htmlNamePromise = (async () => {
          if (!siteUrl) return { candidates: [], best: "" };
          try {
            const pageResp = await fetch(siteUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BellaBot/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(4000) });
            const html = await pageResp.text();
            const candidates = [];
            // og:site_name
            const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
            if (ogSiteName) candidates.push({ src: "og:site_name", val: ogSiteName[1].trim() });
            // Schema.org JSON-LD
            const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
            for (const m of ldMatches) {
              try {
                const ld = JSON.parse(m[1]);
                const items = Array.isArray(ld) ? ld : [ld];
                for (const item of items) {
                  if (item && item.name && typeof item.name === "string" && ["Organization","LocalBusiness","Corporation","WebSite","ProfessionalService"].includes(item["@type"])) {
                    candidates.push({ src: "jsonld:" + item["@type"], val: item.name.trim() });
                  }
                }
              } catch (e) { /* bad JSON-LD */ }
            }
            // og:title
            const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
            if (ogTitle) candidates.push({ src: "og:title", val: ogTitle[1].trim() });
            // <title> (cleaned)
            const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleTag) {
              const cleaned = titleTag[1].trim()
                .replace(/^(home|welcome|about|main)\s*[\|\-\u2013\u2014:]\s*/i, "")
                .replace(/\s*[\|\-\u2013\u2014:]\s*(home|welcome|official|about|main|site|page|australia|au).*$/i, "")
                .replace(/\s*[\|\-\u2013\u2014:]\s*$/, "")
                .trim();
              if (cleaned) candidates.push({ src: "title", val: cleaned });
            }
            // <h1>
            const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            if (h1Match) candidates.push({ src: "h1", val: h1Match[1].trim() });
            // Pick best HTML signal
            const ogSite = candidates.find(c => c.src === "og:site_name");
            const jsonLd = candidates.find(c => c.src.startsWith("jsonld:"));
            const best = (ogSite || jsonLd || candidates[0])?.val || "";
            const cleanBest = best
              .replace(/\s*(Pty\.?\s*Ltd\.?|Ltd\.?|Inc\.?|LLC|P\/L|ABN\s*\d+).*$/i, "")
              .replace(/\s*(Australia|AU|NZ|USA|UK)\s*$/i, "")
              .trim();
            console.log("[fire-apify] HTML signals: " + candidates.map(c => c.src + ":" + c.val).join(" | "));
            return { candidates, best: cleanBest };
          } catch (e) {
            console.log("[fire-apify] HTML fetch failed: " + e.message);
            return { candidates: [], best: "" };
          }
        })();

        // 2. Single non-blocking KV check for Consultant name (if fast-intel already finished)
        let bizName = "";
        let bizLocation = "";
        let nameSource = "";
        try {
          const fiRaw = await env22.WORKFLOWS_KV.get("lead:" + lid + ":fast-intel", { type: "json" });
          if (fiRaw) {
            bizName = fiRaw.business_name || fiRaw.core_identity?.business_name || "";
            bizLocation = fiRaw.core_identity?.location || "";
            if (bizName) {
              nameSource = "consultant";
              console.log("[fire-apify] Consultant name from KV: " + bizName + " location: " + bizLocation);
            }
          }
        } catch (e) { /* KV not ready yet */ }

        // 3. HTML extraction result (fires at T=0, ready by ~1-2s)
        const htmlResult = await htmlNamePromise;
        if (bizName && htmlResult.best) {
          const match = bizName.toLowerCase().includes(htmlResult.best.toLowerCase()) || htmlResult.best.toLowerCase().includes(bizName.toLowerCase());
          console.log("[fire-apify] XREF consultant=" + bizName + " html=" + htmlResult.best + " match=" + match);
        } else if (!bizName && htmlResult.best) {
          bizName = htmlResult.best;
          nameSource = "html";
          console.log("[fire-apify] Using HTML name: " + bizName);
        }
        if (!bizName) {
          bizName = fallbackName || domainName;
          nameSource = "domain";
          console.log("[fire-apify] WARN: No name from Consultant or HTML, falling back to: " + bizName);
        }

        // LinkedIn slug from real business name (lowercase, spaces to hyphens, no special chars)
        const linkedinSlug = bizName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").replace(/^-|-$/g, "");

        // Google Maps gets location-qualified search to find the right branch
        const mapsSearch = bizLocation ? bizName + " " + bizLocation : bizName;
        const actors = [
          { key: "facebook_ads", actor: "apify~facebook-ads-scraper", payload: { startUrls: [{ url: "https://www.facebook.com/ads/library/?search_term=" + encodeURIComponent(bizName) }], maxAds: 5 } },
          { key: "google_ads", actor: "apify~google-search-scraper", payload: { queries: bizName + " ads", maxPagesPerQuery: 1 } },
          { key: "indeed", actor: "misceres~indeed-scraper", payload: { position: "", company: bizName, country: "AU", maxItems: 5 } },
          { key: "google_maps", actor: "compass~google-maps-reviews-scraper", payload: { searchStringsArray: [mapsSearch], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 5 } },
          { key: "linkedin", actor: "curious_coder~linkedin-company-scraper", payload: { urls: ["https://www.linkedin.com/company/" + linkedinSlug], proxy: { useApifyProxy: true } } }
        ];

        const startResults = await Promise.all(
          actors.map(a =>
            fetch("https://api.apify.com/v2/acts/" + a.actor + "/runs?token=" + apifyTk, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(a.payload)
            }).then(r => r.json()).then(j => {
              const dObj = (j && j.data) || Object.values(j || {}).find(v => v && typeof v === "object" && v.id) || {};
              if (!dObj.id) console.log("[fire-apify] WARN: No runId for " + a.key + " response=" + JSON.stringify(j).slice(0, 300));
              return { key: a.key, runId: dObj.id || null, status: dObj.id ? "started" : "no_id" };
            }).catch(e => { console.log("[fire-apify] ERROR: " + a.key + " " + e.message); return { key: a.key, runId: null, status: "failed", error: e.message }; })
          )
        );

        const runs = {};
        startResults.forEach(r => { runs[r.key] = r; });

        // Write run IDs to KV so the workflow can reuse them
        await env22.WORKFLOWS_KV.put(`lead:${lid}:apify_runs`, JSON.stringify(runs), { expirationTtl: 3600 });

        console.log("[fire-apify] lid=" + lid + " biz=" + bizName + " slug=" + linkedinSlug + " runs=" + Object.keys(runs).map(k => k + ":" + (runs[k].runId ? "ok" : "fail")).join(","));

        return Response.json({ success: true, lid, bizName, runs }, { headers: _cors });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: _cors });
      }
    }
    if (req.method === "POST" && path.startsWith("/event/")) {
      const instanceId = path.split("/event/")[1];
      if (!instanceId) return Response.json({ error: "Missing instanceId" }, { status: 400 });
      try {
        const body = await req.json();
        const instance2 = await env22.BELLAV9ORCHESTRATOR_WORKFLOW.get(instanceId);
        await instance2.sendEvent(body);
        return Response.json({ ok: true, instanceId, event: body });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }
    const params = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const newId = crypto.randomUUID();
    let instance = await env22.BELLAV9ORCHESTRATOR_WORKFLOW.create({
      id: newId,
      params
    });
    return Response.json({
      id: instance.id,
      details: await instance.status()
    }, { headers: _cors });
  }
};
export {
  BellaV9Orchestrator,
  index_default as default
};
//# sourceMappingURL=index.js.map
