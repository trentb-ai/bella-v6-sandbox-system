/**
 * bella-voice-agent-v5 v3.0.0
 * Architecture: Browser WebSocket → Durable Object → Deepgram Voice Agent WS
 * v3.0.0: Consultant-driven intel (scraper → MCP → KV), no SC/ROI pipeline
 */

import { Agent, routeAgentRequest } from "agents";

const VERSION = "3.0.0-v6";
const log = (tag: string, msg: string, t0?: number) => {
  const elapsed = t0 !== undefined ? ` [+${Date.now() - t0}ms]` : "";
  console.log(`[BellaV4 ${VERSION}] [${tag}]${elapsed} ${msg}`);
};

// ── Deepgram config ──────────────────────────────────────────────────────────
const DG_VOICE = "aura-2-theia-en";
const DG_STT_MODEL = "nova-3";
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

const DEFAULT_PERSONA = `You are Bella, Strategic Intelligence Director at Pillar and Post AI. Warm, sharp, Australian. Live voice call.

RULES:
- RESPOND to what the prospect ACTUALLY SAID. Acknowledge their answer before anything else.
- ONE sentence per turn, max TWO. Then STOP and WAIT.
- Intel below is BACKGROUND KNOWLEDGE — never read it aloud or present it as a list.
- Weave in insights naturally when relevant. Be curious. React like a human.
- Say dollar amounts as words. No markdown, no bullets, no lists.`;

interface Env {
  BellaAgent: DurableObjectNamespace;
  LEADS_KV: KVNamespace;
  // V3: LEAD_PIPELINE removed — pipeline absorbed into scraper
  TOOLS: Fetcher;              // V3: service binding to bella-tools-worker-v4-sandbox
  DEEPGRAM_API_KEY: string;
  MCP_WORKER_URL: string;
  TOOLS_WORKER_URL: string;    // Legacy — prefer TOOLS service binding
  GHL_LOCATION_ID: string;
}

// v3.0.0: state — intel loaded flag, history, opening gate
interface BellaState {
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
  {
    name: "fetch_script_stage",
    description: "Retrieve the scripted guidance for a specific call stage (e.g. 'opening', 'audit', 'roi_reveal', 'close', 'objection_price'). Call this when transitioning between stages to get the exact talking points, questions, and fallbacks for that stage. Returns null gracefully if no stages are loaded.",
    parameters: {
      type: "object",
      properties: {
        lid: { type: "string", description: "The lead ID" },
        stage: { type: "string", description: "The stage name, e.g. 'opening', 'audit', 'roi_reveal', 'close', 'objection_price', 'objection_timing', 'booking'" }
      },
      required: ["lid", "stage"]
    }
  }
];

export class BellaAgent extends Agent<Env, BellaState> {
  private dgSocket: WebSocket | null = null;
  private browserConn: any = null;
  private lid: string = "";
  private systemPrompt: string = "";
  private keepAliveTimer: any = null;
  private urlHints: { biz: string; ind: string; serv: string; loc: string; fn: string } = { biz: "", ind: "", serv: "", loc: "", fn: "" };

  shouldSendProtocolMessages(): boolean { return false; }

  async onStart() {
    if (!this.state?.history) {
      this.setState({ openingFired: false, history: [], intelLoaded: false });
    }
  }

  async onConnect(connection: any) {
    const t0 = Date.now();
    this.browserConn = connection;
    this.lid = this.name; // DO name = lid from URL /agents/bella-agent/{lid}
    const isReconnect = (this.state?.history?.length ?? 0) > 0;
    log("CONNECT", `lid="${this.lid}" reconnect=${isReconnect}`, t0);

    // Read scraped data hints from URL params — set by loading-v15.html redirect
    // These are the immediate source of truth before KV pipeline completes
    const reqUrl = (connection.request?.url) ? new URL(connection.request.url) : null;
    this.urlHints = {
      biz: reqUrl?.searchParams.get('biz') ?? "",
      ind: reqUrl?.searchParams.get('ind') ?? "",
      serv: reqUrl?.searchParams.get('serv') ?? "",
      loc: reqUrl?.searchParams.get('loc') ?? "",
      fn: reqUrl?.searchParams.get('fn') ?? "",
    };
    if (this.urlHints.biz) log("CONNECT", `url hints: biz="${this.urlHints.biz}" fn="${this.urlHints.fn}"`, t0);

    if (!isReconnect) {
      this.setState({ openingFired: false, history: [], intelLoaded: false });
    }

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

    // Drop client-only control messages that Deepgram doesn't understand
    if (msg.type === "config" || msg.type === "flush") return;

    // Future-proofing: forward anything else
    this.dgSocket.send(message);
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

  // ── Intel fetch + system prompt build (v2.9.0: 3-layer approach) ───────────
  // Layer 1: MCP /resolve-intel (PRIMARY — always works, Google Places data etc.)
  // Layer 2: KV pipeline data (ENHANCEMENT — SC intel + 5× ROI when available)
  // Layer 3: Raw KV bare lid key + URL hints (FALLBACK)
  private async loadIntelAndConnect(connection: any, t0: number, retries = 0) {
    log("INTEL", `fetching for lid="${this.lid}"`, t0);
    let intel: Record<string, any> = {};
    let intelSuccess = false;

    // ── Layer 1: MCP enriched intel (top_fixes, close_strategies, Google data etc.) ──
    try {
      const res = await fetch(`${this.env.MCP_WORKER_URL}/resolve-intel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lid: this.lid, location_id: this.env.GHL_LOCATION_ID }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) { intel = data; intelSuccess = true; }
        log("INTEL", `MCP success=${data.success} biz="${data.business_name}" status="${data.pipeline_status}" fn="${data.first_name}"`, t0);
      } else {
        log("INTEL", `MCP non-ok response: ${res.status}`, t0);
      }
    } catch (e) {
      log("INTEL", `MCP exception: ${e}`, t0);
    }

    // ── Layer 2: KV intel (written by scraper via consultant) ──────────────
    let kvIntel: Record<string, any> | null = null;
    try {
      const intelStr = await this.env.LEADS_KV.get(`lead:${this.lid}:intel`);
      log("INTEL", `KV: intel=${!!intelStr}`, t0);
      if (intelStr) kvIntel = JSON.parse(intelStr);
    } catch (e) {
      log("INTEL", `KV intel fetch error: ${e}`, t0);
    }

    // ── Layer 3: Raw KV stub (bare lid key, written by loading page scrape) ──
    let rawLead: Record<string, any> = {};
    try {
      const rawStr = await this.env.LEADS_KV.get(this.lid);
      if (rawStr) {
        rawLead = JSON.parse(rawStr);
        log("INTEL", `raw KV hit: fn="${rawLead.firstName}" web="${rawLead.websiteUrl}"`, t0);
        // Merge raw scrape fields into intel if MCP didn't already fill them
        const merge = (intelKey: string, rawKey: string) => { if (rawLead[rawKey] && !intel[intelKey]) intel[intelKey] = rawLead[rawKey]; };
        if (!intel.first_name && rawLead.firstName) intel.first_name = rawLead.firstName;
        merge('industry', 'industry');
        merge('services', 'services');
        merge('location', 'location');
        merge('target_audience', 'target_audience');
        merge('phone', 'phone');
        merge('address', 'address');
        merge('business_hours', 'business_hours');
        merge('value_propositions', 'value_propositions');
        merge('main_usp', 'main_usp');
        merge('emergency_service', 'emergency_service');
        merge('business_model', 'business_model');
        if (rawLead.benefits && !intel.benefits)
          intel.benefits = Array.isArray(rawLead.benefits) ? rawLead.benefits.join(', ') : rawLead.benefits;
        if (rawLead.is_running_ads !== undefined && intel.is_running_ads === undefined) intel.is_running_ads = rawLead.is_running_ads;
        merge('ad_funnel_verdict', 'ad_funnel_verdict');
        merge('ad_monthly_loss', 'ad_monthly_loss');
      }
    } catch (e) {
      log("INTEL", `raw KV read failed: ${e}`, t0);
    }

    // ── Merge urlHints as priority override for placeholder/missing intel ─────
    const PLACEHOLDER = new Set(["your business", "your company", "unknown", "", "business"]);
    if (this.urlHints.biz && PLACEHOLDER.has((intel.business_name ?? "").toLowerCase().trim()))
      intel.business_name = this.urlHints.biz;
    if (this.urlHints.ind && !intel.industry) intel.industry = this.urlHints.ind;
    if (this.urlHints.serv && !intel.services) intel.services = this.urlHints.serv;
    if (this.urlHints.loc && !intel.location) intel.location = this.urlHints.loc;
    // URL fn param is ground truth (came directly from capture form) — always wins
    if (this.urlHints.fn) intel.first_name = this.urlHints.fn;
    else if (!intel.first_name && rawLead.firstName) intel.first_name = rawLead.firstName;

    // Last resort: extract business name from website URL domain
    if (!intel.business_name && rawLead.websiteUrl) {
      try {
        const host = new URL(rawLead.websiteUrl).hostname.replace(/^www\./, '');
        const domainName = host.split('.')[0];
        intel.business_name = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      } catch { }
    }

    log("INTEL", `final: biz="${intel.business_name}" fn="${intel.first_name}" kvIntel=${!!kvIntel}`, t0);

    // ── Build system prompt ──────────────────────────────────────────────────
    const [personaDataStr, scriptDataStr] = await Promise.all([
      this.env.LEADS_KV.get("brain:bella:prompt"),
      this.env.LEADS_KV.get("brain:bella:script_kb")
    ]);

    const parseKV = (str: string | null, fallback: string) => {
      if (!str) return fallback;
      try { return JSON.parse(str).prompt || str; }
      catch { return str; }
    };

    const corePrompt = parseKV(personaDataStr, DEFAULT_PERSONA);
    const scriptKb = parseKV(scriptDataStr, "");

    const basePrompt = scriptKb ? `${corePrompt}\n\n${scriptKb}` : corePrompt;
    this.setState({ ...this.state, intelLoaded: intelSuccess || !!kvIntel });

    // ── v3.0.0: If KV intel exists, use structured consultant prompt ──────────
    if (kvIntel) {
      this.systemPrompt = this.buildSystemPromptV3(kvIntel, intel.business_name ?? "your business", basePrompt);
      log("INTEL", `using v3.0.0 structured prompt (${this.systemPrompt.length} chars)`, t0);
    } else if (intelSuccess) {
      // ── Existing v2.7.6 prompt from MCP data ──────────────────────────────
      const topFixesText = (intel.top_fixes ?? []).map((f: any) =>
        `  - ${f.title ?? f.agent} → $${(f.monthly_revenue ?? 0).toLocaleString()}/mo (${f.agent})`).join("\n");
      const painPointsText = Array.isArray(intel.pain_points)
        ? intel.pain_points.join(", ")
        : intel.pain_points ?? "";

      const intelLines: string[] = [];
      const add = (label: string, val: any) => { if (val) intelLines.push(`${label}: ${val}`); };
      add("LEAD_ID", this.lid);
      add("BUSINESS", intel.business_name);
      add("FIRST NAME", intel.first_name || rawLead.firstName);
      add("WEBSITE", rawLead.websiteUrl);
      add("INDUSTRY", intel.industry);
      add("LOCATION", intel.location);
      add("SERVICES", intel.services);
      add("TARGET AUDIENCE", intel.target_audience);
      add("PAIN POINTS", painPointsText);
      if (intel.star_rating) add("GOOGLE RATING", `${intel.star_rating} (${intel.review_count ?? 0} reviews)`);

      const agentRanking = intel.agent_ranking ?? intel.top_agents ?? [];
      if (agentRanking.length > 0) add("AGENT RANKING (best fit first)", agentRanking.join(", "));
      add("BELLA OPENER", intel.bella_opener);
      add("PITCH HOOK", intel.pitch_hook);
      add("ROI NARRATIVE", intel.roi_narrative);
      add("ROUTING RECOMMENDATION", intel.routing_recommendation);
      add("INTELLIGENCE BRIEF", intel.intelligence_brief);

      const benchmark = intel.industry_benchmark as Record<string, any> ?? {};
      if (benchmark.acv || benchmark.conversion_rate) {
        const bmParts: string[] = [];
        if (benchmark.acv) bmParts.push(`avg customer value $${Number(benchmark.acv).toLocaleString()}`);
        if (benchmark.conversion_rate) bmParts.push(`typical conversion rate ${benchmark.conversion_rate}`);
        if (benchmark.monthly_leads) bmParts.push(`avg monthly leads ${benchmark.monthly_leads}`);
        add("INDUSTRY BENCHMARK", bmParts.join(", "));
      }

      const flags = intel.flags as Record<string, any> ?? {};
      if (flags.is_running_ads !== undefined) add("RUNNING GOOGLE ADS", flags.is_running_ads ? `Yes (verdict: ${flags.ad_funnel_verdict ?? 'unknown'})` : 'No');
      if (flags.speed_to_lead_needed) add("SPEED TO LEAD", "Critical — they need faster response times");
      if (topFixesText) add("TOP REVENUE FIXES", "\n" + topFixesText);
      if (intel.total_monthly_opportunity) add("TOTAL MONTHLY OPPORTUNITY", `$${Number(intel.total_monthly_opportunity).toLocaleString()}`);

      const rawExtras: string[] = [];
      const addRaw = (label: string, val: any) => { if (val) rawExtras.push(`${label}: ${val}`); };
      addRaw("PHONE", intel.phone);
      addRaw("ADDRESS", intel.address);
      addRaw("BUSINESS HOURS", intel.business_hours);
      addRaw("KEY BENEFITS", intel.benefits);
      addRaw("MAIN USP", intel.main_usp);
      addRaw("VALUE PROPS", intel.value_propositions);
      addRaw("EMERGENCY SERVICE", intel.emergency_service);
      if (intel.is_running_ads !== undefined && !flags.is_running_ads) addRaw("RUNNING ADS (raw)", intel.is_running_ads ? `Yes (verdict: ${intel.ad_funnel_verdict ?? 'unknown'}, estimated lost/mo: $${intel.ad_monthly_loss ?? '?'})` : 'No');
      if (rawExtras.length > 0) intelLines.push(`ADDITIONAL CONTEXT:\n${rawExtras.join("\n")}`);

      if (intel.industry_benchmark) {
        const bm = intel.industry_benchmark as Record<string, any>;
        const bmParts: string[] = [];
        if (bm.acv) bmParts.push(`benchmark ACV: $${bm.acv}`);
        if (bm.monthly_leads) bmParts.push(`typical monthly leads: ${bm.monthly_leads}`);
        if (bm.close_rate) bmParts.push(`close rate: ${(bm.close_rate * 100).toFixed(0)}%`);
        if (bmParts.length > 0) intelLines.push(`INDUSTRY BENCHMARK: ${bmParts.join(", ")}`);
      }

      this.systemPrompt = basePrompt + `\n\n--- PROSPECT INTEL (for reference — already confirmed pre-call) ---\n${intelLines.join("\n")}\n--- END INTEL ---\nCRITICAL: All intel above is ALREADY LOADED. Do NOT call resolve_intel_hot — the data is right here.\nYour FIRST spoken message MUST use this intel: business name + 2 exact scraped facts + top agent + estimate $ROI from TOP REVENUE FIXES.\nWhen the prospect shares their average customer value, call capture_acv immediately to record it — this personalises the rest of the conversation with their real numbers.\nYour lead ID for tool calls is: ${this.lid}`;
      log("INTEL", `using v2.7.6 MCP prompt (${this.systemPrompt.length} chars)`, t0);
    } else {
      const fn = rawLead.firstName ?? "";
      const web = rawLead.websiteUrl ?? "";
      this.systemPrompt = basePrompt + `\n\nNO ENRICHED INTEL LOADED.
lead_id: ${this.lid}
FIRST NAME: ${fn}
WEBSITE: ${web}
BUSINESS: ${intel.business_name || this.urlHints.biz || ""}
INDUSTRY: ${intel.industry || this.urlHints.ind || ""}
LOCATION: ${intel.location || this.urlHints.loc || ""}
The opening greeting has just been spoken. Begin Stage 1: ask their role, then what brings them here today.`;
      log("INTEL", `using fallback prompt`, t0);
    }

    // ── Null-guard: if NO data at all (not even URL hints), don't open WS ────
    // urlHints.biz is set from ?biz= param — enough to open with fallback prompt
    const hasMinData = intelSuccess || !!kvIntel || !!intel.business_name || !!this.urlHints.biz;
    if (!hasMinData) {
      log("INTEL", `null-guard: no data — proceeding with fallback prompt (intelSuccess=${intelSuccess} kvIntel=${!!kvIntel} biz=${intel.business_name} urlBiz=${this.urlHints.biz})`, t0);
    }
    if (intel.pipeline_status === "raw_only" && !kvIntel) {
      log("INTEL", `raw_only detected — proceeding with available data (no blocking retry)`, t0);
    }

    const firstName = intel.first_name ?? rawLead.firstName ?? "";
    const businessName = intel.business_name ?? rawLead.businessName ?? "your business";

    // ── Opening: use consultant-generated bella_opener if available ───────────
    let openingText: string;
    if (kvIntel?.bella_opener) {
      const greeting = firstName ? `Hey ${firstName}! ` : `Hey there! `;
      openingText = greeting + kvIntel.bella_opener.replace(/^Hi[^!]*!\s*/i, "");
      log("INTEL", `Consultant opener: "${openingText.slice(0, 80)}..."`, t0);
    } else if (intel.bella_opener) {
      const greeting = firstName ? `Hey ${firstName}! ` : `Hey there! `;
      openingText = greeting + intel.bella_opener.replace(/^Hi[^!]*!\s*/i, "");
      log("INTEL", `MCP opener: "${openingText.slice(0, 80)}..."`, t0);
    } else {
      openingText = firstName ? `Hi ${firstName}! I'm Bella.` : `Hi there! I'm Bella.`;
      log("INTEL", `fallback greeting`, t0);
    }

    // Tell browser intel is ready (triggers UI label update)
    this.sendJSON(connection, { type: "greeting_ready", first_name: firstName, business: businessName });

    await this.openDGConnection(connection, openingText, t0);
  }

  // V3: retriggerPipeline REMOVED — pipeline absorbed into scraper/orchestrator

  // ── v3.0.0: Structured system prompt from consultant intel ─────────────────
  private buildSystemPromptV3(intel: any, businessName: string, basePrompt: string): string {
    if (!intel) return basePrompt + "\n\nNO INTEL LOADED. Introduce yourself warmly and ask for their website URL so we can run an audit.";

    const ci = intel.core_identity ?? {};
    const wh = intel.website_health ?? {};
    const flags = intel.flags ?? {};
    const rank = intel.agent_ranking ?? [];
    const topFix = intel.top_fix ?? {};

    return `${basePrompt}

==============================
LIVE PROSPECT INTEL -- ${businessName}
==============================
BUSINESS: ${businessName}
TAGLINE: ${ci.tagline ?? ""}
INDUSTRY: ${ci.industry ?? ""} (${ci.industry_key ?? ""})
LOCATION: ${ci.location ?? "Australia"}
PHONE: ${ci.phone ?? ""}
HOURS: ${ci.business_hours ?? ""}
MODEL: ${ci.model ?? ""}

WEBSITE HEALTH:
Google Rating: ${wh.google_rating ?? "?"}/5 (${wh.review_count ?? 0} reviews)
Landing Page Score: ${wh.landing_page_score ?? "?"}/100
Tech Grade: ${wh.tech_grade ?? "?"} | Overall Grade: ${wh.overall_grade ?? "?"}
Has Chat: ${wh.has_chat ? "YES" : "NO"} | Has Booking: ${wh.has_booking ? "YES" : "NO"} | Has CRM: ${wh.has_crm ? "YES" : "NO"}

FLAGS:
Running Ads: ${flags.is_running_ads ? "YES" : "NO"}
Speed-to-Lead Needed: ${flags.speed_to_lead_needed ? "YES" : "NO"}
Website Concierge Needed: ${flags.website_concierge_needed ? "YES" : "NO"}
Call Handling Needed: ${flags.call_handling_needed ? "YES" : "NO"}
Database Reactivation: ${flags.database_reactivation ? "YES" : "NO"}

AGENT RANKING (best fit first): ${rank.join(", ")}
${topFix.copyHeadline ? `TOP OPPORTUNITY: ${topFix.copyHeadline}` : ""}
${topFix.copyBody ? `OPPORTUNITY CONTEXT: ${topFix.copyBody}` : ""}

OPENER HOOK: ${intel.bella_opener ?? ""}
PITCH HOOK: ${intel.pitch_hook ?? ""}

CLOSE STRATEGIES:
Price: ${intel.close_strategies?.price_objection ?? ""}
Timing: ${intel.close_strategies?.timing_objection ?? ""}
Not Interested: ${intel.close_strategies?.not_interested_objection ?? ""}

${(() => {
  const c = intel.consultant;
  if (!c || !c.scriptFills) return "";
  const sf = c.scriptFills;
  const r = c.routing ?? {};
  const lp = c.landingPageVerdict ?? {};
  const hooks = (c.conversationHooks ?? []).map((h: any) => `  - ${h.topic}: ${h.how}`).join("\n");
  const redFlags = (c.redFlags ?? []).map((f: any) => `  - ${f}`).join("\n");
  return `==============================
CONSULTANT INTEL (script-ready)
==============================
WEBSITE COMPLIMENT: ${sf.website_positive_comment ?? ""}
HERO QUOTE: ${sf.hero_header_quote ?? ""}
OFFER REFERENCE: ${sf.reference_offer ?? ""}
ICP GUESS: ${sf.icp_guess ?? ""}
AD CAMPAIGNS: ${sf.campaign_summary ?? "No active campaigns detected"}
REPUTATION: ${sf.rep_commentary ?? ""}
BEST REVIEW: ${sf.recent_review_snippet ?? ""}
REP ASSESSMENT: ${sf.rep_quality_assessment ?? ""}
TOP WEBSITE CTAs: ${sf.top_2_website_ctas ?? ""}

AGENT ROUTING:
Priority agents: ${(r.priority_agents ?? []).join(", ")}
Skip agents: ${(r.skip_agents ?? []).join(", ")}
${Object.entries(r.reasoning ?? {}).map(([a, reason]) => `  ${a}: ${reason}`).join("\n")}

LANDING PAGE VERDICT: ${lp.verdictLine ?? ""}
${lp.verdictLine2 ?? ""}
Barriers: ${(lp.conversionBarriers ?? []).join("; ")}

CONVERSATION HOOKS:
${hooks}

RED FLAGS:
${redFlags}`;
})()}

==============================
VOICE CALL RULES:
- No markdown. No bullet points. 2 sentences max per turn. Then STOP and WAIT.
- You are Bella, Strategic Intelligence Director for Pillar and Post AI.
- Use the real scraped business facts, website intel, and consultant insights naturally in conversation.
- React to what the prospect just said FIRST before moving forward.
- When the prospect shares their average customer value, call capture_acv immediately.
- Be warm, confident, and Australian. You know their business inside out.
- CRITICAL: All intel above is ALREADY LOADED. Do NOT call resolve_intel_hot.
- Your lead ID for tool calls is: ${this.lid}
==============================`;
  }

  // ── Open Deepgram Voice Agent WebSocket ────────────────────────────────────
  private async openDGConnection(connection: any, openingText: string, t0: number) {
    log("DG", "opening WebSocket", t0);

    // Auth: Sec-WebSocket-Protocol header with token subprotocol
    const dgWs = new WebSocket(DG_WS_URL, ["token", this.env.DEEPGRAM_API_KEY]);
    this.dgSocket = dgWs;

    dgWs.addEventListener("open", () => {
      log("DG", "connected — sending Settings", t0);

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
              version: "v1",
              model: DG_STT_MODEL,
              language: "en",
            }
          },
          think: {
            provider: {
              type: DG_LLM_PROVIDER,
              model: DG_LLM_MODEL,
            },
            endpoint: {
              url: "https://deepgram-bridge-sandbox-v6.trentbelasco.workers.dev/v1/chat/completions",
            },
            // Bridge replaces this system prompt on every turn with a lean
            // stage-specific prompt (~150 tokens). This is just a fallback
            // identity in case the bridge is unreachable.
            prompt: `You are Bella, Strategic Intelligence Director at Pillar and Post AI. Warm, sharp, Australian. Your lead ID is: ${this.lid}`,
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
        this.setState({ ...this.state, openingFired: true });
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

        case "Warning":
          log("DG-WARN", JSON.stringify(msg), t0);
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
    });

    dgWs.addEventListener("close", (e: CloseEvent) => {
      log("DG", `closed: code=${e.code} reason="${e.reason}"`, t0);
      this.stopKeepAlive();
      this.dgSocket = null;
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
            "Authorization": `Bearer ${this.env.TOOLS_BEARER_TOKEN ?? "bella-tools-v5-secret"}`,
          },
          body: JSON.stringify(args),
        });
      } else if (toolsUrl) {
        res = await fetch(`${toolsUrl}/${fnName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.env.TOOLS_BEARER_TOKEN ?? "bella-tools-v5-secret"}`,
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

  private sendJSON(c: any, d: unknown) { c.send(JSON.stringify(d)); }
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
