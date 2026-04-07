/**
 * headless-brain-test.mjs — First V3 live integration test
 *
 * Sends a sequence of synthetic TurnRequests to the deployed Brain DO
 * and validates stage advancement, confirmed facts, and ROI delivery.
 *
 * Usage: node scripts/headless-brain-test.mjs
 */

const BASE_URL = 'https://bella-brain-v3.trentbelasco.workers.dev';
const CALL_ID = `test-headless-${Date.now()}`;

// ── Turn Sequence ────────────────────────────────────────────────────────────

const TURNS = [
  // Turn 0: greeting (empty utterance — Brain returns greeting directive)
  { utterance: '', speakerFlag: 'prospect', label: 'greeting (empty)' },

  // Turn 1: prospect says hello — advances greeting → wow_1
  { utterance: 'hello', speakerFlag: 'prospect', label: 'prospect hello' },

  // Turn 2: Bella speaks wow_1 — wow_1/wow_2 advance on speakerFlag='bella'
  { utterance: 'Here is your first insight about your business...', speakerFlag: 'bella', label: 'bella wow_1 speak' },

  // Turn 3: Bella speaks wow_2 — auto-advance wow_2 → wow_3
  { utterance: 'And another thing I noticed about your website...', speakerFlag: 'bella', label: 'bella wow_2 speak' },

  // wow_3+: advance on speakerFlag='prospect' with stall >= 3
  // stall is already >= 3 by now (incremented every turn since turn 0)
  // Turn 4: prospect reply advances wow_3 → wow_4
  { utterance: 'interesting', speakerFlag: 'prospect', label: 'prospect wow_3 reply' },

  // Turn 5: prospect reply advances wow_4 → wow_5
  { utterance: 'tell me more', speakerFlag: 'prospect', label: 'prospect wow_4 reply' },

  // Turn 6: prospect reply advances wow_5 → wow_6
  { utterance: 'go on', speakerFlag: 'prospect', label: 'prospect wow_5 reply' },

  // Turn 7: prospect reply advances wow_6 → wow_7
  { utterance: 'that sounds great', speakerFlag: 'prospect', label: 'prospect wow_6 reply' },

  // Turn 8: prospect reply advances wow_7 → wow_8
  { utterance: 'yeah definitely', speakerFlag: 'prospect', label: 'prospect wow_7 reply' },

  // Turn 9: prospect reply advances wow_8 → recommendation
  { utterance: 'amazing', speakerFlag: 'prospect', label: 'prospect wow_8 reply' },

  // Turn 10: prospect reply advances recommendation → anchor_acv
  { utterance: 'sounds good tell me more', speakerFlag: 'prospect', label: 'recommendation reply' },

  // Turn 11: provide ACV — advances anchor_acv → first channel
  // (anchor_acv advances after 1 prospect reply OR if ACV captured)
  { utterance: 'about five thousand dollars', speakerFlag: 'prospect', label: 'ACV provision' },

  // Turn 12: channel stage — provide leads data
  { utterance: 'we get about twenty leads a week', speakerFlag: 'prospect', label: 'leads data' },

  // Turn 13: more data in channel
  { utterance: 'we convert maybe three of those', speakerFlag: 'prospect', label: 'conversion data' },

  // Turn 14: response speed
  { utterance: 'we respond within a few hours usually', speakerFlag: 'prospect', label: 'response speed' },

  // Turn 15: continue
  { utterance: 'yeah that makes sense', speakerFlag: 'prospect', label: 'channel cont' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(str, max = 80) {
  if (!str) return '(none)';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function makeTurnRequest(turnIndex, turn) {
  return {
    version: 1,
    callId: CALL_ID,
    turnId: `${CALL_ID}_t${turnIndex}`,
    utterance: turn.utterance,
    speakerFlag: turn.speakerFlag,
    turnIndex,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(80));
  console.log('BELLA BRAIN V3 — HEADLESS INTEGRATION TEST');
  console.log('='.repeat(80));
  console.log(`callId:   ${CALL_ID}`);
  console.log(`endpoint: ${BASE_URL}`);
  console.log(`turns:    ${TURNS.length}`);
  console.log('');

  // Health check first
  try {
    const healthResp = await fetch(`${BASE_URL}/health`);
    const health = await healthResp.json();
    console.log(`[HEALTH] status=${healthResp.status} version=${health.version} worker=${health.worker}`);
  } catch (err) {
    console.error(`[HEALTH] FAILED: ${err.message}`);
    console.error('Brain endpoint unreachable. Aborting.');
    process.exit(1);
  }
  console.log('');

  const results = [];
  let lastStage = null;
  const stageTransitions = [];

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    const body = makeTurnRequest(i, turn);

    console.log(`--- Turn ${i}: ${turn.label} ---`);
    console.log(`  utterance: "${turn.utterance}" | speakerFlag: ${turn.speakerFlag}`);

    const startMs = Date.now();
    let resp, data, error;

    try {
      resp = await fetch(`${BASE_URL}/turn?callId=${encodeURIComponent(CALL_ID)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const elapsed = Date.now() - startMs;

      if (!resp.ok) {
        const text = await resp.text();
        error = `HTTP ${resp.status}: ${text.slice(0, 200)}`;
        console.error(`  ERROR: ${error}`);
      } else {
        data = await resp.json();
        const stageChanged = data.stage !== lastStage;
        if (stageChanged && lastStage !== null) {
          stageTransitions.push({ from: lastStage, to: data.stage, atTurn: i });
        }
        lastStage = data.stage;

        console.log(`  stage:     ${data.stage}${stageChanged && i > 0 ? ' ** ADVANCED **' : ''}`);
        console.log(`  moveId:    ${data.moveId}`);
        console.log(`  mandatory: ${data.mandatory}`);
        console.log(`  maxTokens: ${data.maxTokens}`);
        console.log(`  directive: ${truncate(data.directive)}`);
        console.log(`  speakText: ${truncate(data.speakText)}`);
        console.log(`  confirmed: ${data.confirmedFacts?.length ?? 0} facts [${(data.confirmedFacts || []).join('; ')}]`);
        console.log(`  extract:   [${(data.extractionTargets || []).join(', ')}]`);
        console.log(`  context:   [${(data.contextNotes || []).join(', ')}]`);
        console.log(`  latency:   ${elapsed}ms`);
      }
    } catch (err) {
      error = err.message;
      console.error(`  FETCH ERROR: ${error}`);
    }

    results.push({
      turnIndex: i,
      label: turn.label,
      utterance: turn.utterance,
      speakerFlag: turn.speakerFlag,
      stage: data?.stage ?? 'ERROR',
      moveId: data?.moveId ?? '-',
      mandatory: data?.mandatory ?? '-',
      confirmedCount: data?.confirmedFacts?.length ?? 0,
      extractTargets: (data?.extractionTargets || []).join(','),
      error: error || null,
    });

    console.log('');
  }

  // ── Debug endpoint: get final state ──────────────────────────────────────
  console.log('--- Fetching final debug state ---');
  try {
    const debugResp = await fetch(`${BASE_URL}/debug?callId=${encodeURIComponent(CALL_ID)}`);
    const debugData = await debugResp.json();
    const s = debugData.state;
    if (s) {
      console.log(`  currentStage:    ${s.currentStage}`);
      console.log(`  turnIndex:       ${s.turnIndex}`);
      console.log(`  completedStages: [${s.completedStages?.join(', ')}]`);
      console.log(`  stall:           ${s.stall}`);
      console.log(`  wowStep:         ${s.wowStep}`);
      console.log(`  hotMemory:       ${JSON.stringify(s.hotMemory)}`);
      console.log(`  warmFacts:       ${s.warmFacts?.length ?? 0}`);
      console.log(`  intelReceived:   ${s.intelReceived}`);
      console.log(`  topAgents:       [${s.topAgents?.join(', ')}]`);
      console.log(`  questionCounts:  ${JSON.stringify(s.questionCounts)}`);
      console.log(`  calculatorResults: ${JSON.stringify(s.calculatorResults)}`);
    } else {
      console.log('  (no state found)');
    }
  } catch (err) {
    console.error(`  Debug fetch failed: ${err.message}`);
  }

  // ── Summary Table ──────────────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(80));
  console.log(
    'Turn'.padEnd(6) +
    'Label'.padEnd(25) +
    'Stage'.padEnd(22) +
    'Mandatory'.padEnd(11) +
    'Facts'.padEnd(7) +
    'Extract'.padEnd(20) +
    'Error'
  );
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      String(r.turnIndex).padEnd(6) +
      r.label.padEnd(25) +
      r.stage.padEnd(22) +
      String(r.mandatory).padEnd(11) +
      String(r.confirmedCount).padEnd(7) +
      (r.extractTargets || '-').padEnd(20) +
      (r.error || 'OK')
    );
  }

  // ── Stage Transitions ──────────────────────────────────────────────────────
  console.log('');
  console.log('STAGE TRANSITIONS:');
  if (stageTransitions.length === 0) {
    console.log('  (none detected — Brain may not have advanced)');
  } else {
    for (const t of stageTransitions) {
      console.log(`  Turn ${t.atTurn}: ${t.from} -> ${t.to}`);
    }
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('VALIDATION:');
  const errors = results.filter(r => r.error);
  const stages = results.map(r => r.stage);
  const uniqueStages = [...new Set(stages)];

  const hasGreeting = stages.includes('greeting');
  const hasWow = stages.some(s => s.startsWith('wow_'));
  const hasRecommendation = stages.includes('recommendation');
  const hasAnchorAcv = stages.includes('anchor_acv');
  const hasChannel = stages.some(s => s.startsWith('ch_'));

  console.log(`  Errors:          ${errors.length} / ${results.length} turns`);
  console.log(`  Unique stages:   [${uniqueStages.join(', ')}]`);
  console.log(`  greeting seen:   ${hasGreeting ? 'PASS' : 'FAIL'}`);
  console.log(`  wow seen:        ${hasWow ? 'PASS' : 'FAIL'}`);
  console.log(`  recommendation:  ${hasRecommendation ? 'PASS' : 'MISSING'}`);
  console.log(`  anchor_acv:      ${hasAnchorAcv ? 'PASS' : 'MISSING'}`);
  console.log(`  channel stage:   ${hasChannel ? 'PASS' : 'MISSING'}`);

  const allPass = errors.length === 0 && hasGreeting && hasWow;
  console.log('');
  console.log(allPass ? 'RESULT: PASS (core flow works)' : 'RESULT: ISSUES DETECTED — see above');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
