var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/unenv/dist/runtime/_internal/utils.mjs
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
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
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

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
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

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
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

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
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
  clearLine(dir3, callback) {
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
  hasColors(count3, env2) {
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

// node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
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

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
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
  assert: assert2,
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
  assert: assert2,
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

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/index.ts
var GHL_LOCATION_ID = "g7AY3bmahEzCyvglO9IG";
var TOOLS = [
  { name: "get_lead_data", description: "Get all lead intelligence data for a prospect by their lead ID (lid). Call this at the start of every conversation to load personalised data.", inputSchema: { type: "object", properties: { lid: { type: "string", description: "The lead ID from the contact record" } }, required: ["lid"] } },
  { name: "kv_read", description: "Read a value from KV by full key.", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "kv_write", description: "Write a lead to KV. Value must be a JSON string.", inputSchema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, ttl: { type: "number" } }, required: ["key", "value"] } },
  { name: "kv_search_prefix", description: "List KV keys by prefix and return values. Use prefix like 'lead:' to find leads.", inputSchema: { type: "object", properties: { prefix: { type: "string" }, limit: { type: "number" } }, required: ["prefix"] } },
  { name: "write_live_data", description: "Write post-call outcome data to KV. Call at the END of every call.", inputSchema: { type: "object", properties: { lid: { type: "string" }, qualified: { type: "boolean" }, pain_confirmed: { type: "string" }, ltv_estimate: { type: "string" }, next_step: { type: "string" }, booked: { type: "boolean" }, notes: { type: "string" } }, required: ["lid", "qualified", "next_step", "booked"] } },
  { name: "scrape_website", description: "Scrape a business website URL and return structured intelligence JSON.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } }
];
function j(d, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
__name(j, "j");
function ok(id, r) {
  return j({ jsonrpc: "2.0", id, result: r });
}
__name(ok, "ok");
function er(id, c, m) {
  return j({ jsonrpc: "2.0", id, error: { code: c, message: m } });
}
__name(er, "er");
async function getLeadData(lid, env2) {
  const [rawJson, rawJsonBare, intelJson, bellaJson, nameJson] = await Promise.all([
    env2.LEADS_KV.get("lead:" + lid),
    env2.LEADS_KV.get(lid),
    env2.LEADS_KV.get("lead:" + lid + ":intel"),
    env2.LEADS_KV.get("lead:" + lid + ":bella:plan"),
    env2.LEADS_KV.get("lead:" + lid + ":name")
  ]);
  const resolvedRaw = rawJson ?? rawJsonBare;
  if (!resolvedRaw && !intelJson) return null;
  let raw = {};
  let rawBare = {};
  let intel = {};
  let bellaPlan = {};
  let nameData = {};
  try {
    if (resolvedRaw) raw = JSON.parse(resolvedRaw);
  } catch {
  }
  try {
    if (rawJsonBare) rawBare = JSON.parse(rawJsonBare);
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
  const merged = {
    ...raw,
    // :name key (loading page) wins. Then bare lid key (log-lead writes firstName).
    // Then prefixed lead: key. The bare key always has the human-entered name.
    first_name: nameData.first_name || rawBare.firstName || rawBare.first_name || raw.firstName || raw.first_name || "",
    ...intel.core_identity ? {
      business_name: intel.core_identity.business_name,
      tagline: intel.core_identity.tagline,
      industry: intel.core_identity.industry_niche,
      business_model: intel.core_identity.model
    } : {},
    ...intel.icp ? {
      target_audience: intel.icp.target_audience,
      pain_points: intel.icp.pain_points
    } : {},
    ...intel.services ? { services: intel.services } : {},
    ...intel.normalized_terms ? { normalized_terms: intel.normalized_terms } : {},
    ...intel.routing ? { routing: intel.routing } : {},
    ...intel.close_strategies ? { close_strategies: intel.close_strategies } : {},
    ...intel.validation_grade ? { validation_grade: intel.validation_grade } : {},
    // SC v3 fields — pass through directly
    ...intel.agent_ranking ? { agent_ranking: intel.agent_ranking } : {},
    ...intel.bella_opener ? { bella_opener: intel.bella_opener } : {},
    ...intel.top_fix ? { top_fix: intel.top_fix } : {},
    ...intel.industry_benchmark ? { industry_benchmark: intel.industry_benchmark } : {},
    ...intel.pre_filled ? { pre_filled: intel.pre_filled } : {},
    ...intel.missing ? { missing: intel.missing } : {},
    ...intel.flags ? { flags: intel.flags } : {},
    ...intel.roi_narrative ? { roi_narrative: intel.roi_narrative } : {},
    ...intel.pitch_hook ? { pitch_hook: intel.pitch_hook } : {},
    bella_plan: bellaPlan,
    _intel: intel,
    _pipeline_status: intelJson ? "complete" : "raw_only"
  };
  return merged;
}
__name(getLeadData, "getLeadData");
function flattenForBella(lid, data) {
  const bellaPlan = data.bella_plan ?? {};
  const intel = data._intel ?? {};
  const icp = intel.icp ?? {};
  const coreIdentity = intel.core_identity ?? {};
  const websiteHealth = intel.website_health ?? {};
  const routing = intel.routing ?? data.routing ?? {};
  const agentSnippets = intel.agent_snippets ?? {};
  const closeStrategies = intel.close_strategies ?? {};
  const normalizedTerms = intel.normalized_terms ?? {};
  const prioritizedFixes = data.prioritized_fixes ?? {};
  const criticalFixes = data.critical_fixes ?? {};
  const grades = data.grades ?? (criticalFixes.grades ?? {});
  const agentRanking = data.agent_ranking ?? intel.agent_ranking ?? routing.top_agents ?? [];
  const scTopFix = data.top_fix ?? intel.top_fix ?? {};
  const flags = data.flags ?? intel.flags ?? {};
  const industryBenchmark = data.industry_benchmark ?? intel.industry_benchmark ?? {};
  const topFixes = prioritizedFixes.topFixes ?? [];
  const totalMonthlyOpportunity = prioritizedFixes.totalMonthlyOpportunity ?? scTopFix.total_monthly_opportunity ?? 0;
  const isRunningAds = flags.is_running_ads ?? criticalFixes.isRunningAds ?? false;
  const adFunnelVerdict = flags.ad_funnel_verdict ?? criticalFixes.adFunnelVerdict ?? "";
  const adMonthlyLoss = flags.ad_monthly_loss ?? criticalFixes.adFunnelScore?.totalMonthlyLoss ?? 0;
  const marketingIntel = data.marketing_intelligence ?? {};
  const reputationIntel = marketingIntel.reputationIntelligence ?? {};
  const adIntelMI = marketingIntel.adIntelligence ?? {};
  const consultIntel = data.consultative_intelligence ?? {};
  const googleRating = data.star_rating ?? websiteHealth.google_rating ?? flags.google_rating ?? reputationIntel.googleRating ?? data.googleRating ?? null;
  const reviewCount = data.review_count ?? websiteHealth.review_count ?? flags.review_count ?? reputationIntel.reviewCount ?? data.googleReviewCount ?? null;
  const firstName = data.first_name || data.firstName || "";
  return {
    success: true,
    lid,
    // Identity — with URL fallback for business_name
    first_name: firstName,
    business_name: (() => {
      let biz = data.business_name ?? coreIdentity.business_name ?? "";
      if (!biz || biz === "your business" || biz === "Unknown Business") {
        const rawUrl = data.url ?? data.websiteUrl ?? "";
        if (rawUrl) {
          try {
            const hostname = new URL(rawUrl.startsWith("http") ? rawUrl : "https://" + rawUrl).hostname.replace(/^www\./, "");
            biz = hostname.split(".")[0].charAt(0).toUpperCase() + hostname.split(".")[0].slice(1);
          } catch {
          }
        }
      }
      return biz;
    })(),
    tagline: data.tagline ?? coreIdentity.tagline ?? "",
    industry: data.industry ?? coreIdentity.industry_niche ?? "",
    business_model: data.business_model ?? coreIdentity.model ?? "",
    location: data.location ?? "",
    years_in_business: data.years_in_business ?? "",
    // ICP & pain
    target_audience: data.target_audience ?? icp.target_audience ?? "",
    pain_points: data.pain_points ?? icp.pain_points ?? [],
    services: data.services ?? "",
    // Validation
    validation_grade: data.validation_grade ?? intel.validation_grade ?? "",
    pipeline_status: data._pipeline_status ?? "unknown",
    // Reputation
    star_rating: googleRating,
    review_count: reviewCount,
    // Ads
    is_running_ads: isRunningAds,
    ad_funnel_verdict: adFunnelVerdict,
    ad_monthly_loss: adMonthlyLoss,
    // Revenue opportunity — THE WOW DATA
    total_monthly_opportunity: totalMonthlyOpportunity,
    top_fixes: topFixes.map((f) => ({
      id: f.id,
      title: f.title,
      agent: f.agent,
      monthly_revenue: f.monthlyRevenue,
      copy_headline: f.copyHeadline
    })),
    // Grades
    overall_grade: grades.overall?.grade ?? "",
    // Routing — SC v3 agent_ranking wins over old routing.top_agents
    top_agents: agentRanking,
    routing_priority: routing.priority ?? "",
    // Agent context snippets
    agent_snippets: agentSnippets,
    // Close strategies
    close_strategies: closeStrategies,
    // Language normalization
    normalized_terms: normalizedTerms,
    // SC v3 passthrough — Bella uses these for tool calls
    agent_ranking: (() => {
      if (agentRanking.length > 0) return agentRanking;
      const derived = [];
      const seen = /* @__PURE__ */ new Set();
      for (const fix of topFixes) {
        const a = String(fix.agent ?? "").toLowerCase();
        if (a && !seen.has(a)) {
          derived.push(a);
          seen.add(a);
        }
      }
      const agentCopy = consultIntel.agentCopy ?? {};
      for (const a of ["alex", "chris", "maddie", "james", "sarah"]) {
        if (!seen.has(a) && agentCopy[a]) {
          derived.push(a);
          seen.add(a);
        }
      }
      return derived;
    })(),
    bella_opener: (() => {
      const opener = data.bella_opener ?? intel.bella_opener ?? "";
      if (opener) return opener;
      const agentCopy = consultIntel.agentCopy ?? {};
      const strongest = consultIntel.strongestAgent ?? "";
      return agentCopy[strongest.toLowerCase()] ?? agentCopy[Object.keys(agentCopy)[0] ?? ""] ?? "";
    })(),
    top_fix: scTopFix,
    industry_benchmark: industryBenchmark,
    pre_filled: data.pre_filled ?? intel.pre_filled ?? {},
    missing: data.missing ?? intel.missing ?? {},
    roi_narrative: data.roi_narrative ?? intel.roi_narrative ?? "",
    pitch_hook: data.pitch_hook ?? intel.pitch_hook ?? "",
    // Consultant plan — SC v3 bella_opener is the primary hook
    stage1_script: bellaPlan.stage1_script ?? "",
    intelligence_brief: data.bella_opener ?? intel.bella_opener ?? bellaPlan.intelligence_brief ?? "",
    routing_recommendation: bellaPlan.routing_recommendation ?? "",
    // Tech gaps
    missing_tech: data.missingTech ?? [],
    has_crm: criticalFixes.hasCRM ?? false,
    has_chat_widget: criticalFixes.hasChatWidget ?? false
  };
}
__name(flattenForBella, "flattenForBella");
async function run(name, args, env2) {
  try {
    if (name === "get_lead_data") {
      const lid = args.lid;
      if (!lid) return { content: [{ type: "text", text: "Error: lid is required" }], isError: true };
      const data = await getLeadData(lid, env2);
      if (!data) return { content: [{ type: "text", text: "No data found for lead ID: " + lid }] };
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    if (name === "kv_read") {
      const v = await env2.LEADS_KV.get(args.key);
      return { content: [{ type: "text", text: v ?? "Key not found" }] };
    }
    if (name === "kv_write") {
      const o = args.ttl ? { expirationTtl: Number(args.ttl) } : void 0;
      await env2.LEADS_KV.put(args.key, args.value, o);
      return { content: [{ type: "text", text: "OK: wrote " + args.key }] };
    }
    if (name === "kv_search_prefix") {
      if (args.prefix === "") return { content: [{ type: "text", text: "Error: prefix required" }], isError: true };
      const lim = Math.min(Number(args.limit ?? 20), 50);
      const list = await env2.LEADS_KV.list({ prefix: args.prefix, limit: lim });
      if (list.keys.length === 0) return { content: [{ type: "text", text: "No keys found" }] };
      const out = {};
      for (const k of list.keys) {
        const v = await env2.LEADS_KV.get(k.name);
        try {
          out[k.name] = JSON.parse(v);
        } catch {
          out[k.name] = v;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ keys: list.keys.map((k) => k.name), values: out }) }] };
    }
    if (name === "scrape_website") {
      const base = env2.SCRAPER_URL.replace(/\/$/, "");
      const res = await fetch(base + "/?url=" + encodeURIComponent(args.url), { headers: { accept: "application/json" } });
      const txt = await res.text();
      if (res.ok && txt.indexOf("No URL provided") === -1) return { content: [{ type: "text", text: txt }] };
      const p = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: args.url }) });
      return { content: [{ type: "text", text: await p.text() }] };
    }
    if (name === "write_live_data") {
      const lid = args.lid;
      if (!lid) return { content: [{ type: "text", text: "Error: lid required" }], isError: true };
      const ts = (/* @__PURE__ */ new Date()).toISOString();
      const outcome = { qualified: args.qualified === true, pain_confirmed: String(args.pain_confirmed || ""), ltv_estimate: String(args.ltv_estimate || ""), next_step: String(args.next_step || ""), booked: args.booked === true, notes: String(args.notes || ""), call_timestamp: ts };
      await env2.LEADS_KV.put("outcome:" + lid, JSON.stringify(outcome), { expirationTtl: 2592e3 });
      console.log(JSON.stringify({ event: "write_live_data", lid, qualified: outcome.qualified, booked: outcome.booked, ts }));
      return { content: [{ type: "text", text: "OK: outcome written for " + lid }] };
    }
    return { content: [{ type: "text", text: "Unknown tool: " + name }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: "Error: " + String(e) }], isError: true };
  }
}
__name(run, "run");
var index_default = {
  async fetch(req, env2) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" } });
    console.log(JSON.stringify({ event: "request", method: req.method, path, ts: (/* @__PURE__ */ new Date()).toISOString() }));
    if (path === "/health") return j({ status: "ok", version: "1.5.0", tools: TOOLS.map((t) => t.name) });
    if (path === "/ghl-contact-created") {
      if (req.method !== "POST") return j({ error: "POST required" }, 405);
      let body;
      try {
        body = await req.json();
      } catch {
        return j({ error: "Invalid JSON" }, 400);
      }
      const contactId = String(body.contact_id ?? body.id ?? body.contactId ?? "").trim();
      if (!contactId) {
        console.log(JSON.stringify({ event: "contact-created-no-id", body: JSON.stringify(body).slice(0, 200) }));
        return j({ error: "contact_id required" }, 400);
      }
      const pendingKey = "pending:" + GHL_LOCATION_ID;
      const lid = await env2.LEADS_KV.get(pendingKey);
      if (!lid) {
        console.log(JSON.stringify({ event: "contact-created-no-pending", contactId }));
        return j({ success: false, reason: "no_pending_lid", contactId });
      }
      await env2.LEADS_KV.put("cid:" + contactId, lid, { expirationTtl: 3600 });
      console.log(JSON.stringify({ event: "cid-mapped", contactId, lid, ts: (/* @__PURE__ */ new Date()).toISOString() }));
      return j({ success: true, contactId, lid });
    }
    if (path === "/resolve-intel") {
      if (req.method !== "POST") return j({ error: "POST required" }, 405);
      let body;
      try {
        body = await req.json();
      } catch {
        return j({ error: "Invalid JSON" }, 400);
      }
      const locationId = String(body.location_id ?? GHL_LOCATION_ID).trim();
      let lid = String(body.lid ?? "").trim();
      if (!lid) {
        const pendingKey = "pending:" + locationId;
        const pendingLid = await env2.LEADS_KV.get(pendingKey);
        if (!pendingLid) {
          console.log(JSON.stringify({ event: "resolve-intel-miss", locationId, ts: (/* @__PURE__ */ new Date()).toISOString() }));
          return j({ success: false, reason: "no_pending_intel", hint: "Pass lid directly or ensure loading page ran within 5min" });
        }
        lid = pendingLid;
      }
      const data = await getLeadData(lid, env2);
      if (!data) {
        console.log(JSON.stringify({ event: "resolve-intel-no-data", locationId, lid, ts: (/* @__PURE__ */ new Date()).toISOString() }));
        return j({ success: false, reason: "no_intel_for_lid", lid });
      }
      const out = flattenForBella(lid, data);
      if (data._pipeline_status !== "complete" && !out.star_rating && !out.agent_ranking?.length && !data.marketing_intelligence && !data.critical_fixes) {
        return j({ success: false, reason: "pipeline_not_complete", pipeline_status: data._pipeline_status ?? "raw_only", lid, first_name: out.first_name ?? "", business_name: out.business_name ?? "" });
      }
      const topAgents = (out.agent_ranking ?? out.top_agents ?? []).slice(0, 5);
      const roiTopFixes = [];
      let totalRoiMonthly = 0;
      for (const agent of topAgents) {
        let roi = null;
        const confirmedStr = await env2.LEADS_KV.get(`lead:${lid}:${agent}:roi_confirmed`);
        if (confirmedStr) {
          try {
            roi = JSON.parse(confirmedStr);
          } catch {
          }
        }
        if (!roi) {
          const estimateStr = await env2.LEADS_KV.get(`lead:${lid}:${agent}:roi_estimate`);
          if (estimateStr) {
            try {
              roi = JSON.parse(estimateStr);
            } catch {
            }
          }
        }
        if (roi) {
          const mo = Number(roi.monthly_opportunity ?? 0);
          totalRoiMonthly += mo;
          roiTopFixes.push({
            id: agent,
            title: String(roi.narrative ?? `${agent} opportunity`).slice(0, 120),
            agent,
            monthly_revenue: mo,
            copy_headline: String(roi.narrative ?? "").slice(0, 120),
            confidence: roi.confidence ?? "estimate"
          });
        }
      }
      if (roiTopFixes.length > 0) {
        out.top_fixes = roiTopFixes;
        out.total_monthly_opportunity = totalRoiMonthly;
      }
      console.log(JSON.stringify({ event: "resolve-intel-hit", locationId, lid, business: out.business_name, topAgents, totalRoiMonthly, ts: (/* @__PURE__ */ new Date()).toISOString() }));
      return j(out);
    }
    if (path === "/lead") {
      const lid = url.searchParams.get("lid");
      if (!lid) return j({ error: "lid required" }, 400);
      const data = await getLeadData(lid, env2);
      if (!data) return j({ error: "not found", lid }, 404);
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (path === "/mcp" || path.startsWith("/mcp/")) {
      const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (tok !== env2.BEARER_TOKEN) return j({ error: "Unauthorized" }, 401);
      if (req.method !== "POST") return j({ error: "POST required" }, 405);
      let body;
      try {
        body = await req.json();
      } catch {
        return er(null, -32700, "Parse error");
      }
      const { id, method, params = {} } = body;
      if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "Leads MCP", version: "1.4.0" } });
      if (method === "notifications/initialized") return new Response(null, { status: 204 });
      if (method === "tools/list") return ok(id, { tools: TOOLS });
      if (method === "tools/call") return ok(id, await run(params.name, params.arguments ?? {}, env2));
      return er(id, -32601, "Unknown method: " + method);
    }
    return j({ error: "Not found" }, 404);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

