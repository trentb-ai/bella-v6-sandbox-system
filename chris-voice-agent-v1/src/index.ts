/**
 * chris-voice-agent-v1
 * Architecture: Browser WebSocket → Durable Object → Deepgram Voice Agent WS
 * v1.0.0: Chris — website concierge for Pillar & Post AI. Simple 3-stage flow.
 */

import { Agent, routeAgentRequest } from "agents";

const VERSION = "1.0.0-chris-v1";
const log = (tag: string, msg: string, t0?: number) => {
  const elapsed = t0 !== undefined ? ` [+${Date.now() - t0}ms]` : "";
  console.log(`[ChrisV1 ${VERSION}] [${tag}]${elapsed} ${msg}`);
};

// ── Deepgram config ──────────────────────────────────────────────────────────
const DG_VOICE = "aura-2-orpheus-en"; // Male voice for Chris
const DG_STT_MODEL = "flux-general-en";  // SUPERGOD: Flux for adaptive turn detection
const DG_LLM_MODEL = "gemini-2.5-flash";
const DG_LLM_PROVIDER = "open_ai";
const DG_WS_URL = "wss://agent.deepgram.com/v1/agent/converse";
const KEEPALIVE_MS = 5000; // Deepgram drops idle connections without this

// ── Agent label map ───────────────────────────────────────────────────────────
const AGENT_LABELS: Record<string, string> = {
  alex: "Speed-to-Lead SMS",
  chris: "Website Concierge",
  maddie: "AI Receptionist",
  sarah: "Database Reactivation",
  james: "Reputation Manager",
};

const DEFAULT_PERSONA = `You are Chris, website concierge AI for Pillar and Post AI. Warm, confident, helpful. Live voice call.

RULES:
- RESPOND to what the visitor ACTUALLY SAID. Acknowledge their answer before anything else.
- ONE or TWO sentences per turn. Then STOP and WAIT.
- Intel below is BACKGROUND KNOWLEDGE — never read it aloud or present it as a list.
- Your job: answer questions about the site, identify what the visitor needs, drive toward the primary CTA.
- No markdown, no bullets, no lists. Natural conversation only.`;

interface Env {
  ChrisAgent: DurableObjectNamespace;
  LEADS_KV: KVNamespace;
  TOOLS: Fetcher;              // service binding to bella-tools-worker-v8
  DEEPGRAM_API_KEY: string;
  BRIDGE_URL: string;          // Deepgram bridge endpoint for LLM calls
  TOOLS_WORKER_URL: string;    // Legacy — prefer TOOLS service binding
  GHL_LOCATION_ID: string;
}

// v1.0.0: state — intel loaded flag, history, opening gate, handoff context
interface ChrisState {
  openingFired: boolean;
  history: { role: string; content: string }[];
  intelLoaded: boolean;
}

// ── Tool definitions ─────────────────────────────────────────────────────────
// No endpoint field = client-side execution (CF Worker handles it, sends FunctionCallResponse back)
const TOOLS = [
  {
    name: "resolve_intel_hot",
    description: "Load full prospect intelligence for the current lead. Call this at the start of the conversation to enrich the context. If the response contains pipeline_status: 'raw_only' or data_available: false, proceed conversationally using only what is in the system prompt — do NOT promise detailed analysis or say you're retrieving more data.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string", description: "The lead ID for this prospect" }
      },
      required: ["lid"]
    }
  },
  {
    name: "kv_get_fact",
    description: "Read a specific fact from the lead database by key.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The KV key to read, e.g. 'lead:xxx:intel'" }
      },
      required: ["key"]
    }
  },
  {
    name: "save_lead_patch",
    description: "Save updated information about the lead mid-conversation, e.g. LTV estimate, confirmed pain points.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string" },
        patch: { type: "object", description: "Key-value pairs to merge into the lead record" }
      },
      required: ["lid", "patch"]
    }
  },
  {
    name: "log_event",
    description: "Log a conversation event, e.g. objection raised, interest shown, booking attempted.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string" },
        event: { type: "string", description: "Event name, e.g. 'price_objection', 'booking_attempted'" },
        data: { type: "object" }
      },
      required: ["lid", "event"]
    }
  },
  {
    name: "handoff_action",
    description: "Trigger a handoff to another agent or human. Call when the prospect is ready to go deeper.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string" },
        action: { type: "string", description: "Handoff type, e.g. 'book_demo', 'send_proposal', 'escalate_human'" },
        agent: { type: "string", description: "Target agent name if applicable" },
        notes: { type: "string" }
      },
      required: ["lid", "action"]
    }
  },
  {
    name: "write_outcome",
    description: "Write the final call outcome. Always call this before hanging up.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string" },
        qualified: { type: "boolean" },
        pain_confirmed: { type: "string" },
        ltv_estimate: { type: "string" },
        next_step: { type: "string" },
        booked: { type: "boolean" },
        notes: { type: "string" }
      },
      required: ["lid", "qualified", "next_step", "booked"]
    }
  },
  {
    name: "capture_acv",
    description: "Capture the prospect's average customer value (ACV / LTV). Call this AS SOON as the prospect shares how much a customer is worth to them (e.g. 'about 5000 dollars', 'around 2k per job'). Records their confirmed number so it can be used to personalise the rest of the conversation.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string", description: "The lead ID" },
        acv: { type: "number", description: "The average customer value in dollars (e.g. 5000, 2000). Extract the number from what the prospect said." },
        business_name: { type: "string", description: "The business name from the system prompt intel (e.g. 'Bright Smile Dental Coogee')" }
      },
      required: ["lid", "acv", "business_name"]
    }
  },
  {
    name: "get_roi_confirmed",
    description: "Retrieve confirmed ROI figures for this lead after the prospect has shared their average customer value. Returns voice-ready dollar figures personalised to their business.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string", description: "The lead ID" }
      },
      required: ["lid"]
    }
  },
  {
    name: "save_conversation_data",
    description: "Save ANY data the prospect shares during the call. Call this IMMEDIATELY every time the prospect provides a fact: LTV/ACV, leads per week, conversion rate, response time, team size, current spend, pain points, etc. Data persists in KV and can be reloaded. Pass data as a key-value object.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string", description: "The lead ID" },
        data: { type: "object", description: "Key-value pairs to save, e.g. {leads_per_week: 15, response_time_minutes: 30, biggest_frustration: 'missed calls'}" }
      },
      required: ["lid", "data"]
    }
  },
  {
    name: "get_conversation_memory",
    description: "Load ALL data the prospect has shared during this call. Call this BEFORE making any calculations or delivering ROI figures to ensure you have the latest data. Returns all saved fields plus ACV if captured.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string", description: "The lead ID" }
      },
      required: ["lid"]
    }
  },
  {
    name: "run_deep_analysis",
    description: "Trigger a Tier 2 deep analysis via the Consultant when the prospect asks something you need fresher or deeper data for (e.g. a specific website issue, ad performance question, or deeper ROI breakdown). Speak the returned stall_phrase immediately, then use the analysis in your next turn. Do NOT call this if cached intel already answers the question.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string", description: "The lead ID" },
        question: { type: "string", description: "What the prospect just asked or the topic you need deeper analysis on" },
        focus: { type: "string", description: "Analysis focus area: 'website', 'ads', 'reputation', 'roi', or 'general'" }
      },
      required: ["lid", "question"]
    }
  },
  // REMOVED: fetch_script_stage — stages now embedded in call_brief
];

// ── Stage type for Chris ──────────────────────────────────────────────────────
type Stage = "greeting" | "discovery" | "cta_push" | "handoff" | string;

export class ChrisAgent extends Agent<Env, ChrisState> {
  private dgSocket: WebSocket | null = null;
  private browserConn: any = null;
  private lid: string = "";
  private systemPrompt: string = "";
  private keepAliveTimer: any = null;
  private urlHints: { biz: string; ind: string; serv: string; loc: string; fn: string } = { biz: "", ind: "", serv: "", loc: "", fn: "" };
  private _pendingUrlHints: { biz: string; ind: string; serv: string; loc: string; fn: string } | null = null;
  private _pendingHandoff: boolean = false;
  private handoffContext: Record<string, any> | null = null;
  private prospectFirstName: string = "";
  private prospectBusiness: string = "";
  private currentStage: Stage = "greeting";
  private dgReconnectAttempts: number = 0;
  private static readonly MAX_DG_RECONNECTS = 2;

  shouldSendProtocolMessages(): boolean { return false; }

  // Intercept the incoming HTTP request BEFORE the Agents SDK upgrades to WebSocket.
  // connection.request.url is unreliable in onConnect — the SDK strips query params
  // during the WebSocket upgrade. Capture them here where the full URL is guaranteed.
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      this._pendingUrlHints = {
        biz:  url.searchParams.get('biz') ?? "",
        ind:  url.searchParams.get('ind') ?? "",
        serv: url.searchParams.get('serv') ?? "",
        loc:  url.searchParams.get('loc') ?? "",
        fn:   url.searchParams.get('fn') ?? "",
      };
      // ?handoff=true: Chris was handed off from Bella — load handoff context
      this._pendingHandoff = url.searchParams.get('handoff') === 'true';
    } catch {
      this._pendingUrlHints = null;
      this._pendingHandoff = false;
    }
    return super.fetch(request);
  }

  async onStart() {
    if (!this.state?.history) {
      this.setState({ openingFired: false, history: [], intelLoaded: false } as ChrisState);
    }
  }

  async onConnect(connection: any) {
    const t0 = Date.now();

    // Clean up any stale Deepgram WebSocket from previous connection
    this.stopKeepAlive();
    if (this.dgSocket) {
      try { this.dgSocket.close(); } catch { }
      this.dgSocket = null;
      log("CONNECT", "cleaned up stale DG socket");
    }

    this.browserConn = connection;
    this.lid = this.name; // DO name = lid from URL /agents/bella-agent/{lid}
    log("CONNECT", `lid="${this.lid}"`, t0);

    // Read scraped data hints from URL params — set by loading page redirect.
    // _pendingUrlHints is captured in fetch() before WebSocket upgrade (reliable).
    // connection.request.url is a fallback (unreliable — SDK strips params).
    if (this._pendingUrlHints && (this._pendingUrlHints.biz || this._pendingUrlHints.fn)) {
      this.urlHints = this._pendingUrlHints;
    } else {
      const reqUrl = (connection.request?.url) ? new URL(connection.request.url) : null;
      this.urlHints = {
        biz:  reqUrl?.searchParams.get('biz') ?? "",
        ind:  reqUrl?.searchParams.get('ind') ?? "",
        serv: reqUrl?.searchParams.get('serv') ?? "",
        loc:  reqUrl?.searchParams.get('loc') ?? "",
        fn:   reqUrl?.searchParams.get('fn') ?? "",
      };
    }
    this._pendingUrlHints = null; // consumed — clear for next connection

    if (this.urlHints.biz || this.urlHints.fn)
      log("CONNECT", `url hints: biz="${this.urlHints.biz}" fn="${this.urlHints.fn}"`, t0);
    else
      log("CONNECT", `NO url hints — biz="${this.urlHints.biz}" fn="${this.urlHints.fn}"`, t0);

    // Always reset state on new connection — ensures greeting fires and state is clean
    this.setState({ openingFired: false, history: [], intelLoaded: false } as ChrisState);

    // Load handoff context if ?handoff=true was passed
    this.handoffContext = null;
    if (this._pendingHandoff) {
      try {
        const handoffRaw = await this.env.LEADS_KV.get(`lead:${this.lid}:handoff:chris`);
        if (handoffRaw) {
          this.handoffContext = JSON.parse(handoffRaw);
          log("CONNECT", `handoff context loaded: ${JSON.stringify(this.handoffContext).slice(0, 120)}`, t0);
        } else {
          log("CONNECT", `handoff=true but no KV key found for lead:${this.lid}:handoff:chris`, t0);
        }
      } catch (e) {
        log("CONNECT", `handoff context load failed: ${e}`, t0);
      }
    }

    // Write pending lookup so mcp-worker can resolve GHL webhooks
    // Schema-aligned: pending:{locationId} → lid
    const pendingKey = `pending:${this.env.GHL_LOCATION_ID}`;
    await this.env.LEADS_KV.put(pendingKey, this.lid, { expirationTtl: 3600 });
    log("CONNECT", `wrote ${pendingKey} → ${this.lid}`, t0);

    await this.loadIntelAndConnect(connection, t0);
  }

  async onMessage(connection: any, message: ArrayBuffer | string) {
    if (!this.dgSocket || this.dgSocket.readyState !== WebSocket.OPEN) return;

    // Binary = PCM audio from browser → forward straight to Deepgram
    if (message instanceof ArrayBuffer) {
      this.dgSocket.send(message);
      return;
    }

    // JSON control messages from browser
    let msg: { type: string };
    try { msg = JSON.parse(message as string); } catch { return; }

    if (msg.type === "barge_in") {
      // Send empty audio frame to interrupt Deepgram's VAD/TTS
      this.dgSocket.send(new ArrayBuffer(0));
      this.sendJSON(connection, { type: "listening" });
      return;
    }

    if (msg.type === "end") {
      log("CLOSE", "browser requested end");
      this.stopKeepAlive();
      if (this.dgSocket) { try { this.dgSocket.close(); } catch { } this.dgSocket = null; }
      connection.close();
      return;
    }

    // Whitelist: only forward message types Deepgram Agent API accepts
    const DG_VALID_TYPES = new Set([
      "Settings", "UpdateSpeak", "UpdatePrompt",
      "InjectAgentMessage", "FunctionCallResponse", "KeepAlive",
    ]);

    if (DG_VALID_TYPES.has(msg.type)) {
      this.dgSocket.send(message);
      return;
    }

    // Everything else is browser-only — drop silently (don't crash Deepgram)
    log("DROP", `non-DG message type="${msg.type}" — not forwarded`);
  }

  async onClose() {
    log("CLOSE", "browser disconnected");
    this.stopKeepAlive();
    if (this.dgSocket) {
      try { this.dgSocket.close(); } catch { }
      this.dgSocket = null;
    }
    this.browserConn = null;
  }

  // ── Intel fetch + system prompt build (Chris v1: single KV source) ──────────
  // Chris reads only lead:{lid}:fast-intel from KV — no MCP layer.
  // Keys used: consultant.positioning.summary, consultant.icpAnalysis,
  //            consultant.conversionEventAnalysis.primaryCTA, consultant.scriptFills, deep_flags
  private async loadIntelAndConnect(connection: any, t0: number, retries = 0) {
    log("INTEL", `fetching for lid="${this.lid}"`, t0);

    // ── Read fast-intel from KV ─────────────────────────────────────────────
    let fastIntel: Record<string, any> | null = null;
    try {
      const raw = await this.env.LEADS_KV.get(`lead:${this.lid}:fast-intel`);
      log("INTEL", `fast-intel raw=${!!raw} bytes=${raw?.length ?? 0}`, t0);
      if (raw) fastIntel = JSON.parse(raw);
    } catch (e) {
      log("INTEL", `fast-intel parse error: ${e}`, t0);
    }

    const fi = fastIntel ?? {};
    const cons = fi.consultant ?? {};
    const sf = cons.scriptFills ?? {};
    const cea = cons.conversionEventAnalysis ?? {};
    const pos = cons.positioning ?? {};

    const businessName = fi.business_name || fi.businessName || this.urlHints.biz || "your business";
    const firstName = fi.firstName || fi.first_name || this.urlHints.fn || "";
    const primaryCTA = cea.primaryCTA || "book a consultation";
    const positioningSummary = pos.summary || "";
    const icpAnalysis = cons.icpAnalysis || "";
    const deepFlags = fi.deep_flags || "";

    log("INTEL", `final: biz="${businessName}" fn="${firstName}" primaryCTA="${primaryCTA}"`, t0);

    // ── Build Chris system prompt ────────────────────────────────────────────
    const intelSection = [
      `lead_id: ${this.lid}`,
      `BUSINESS: ${businessName}`,
      firstName ? `FIRST NAME: ${firstName}` : "",
      fi.websiteUrl ? `WEBSITE: ${fi.websiteUrl}` : "",
      positioningSummary ? `POSITIONING: ${positioningSummary}` : "",
      icpAnalysis ? `ICP: ${icpAnalysis}` : "",
      `PRIMARY CTA: ${primaryCTA}`,
      sf.website_positive_comment ? `WEBSITE HIGHLIGHT: ${sf.website_positive_comment}` : "",
      sf.icp_guess ? `ICP GUESS: ${sf.icp_guess}` : "",
      deepFlags ? `DEEP FLAGS: ${deepFlags}` : "",
    ].filter(Boolean).join("\n");

    this.systemPrompt = `${DEFAULT_PERSONA}

==============================
SITE INTEL — ${businessName}
==============================
${intelSection}

==============================
CHRIS CONVERSATION RULES:
- You are Chris, the ${businessName} AI concierge. Warm, confident, helpful.
- Stage 1 (Greeting): You open with your greeting, then WAIT for the visitor to speak.
- Stage 2 (Discovery): Open-ended, reactive. Use the site intel as background knowledge.
- Stage 3 (CTA Push): Drive toward: "${primaryCTA}".
- Stage 4 (Handoff): "I can get that sorted for you right now — ${primaryCTA}."
- Never read the intel as a list. Weave it in naturally.
- ONE or TWO sentences per turn. Then STOP and WAIT.
- Your lead ID for tool calls is: ${this.lid}
==============================`;

    this.setState({ ...this.state, intelLoaded: !!fastIntel } as ChrisState);
    log("INTEL", `system prompt built (${this.systemPrompt.length} chars)`, t0);

    this.prospectFirstName = firstName;
    this.prospectBusiness = businessName;

    // ── Opening greeting (Chris v1) ──────────────────────────────────────────
    let openingText: string;
    if (this.handoffContext) {
      // Handoff path — Bella passed context
      const hFirstName = this.handoffContext.firstName || this.handoffContext.first_name || firstName;
      const hCTA = this.handoffContext.confirmedCTA || primaryCTA;
      openingText = hFirstName
        ? `Hi ${hFirstName}, I'm Chris — Bella just brought me up to speed. ${hCTA} — let's make that happen.`
        : `Hi there, I'm Chris — Bella just brought me up to speed. ${hCTA} — let's make that happen.`;
      log("INTEL", `handoff greeting for firstName="${hFirstName}" confirmedCTA="${hCTA}"`, t0);
    } else {
      // Standard greeting
      openingText = `Hi! I'm Chris, the ${businessName} AI concierge. I've already been through the site — what can I help you with today?`;
      log("INTEL", `standard greeting for biz="${businessName}"`, t0);
    }

    // Tell browser intel is ready (triggers UI label update)
    this.sendJSON(connection, { type: "greeting_ready", first_name: firstName, business: businessName });

    await this.openDGConnection(connection, openingText, t0);
  }

    // buildSystemPromptV3 not used by Chris — removed
    return _basePrompt;
  }

  // ── Open Deepgram Voice Agent WebSocket ────────────────────────────────────
  private async openDGConnection(connection: any, openingText: string, t0: number) {
    log("DG", "opening WebSocket", t0);

    // Auth: Sec-WebSocket-Protocol header with token subprotocol
    const dgWs = new WebSocket(DG_WS_URL, ["token", this.env.DEEPGRAM_API_KEY]);
    this.dgSocket = dgWs;

    dgWs.addEventListener("open", () => {
      log("DG", "connected — sending Settings", t0);
      this.dgReconnectAttempts = 0; // Reset on successful connect

      const settings: Record<string, any> = {
        type: "Settings",
        audio: {
          input: {
            encoding: "linear16",
            sample_rate: 16000,
          },
          output: {
            encoding: "linear16",
            sample_rate: 24000,
          }
        },
        agent: {
          listen: {
            provider: {
              type: "deepgram",
              model: DG_STT_MODEL,  // flux-general-en
              // NO version field - Flux doesn't use it
              // NO smart_format - not compatible with Flux
              eot_threshold: 0.85,         // High-reliability: fewer false turn finals, fewer SSE cancellations
              eot_timeout_ms: 2500,        // Longer silence tolerance: natural phone pauses don't trigger false EOT
            },
          },
          think: {
            provider: {
              type: DG_LLM_PROVIDER,
              model: DG_LLM_MODEL,
            },
            endpoint: {
              url: this.env.BRIDGE_URL,
            },
            // Bridge replaces this system prompt on every turn with a lean
            // stage-specific prompt (~150 tokens). This is just a fallback
            // identity in case the bridge is unreachable.
            prompt: `You are Chris, website concierge AI for ${this.prospectBusiness || "this business"}. Warm, confident, helpful. Your lead ID is: ${this.lid}. prospect_first_name: ${this.prospectFirstName || "unknown"}. prospect_business: ${this.prospectBusiness || "unknown"}.`,
            functions: TOOLS,
          },
          speak: {
            provider: {
              type: "deepgram",
              model: DG_VOICE,
            }
          },
        }
      };

      // Only send greeting on first connect — not on reconnects
      if (!this.state?.openingFired) {
        settings.agent.greeting = openingText;
        this.setState({ ...this.state, openingFired: true } as ChrisState);
      }

      dgWs.send(JSON.stringify(settings));

      // Notify browser the pipeline is being configured
      this.sendJSON(connection, { type: "ready" });
      log("DG", "Settings sent", t0);

      this.startKeepAlive(dgWs);
    });

    dgWs.addEventListener("message", async (event: MessageEvent) => {
      const data = event.data;

      // Binary = TTS audio from Deepgram → forward to browser as-is
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        connection.send(data);
        return;
      }

      // JSON events from Deepgram
      let msg: Record<string, any>;
      try { msg = JSON.parse(data as string); } catch { return; }

      const msgType = msg.type as string;
      log("DG-MSG", msgType);

      switch (msgType) {
        case "Welcome":
          log("DG", "Welcome received", t0);
          break;

        case "SettingsApplied":
          log("DG", "pipeline configured ✓", t0);
          break;

        case "UserStartedSpeaking":
          this.sendJSON(connection, { type: "user_started_speaking" });
          break;

        case "AgentThinking":
          log("DG", "AgentThinking");
          break;

        case "AgentStartedSpeaking":
          this.sendJSON(connection, { type: "speaking" });
          break;

        case "AgentAudioDone":
          this.sendJSON(connection, { type: "listening" });
          // SUPERGOD: Check if bridge advanced stage → update Flux STT config
          this.checkAndUpdateFluxStage();
          break;

        case "ConversationText":
          if (msg.role === "user" && msg.content) {
            this.sendJSON(connection, { type: "transcript", text: msg.content });
          }
          break;

        case "FunctionCallRequest":
          await this.handleToolCall(msg, dgWs, t0);
          break;

        case "Error":
          log("DG-ERR", JSON.stringify(msg), t0);
          this.sendJSON(connection, { type: "error", message: msg.message ?? "Deepgram error" });
          break;

        case "InjectionRefused":
          log("INJECT", `refused: ${JSON.stringify(msg)}`, t0);
          break;

        case "Warning":
          log("DG-WARN", JSON.stringify(msg), t0);
          if (typeof msg.message === 'string' && msg.message.includes('INJECT_AGENT_MESSAGE')) {
            log("INJECT-WARN", `${msg.message} — will retry on next silent window`, t0);
          }
          break;

        case "Close":
          log("DG", "Deepgram closed connection", t0);
          this.stopKeepAlive();
          connection.close();
          break;

        default:
          log("DG-MSG", `unhandled: ${msgType}`);
      }
    });

    dgWs.addEventListener("error", (e: Event) => {
      log("DG-ERR", `WebSocket error: ${JSON.stringify(e)}`, t0);
      if (this.browserConn) {
        this.sendJSON(this.browserConn, { type: "error", message: "Voice connection error", code: "DG_ERROR" });
      }
    });

    dgWs.addEventListener("close", (e: CloseEvent) => {
      log("DG", `closed: code=${e.code} reason="${e.reason}"`, t0);
      this.stopKeepAlive();
      this.dgSocket = null;

      // Normal close (user-initiated or server-initiated graceful) — notify and stop
      if (e.code === 1000 || e.code === 1001 || !this.browserConn) {
        log("DG", "normal close — not reconnecting");
        if (this.browserConn) {
          this.sendJSON(this.browserConn, { type: "call_ended", reason: "normal_close" });
        }
        return;
      }

      // Unexpected close — attempt auto-reconnect
      if (this.dgReconnectAttempts < ChrisAgent.MAX_DG_RECONNECTS) {
        this.dgReconnectAttempts++;
        const delay = this.dgReconnectAttempts * 1000; // 1s, 2s backoff
        log("DG", `unexpected close — reconnecting in ${delay}ms (attempt ${this.dgReconnectAttempts}/${ChrisAgent.MAX_DG_RECONNECTS})`);
        this.sendJSON(this.browserConn, { type: "reconnecting", attempt: this.dgReconnectAttempts });

        setTimeout(() => {
          if (!this.browserConn) return;
          log("DG", `reconnecting attempt ${this.dgReconnectAttempts}...`);
          this.openDGConnection(this.browserConn, "", Date.now());
        }, delay);
      } else {
        log("DG", `max reconnect attempts (${ChrisAgent.MAX_DG_RECONNECTS}) exhausted — call dead`);
        this.sendJSON(this.browserConn, { type: "error", message: "Voice connection lost", code: "DG_CLOSE_FINAL" });
      }
    });
  }

  // ── Keep-alive ─────────────────────────────────────────────────────────────
  private startKeepAlive(dgWs: WebSocket) {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(JSON.stringify({ type: "KeepAlive" }));
        log("DG", "KeepAlive sent");
      } else {
        this.stopKeepAlive();
      }
    }, KEEPALIVE_MS);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  // ── Tool call handler ──────────────────────────────────────────────────────
  private async handleToolCall(msg: Record<string, any>, dgWs: WebSocket, t0: number) {
    const fn = (Array.isArray(msg.functions) && msg.functions[0]) ? msg.functions[0] : msg;

    const fnName = (fn.name ?? fn.function_name ?? msg.name ?? msg.function_name) as string | undefined;
    const fnCallId = (fn.id ?? fn.function_call_id ?? msg.id ?? msg.function_call_id) as string | undefined;

    const argsRaw = fn.arguments ?? fn.input ?? msg.input ?? msg.arguments ?? "{}";
    let args: Record<string, any>;
    try {
      args = JSON.parse(typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw));
    } catch {
      args = {};
    }

    if (!fnName || !fnCallId) {
      log("TOOL", `INVALID FunctionCallRequest — missing name/id. Raw: ${JSON.stringify(msg).slice(0, 400)}`, t0);
      return;
    }

    if (fn.client_side === false) {
      log("TOOL", `${fnName} is server-side — skipping client response`, t0);
      return;
    }

    log("TOOL", `${fnName} args=${JSON.stringify(args).slice(0, 120)}`, t0);

    if (!args.lid && this.lid) args.lid = this.lid;

    let result: unknown = { error: "not executed" };
    try {
      // V3: Use TOOLS service binding if available, fall back to URL
      const toolsFetcher = this.env.TOOLS ?? null;
      const toolsUrl = this.env.TOOLS_WORKER_URL?.replace(/\/$/, "") ?? "";
      let res: Response;
      if (toolsFetcher) {
        // Service binding — internal RPC, no public URL needed
        res = await toolsFetcher.fetch(`https://tools-internal/${fnName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.env.TOOLS_BEARER_TOKEN ?? "bella-tools-v9-secret"}`,
          },
          body: JSON.stringify(args),
        });
      } else if (toolsUrl) {
        res = await fetch(`${toolsUrl}/${fnName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.env.TOOLS_BEARER_TOKEN ?? "bella-tools-v9-secret"}`,
          },
          body: JSON.stringify(args),
        });
      } else {
        throw new Error("No TOOLS service binding or TOOLS_WORKER_URL configured");
      }
      log("TOOL", `${fnName} → ${res.status}`, t0);
      if (res.ok) {
        result = await res.json();
      } else {
        result = { error: `Tool returned HTTP ${res.status}` };
      }
    } catch (e) {
      log("TOOL", `${fnName} FAILED: ${e}`, t0);
      result = { error: String(e) };
    }

    dgWs.send(JSON.stringify({
      type: "FunctionCallResponse",
      id: fnCallId,
      name: fnName,
      content: JSON.stringify(result),
    }));
  }

  /**
   * Inject deterministic text into Deepgram Voice Agent TTS.
   * Bypasses the think/LLM cycle entirely — goes straight to Aura-2.
   * Must only be called in silent windows (after AgentAudioDone, before UserStartedSpeaking).
   */
  private injectDeterministicSpeech(text: string): boolean {
    if (!this.dgSocket || this.dgSocket.readyState !== WebSocket.OPEN) {
      log("INJECT", "failed — no DG socket");
      return false;
    }

    this.dgSocket.send(JSON.stringify({
      type: "InjectAgentMessage",
      message: text,
    }));

    log("INJECT", `sent ${text.length} chars: "${text.slice(0, 80)}..."`);
    return true;
  }

  private sendJSON(c: any, d: unknown) { c.send(JSON.stringify(d)); }

  // ── Stage-adaptive UpdatePrompt ─────────────────────────────────────────────
  // Deepgram Agent API: eot_threshold/keyterms can NOT be changed mid-call.
  // But UpdatePrompt APPENDS to the managed LLM prompt — use it to inject
  // stage context + listening hints so Deepgram's LLM knows what to expect.
  private sendFluxConfigure(stage: Stage) {
    if (!this.dgSocket || this.dgSocket.readyState !== WebSocket.OPEN) return;

    // Chris-specific stage configs
    const configs: Record<string, { focus: string; keyterms?: string[] }> = {
      greeting:   { focus: "Welcome the visitor warmly. Wait for them to speak." },
      discovery:  { focus: "Listen to what the visitor needs. Ask open questions. Use site intel as background.", keyterms: ["help", "looking for", "interested", "want", "need", "question"] },
      cta_push:   { focus: "Drive toward the primary CTA. Make it easy for them to take the next step.", keyterms: ["book", "contact", "call", "get started", "yes", "sure"] },
      handoff:    { focus: "Confirm the handoff action and next steps clearly." },
    };

    const cfg = configs[stage] ?? { focus: "Continue the conversation naturally." };
    const keytermsHint = cfg.keyterms ? ` Key terms to listen for: ${cfg.keyterms.join(", ")}.` : "";

    this.dgSocket.send(JSON.stringify({
      type: "UpdatePrompt",
      prompt: `[Stage: ${stage}] ${cfg.focus}${keytermsHint}`,
    }));

    log("STAGE-CFG", `stage=${stage} UpdatePrompt sent: ${cfg.focus}`);
  }

  // ── SUPERGOD: Check KV for stage changes and update Flux ────────────────────
  // Called after AgentAudioDone — reads script_state from KV, fires Configure if changed
  private async checkAndUpdateFluxStage() {
    if (!this.lid) return;
    try {
      const stateRaw = await this.env.LEADS_KV.get(`lead:${this.lid}:script_state`);
      if (!stateRaw) return;
      const state = JSON.parse(stateRaw);
      const newStage = state.stage as Stage;
      if (newStage && newStage !== this.currentStage) {
        log("STAGE", `changed: ${this.currentStage} → ${newStage}`);
        this.currentStage = newStage;
        this.sendFluxConfigure(newStage);
      }
    } catch (e) {
      log("STAGE-ERR", `KV read failed: ${e}`);
    }
  }

  // signalWorkflowConnected not used by Chris — removed
}

// ── HTTP entry point ───────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }

    // Health check
    if (new URL(request.url).pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", version: VERSION }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // Route all /agents/* requests to the Durable Object via CF Agents SDK
    return (await routeAgentRequest(request, env))
      ?? new Response("Not found", { status: 404 });
  },
};
