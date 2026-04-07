/**
 * headless-prompt-intel-test.mjs — V3 Integration Tests
 *
 * Test A: Prompt Worker Direct (Gemini stream + deterministic bypass)
 * Test B: Brain DO with Intel Delivery (intel injection + channel routing)
 *
 * Usage: node scripts/headless-prompt-intel-test.mjs
 */

const PROMPT_URL = 'https://bella-prompt-v3.trentbelasco.workers.dev';
const BRAIN_URL = 'https://bella-brain-v3.trentbelasco.workers.dev';

// ── SSE Parser ──────────────────────────────────────────────────────────────

async function parseSSE(response) {
  const text = await response.text();
  const lines = text.split('\n');
  let fullContent = '';
  const chunks = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data);
      const content = parsed?.choices?.[0]?.delta?.content;
      if (content) {
        fullContent += content;
        chunks.push(content);
      }
    } catch {
      // skip malformed
    }
  }

  return { fullContent, chunks, rawLength: text.length };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str, max = 80) {
  if (!str) return '(none)';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function header(resp, name) {
  return resp.headers.get(name);
}

function assert(label, condition) {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${label}`);
  return condition;
}

// ════════════════════════════════════════════════════════════════════════════
// TEST A: PROMPT WORKER DIRECT
// ════════════════════════════════════════════════════════════════════════════

async function testA() {
  console.log('');
  console.log('='.repeat(80));
  console.log('TEST A: PROMPT WORKER DIRECT');
  console.log('='.repeat(80));

  let passes = 0;
  let total = 0;

  // ── A1: Gemini Stream ───────────────────────────────────────────────────

  console.log('\n--- A1: Gemini stream (ch_alex stage) ---');
  const a1Body = {
    plan: {
      version: 1,
      callId: 'test-prompt-direct',
      turnId: 'turn-prompt-1',
      stage: 'ch_alex',
      moveId: 'ch_alex_0',
      directive: 'Ask the prospect how many inbound leads they get per week',
      mandatory: false,
      maxTokens: 150,
      confirmedFacts: ['Business: KPMG Australia', 'ACV: $5,000'],
      activeMemory: [],
      contextNotes: ['Prospect is engaged and curious'],
      extractionTargets: ['inboundLeads'],
    },
    utterance: 'That sounds interesting, tell me more about Alex',
  };

  let a1Resp;
  try {
    const start = Date.now();
    a1Resp = await fetch(`${PROMPT_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a1Body),
    });
    const elapsed = Date.now() - start;
    console.log(`  HTTP ${a1Resp.status} (${elapsed}ms)`);

    total++;
    if (assert('HTTP 200', a1Resp.status === 200)) passes++;

    const contentType = header(a1Resp, 'content-type');
    console.log(`  Content-Type: ${contentType}`);
    total++;
    if (assert('Content-Type = text/event-stream', contentType?.includes('text/event-stream'))) passes++;

    const stage = header(a1Resp, 'x-bella-stage');
    console.log(`  X-Bella-Stage: ${stage}`);
    total++;
    if (assert('X-Bella-Stage = ch_alex', stage === 'ch_alex')) passes++;

    const move = header(a1Resp, 'x-bella-move');
    console.log(`  X-Bella-Move: ${move}`);

    const deterministic = header(a1Resp, 'x-bella-deterministic');
    console.log(`  X-Bella-Deterministic: ${deterministic}`);
    total++;
    if (assert('NOT deterministic (Gemini path)', deterministic !== 'true')) passes++;

    const { fullContent, chunks, rawLength } = await parseSSE(a1Resp);
    console.log(`  SSE chunks: ${chunks.length}`);
    console.log(`  Raw body length: ${rawLength}`);
    console.log(`  Full response text:`);
    console.log(`    "${fullContent}"`);

    total++;
    if (assert('Response has content', fullContent.length > 0)) passes++;
  } catch (err) {
    console.error(`  FETCH ERROR: ${err.message}`);
  }

  // ── A2: Deterministic Bypass ────────────────────────────────────────────

  console.log('\n--- A2: Deterministic bypass (roi_delivery stage) ---');
  const expectedSpeakText =
    'Based on your numbers, Alex would recover an additional twelve thousand five hundred dollars per week for KPMG Australia.';

  const a2Body = {
    plan: {
      version: 1,
      callId: 'test-prompt-deterministic',
      turnId: 'turn-det-1',
      stage: 'roi_delivery',
      moveId: 'roi_delivery_0',
      directive: 'Deliver Alex ROI',
      speakText: expectedSpeakText,
      mandatory: true,
      maxTokens: 150,
      confirmedFacts: ['ACV: $5,000', 'Leads: 50'],
      activeMemory: [],
      contextNotes: [],
      extractionTargets: [],
    },
    utterance: '',
  };

  try {
    const start = Date.now();
    const a2Resp = await fetch(`${PROMPT_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a2Body),
    });
    const elapsed = Date.now() - start;
    console.log(`  HTTP ${a2Resp.status} (${elapsed}ms)`);

    total++;
    if (assert('HTTP 200', a2Resp.status === 200)) passes++;

    const contentType = header(a2Resp, 'content-type');
    console.log(`  Content-Type: ${contentType}`);
    total++;
    if (assert('Content-Type = text/event-stream', contentType?.includes('text/event-stream'))) passes++;

    const stage = header(a2Resp, 'x-bella-stage');
    console.log(`  X-Bella-Stage: ${stage}`);
    total++;
    if (assert('X-Bella-Stage = roi_delivery', stage === 'roi_delivery')) passes++;

    const deterministic = header(a2Resp, 'x-bella-deterministic');
    console.log(`  X-Bella-Deterministic: ${deterministic}`);
    total++;
    if (assert('X-Bella-Deterministic = true', deterministic === 'true')) passes++;

    const { fullContent, chunks } = await parseSSE(a2Resp);
    console.log(`  SSE chunks: ${chunks.length}`);
    console.log(`  Full response text:`);
    console.log(`    "${fullContent}"`);

    total++;
    if (assert('Contains "twelve thousand five hundred dollars"',
      fullContent.includes('twelve thousand five hundred dollars'))) passes++;

    total++;
    if (assert('Exact speakText match', fullContent === expectedSpeakText)) passes++;

  } catch (err) {
    console.error(`  FETCH ERROR: ${err.message}`);
  }

  console.log(`\nTest A Result: ${passes}/${total} assertions passed`);
  return { passes, total };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST B: BRAIN DO WITH INTEL DELIVERY
// ════════════════════════════════════════════════════════════════════════════

async function testB() {
  console.log('');
  console.log('='.repeat(80));
  console.log('TEST B: BRAIN DO WITH INTEL DELIVERY');
  console.log('='.repeat(80));

  const CALL_ID = `test-intel-${Date.now()}`;
  console.log(`  callId: ${CALL_ID}`);

  let passes = 0;
  let total = 0;

  // Helper: send a turn to Brain
  async function sendTurn(turnIndex, utterance, speakerFlag, label) {
    const body = {
      version: 1,
      callId: CALL_ID,
      turnId: `${CALL_ID}_t${turnIndex}`,
      utterance,
      speakerFlag,
      turnIndex,
    };

    const start = Date.now();
    const resp = await fetch(`${BRAIN_URL}/turn?callId=${encodeURIComponent(CALL_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const elapsed = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`  [Turn ${turnIndex}] ${label} — ERROR HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await resp.json();
    console.log(
      `  [Turn ${turnIndex}] ${label} (${elapsed}ms)\n` +
      `    stage: ${data.stage} | moveId: ${data.moveId}\n` +
      `    confirmedFacts: [${(data.confirmedFacts || []).join('; ')}]\n` +
      `    extractionTargets: [${(data.extractionTargets || []).join(', ')}]\n` +
      `    directive: ${truncate(data.directive)}`
    );
    return data;
  }

  // ── Step 1: Greeting turn (turnIndex=0, empty utterance) ────────────────

  console.log('\n--- Step 1: Greeting turn ---');
  const turn0 = await sendTurn(0, '', 'prospect', 'greeting (empty)');
  if (turn0) {
    total++;
    if (assert('Turn 0 stage = greeting', turn0.stage === 'greeting')) passes++;
  }

  // ── Step 2: POST intel ──────────────────────────────────────────────────

  console.log('\n--- Step 2: POST intel ---');
  const intelBody = {
    version: 1,
    lid: CALL_ID,
    ts: new Date().toISOString(),
    source: 'fast_intel',
    business_name: 'KPMG Australia',
    core_identity: {
      business_name: 'KPMG Australia',
      industry: 'Professional Services',
      location: 'Sydney, Australia',
    },
    consultant: {
      businessIdentity: {
        correctedName: 'KPMG Australia Pty Ltd',
      },
    },
    flags: {
      speed_to_lead_needed: true,
      call_handling_needed: true,
    },
    tech_stack: {},
  };

  let intelAccepted = false;
  try {
    const start = Date.now();
    const intelResp = await fetch(
      `${BRAIN_URL}/intel?callId=${encodeURIComponent(CALL_ID)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intelBody),
      }
    );
    const elapsed = Date.now() - start;
    const intelResult = await intelResp.json();
    console.log(`  HTTP ${intelResp.status} (${elapsed}ms) — ${JSON.stringify(intelResult)}`);

    total++;
    intelAccepted = intelResp.status === 200 && intelResult.ok === true;
    if (assert('Intel accepted (HTTP 200, ok=true)', intelAccepted)) passes++;
  } catch (err) {
    console.error(`  Intel POST failed: ${err.message}`);
  }

  // ── Step 3: Prospect says hello (turnIndex=1) — should advance past greeting ──

  console.log('\n--- Step 3: Prospect hello (advance past greeting) ---');
  const turn1 = await sendTurn(1, 'hello', 'prospect', 'prospect hello');
  if (turn1) {
    total++;
    if (assert('Turn 1 advanced past greeting', turn1.stage !== 'greeting')) passes++;
  }

  // ── Steps 4+: Continue through wow stages ──────────────────────────────

  console.log('\n--- Steps 4+: wow stage progression ---');

  // wow_1 and wow_2 advance on bella turns
  const turn2 = await sendTurn(2, 'Here is your first insight about your business...', 'bella', 'bella wow_1 speak');
  const turn3 = await sendTurn(3, 'And another thing I noticed about your website...', 'bella', 'bella wow_2 speak');

  // wow_3+ advance on prospect turns with stall >= 3
  const prospectReplies = [
    'interesting',
    'tell me more',
    'go on',
    'that sounds great',
    'yeah definitely',
    'amazing',
  ];

  let turnIdx = 4;
  let lastData = turn3;
  for (const reply of prospectReplies) {
    lastData = await sendTurn(turnIdx, reply, 'prospect', `prospect reply (t${turnIdx})`);
    turnIdx++;
  }

  // ── Post-wow: recommendation ────────────────────────────────────────────

  console.log('\n--- Recommendation + anchor_acv ---');
  const recReply = await sendTurn(turnIdx++, 'sounds good tell me more', 'prospect', 'recommendation reply');
  const acvReply = await sendTurn(turnIdx++, 'about five thousand dollars', 'prospect', 'ACV provision');

  // ── Check for channel stages ────────────────────────────────────────────

  console.log('\n--- Channel stage check ---');
  const chReply = await sendTurn(turnIdx++, 'we get about twenty leads a week', 'prospect', 'leads data');

  // ── Fetch debug state ───────────────────────────────────────────────────

  console.log('\n--- Debug state ---');
  let debugState = null;
  try {
    const debugResp = await fetch(`${BRAIN_URL}/debug?callId=${encodeURIComponent(CALL_ID)}`);
    const debugData = await debugResp.json();
    debugState = debugData.state;

    if (debugState) {
      console.log(`  currentStage:    ${debugState.currentStage}`);
      console.log(`  turnIndex:       ${debugState.turnIndex}`);
      console.log(`  completedStages: [${debugState.completedStages?.join(', ')}]`);
      console.log(`  intelReceived:   ${debugState.intelReceived}`);
      console.log(`  businessName:    ${debugState.businessName}`);
      console.log(`  topAgents:       [${debugState.topAgents?.join(', ')}]`);
      console.log(`  alexEligible:    ${debugState.alexEligible}`);
      console.log(`  chrisEligible:   ${debugState.chrisEligible}`);
      console.log(`  maddieEligible:  ${debugState.maddieEligible}`);
      console.log(`  warmFacts:       ${debugState.warmFacts?.length ?? 0}`);
      console.log(`  hotMemory:       ${JSON.stringify(debugState.hotMemory)}`);
      console.log(`  currentQueue:    [${debugState.currentQueue?.map(q => q.stage).join(', ')}]`);
    } else {
      console.log('  (no state found)');
    }
  } catch (err) {
    console.error(`  Debug fetch failed: ${err.message}`);
  }

  // ── Collect all turn stages for validation ──────────────────────────────

  const allTurns = [turn0, turn1, turn2, turn3, lastData, recReply, acvReply, chReply].filter(Boolean);
  const allStages = allTurns.map(t => t.stage);

  console.log('\n--- Validation ---');

  // Intel was accepted
  total++;
  if (assert('Intel accepted', intelAccepted)) passes++;

  // Business name appears in confirmedFacts after intel
  const allFacts = allTurns.flatMap(t => t.confirmedFacts || []);
  const hasBusinessName = allFacts.some(f => f.includes('KPMG'));
  console.log(`  All confirmedFacts across turns: ${allFacts.length} entries`);
  total++;
  if (assert('Business name "KPMG" appears in confirmedFacts', hasBusinessName)) passes++;

  // Also check debug state warmFacts
  if (debugState) {
    const warmHasKPMG = debugState.warmFacts?.some(
      f => f.fact_key === 'business_name' && f.fact_value?.includes('KPMG')
    );
    total++;
    if (assert('warmFacts contains KPMG business_name', warmHasKPMG)) passes++;

    total++;
    if (assert('intelReceived = true', debugState.intelReceived === true)) passes++;

    // Channel stages appear (ch_alex expected due to speed_to_lead_needed)
    const queueStages = debugState.currentQueue?.map(q => q.stage) || [];
    const hasChAlex = queueStages.some(s => s === 'ch_alex') || allStages.some(s => s === 'ch_alex');
    const currentIsChannel = debugState.currentStage?.startsWith('ch_');
    const completedHasChannel = debugState.completedStages?.some(s => s.startsWith('ch_'));
    total++;
    if (assert(
      'ch_alex in queue OR current/completed stages (speed_to_lead flag)',
      hasChAlex || currentIsChannel || completedHasChannel
    )) passes++;

    // Alex eligible due to speed_to_lead_needed
    total++;
    if (assert('alexEligible = true', debugState.alexEligible === true)) passes++;
  }

  console.log(`\nTest B Result: ${passes}/${total} assertions passed`);
  return { passes, total };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('='.repeat(80));
  console.log('BELLA V3 — HEADLESS PROMPT + INTEL INTEGRATION TEST');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Prompt:    ${PROMPT_URL}`);
  console.log(`Brain:     ${BRAIN_URL}`);

  // Health checks
  console.log('\n--- Health Checks ---');
  for (const [name, url] of [['Prompt', PROMPT_URL], ['Brain', BRAIN_URL]]) {
    try {
      const resp = await fetch(`${url}/health`);
      const data = await resp.json();
      console.log(`  ${name}: HTTP ${resp.status} version=${data.version} worker=${data.worker}`);
    } catch (err) {
      console.error(`  ${name}: UNREACHABLE — ${err.message}`);
      console.error(`  Aborting.`);
      process.exit(1);
    }
  }

  const resultA = await testA();
  const resultB = await testB();

  // ── Final Summary ─────────────────────────────────────────────────────

  console.log('');
  console.log('='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  const totalPasses = resultA.passes + resultB.passes;
  const totalTests = resultA.total + resultB.total;
  console.log(`  Test A (Prompt Worker): ${resultA.passes}/${resultA.total}`);
  console.log(`  Test B (Brain + Intel): ${resultB.passes}/${resultB.total}`);
  console.log(`  Overall:               ${totalPasses}/${totalTests}`);
  console.log('');
  console.log(totalPasses === totalTests ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED — see above');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
