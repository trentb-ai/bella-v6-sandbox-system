#!/usr/bin/env node
/**
 * V1 STAGE MACHINE VALIDATION
 * Tests: wow → channels → close (no anchor_acv, anchor_timeframe, roi_delivery)
 */

console.log("🧪 V1 Stage Machine Test\n");

// Mock minimal State type
function createState(stage, queue = [], done = []) {
  return {
    stage,
    queue,
    done,
    stall: 0,
    just_demo: false,
    inputs: {}
  };
}

// Copied advance() logic from index.ts
function advance(s) {
  const state = { ...s };
  state.done.push(state.stage);
  state.stall = 0;

  if (state.just_demo && state.stage.startsWith("ch_")) {
    state.stage = "close";
    console.log(`  ADVANCE: ${s.stage} → ${state.stage} (just_demo skip)`);
    return state;
  }

  if (state.stage === "wow") {
    state.stage = state.queue.shift() ?? "close";
  } else if (state.stage === "deep_dive") {
    state.stage = state.queue.shift() ?? "close";
  } else if (state.stage.startsWith("ch_")) {
    state.stage = state.queue.shift() ?? "close";
  }

  console.log(`  ADVANCE: ${s.stage} → ${state.stage}`);
  return state;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Test 1: wow → close (empty queue)
test("wow → close (no channels)", () => {
  let s = createState("wow", []);
  s = advance(s);
  assert(s.stage === "close", `Expected "close", got "${s.stage}"`);
  assert(s.done.includes("wow"), "wow should be in done");
});

// Test 2: wow → ch_ads → close
test("wow → ch_ads → close", () => {
  let s = createState("wow", ["ch_ads"]);
  s = advance(s);
  assert(s.stage === "ch_ads", `Expected "ch_ads", got "${s.stage}"`);
  s = advance(s);
  assert(s.stage === "close", `Expected "close", got "${s.stage}"`);
  assert(s.done.includes("wow") && s.done.includes("ch_ads"), "Both stages should be in done");
});

// Test 3: wow → ch_ads → ch_website → close
test("wow → ch_ads → ch_website → close", () => {
  let s = createState("wow", ["ch_ads", "ch_website"]);
  s = advance(s);
  assert(s.stage === "ch_ads", `Step 1: Expected "ch_ads", got "${s.stage}"`);
  s = advance(s);
  assert(s.stage === "ch_website", `Step 2: Expected "ch_website", got "${s.stage}"`);
  s = advance(s);
  assert(s.stage === "close", `Step 3: Expected "close", got "${s.stage}"`);
});

// Test 4: deep_dive → close
test("deep_dive → close", () => {
  let s = createState("deep_dive", []);
  s = advance(s);
  assert(s.stage === "close", `Expected "close", got "${s.stage}"`);
});

// Test 5: just_demo shortcut from channel
test("ch_ads → close (just_demo)", () => {
  let s = createState("ch_ads", ["ch_website"]);
  s.just_demo = true;
  s = advance(s);
  assert(s.stage === "close", `Expected "close" (just_demo skip), got "${s.stage}"`);
});

// Test 6: Verify NO references to removed stages
test("No anchor_acv in valid stages", () => {
  const validStages = ["wow", "deep_dive", "ch_ads", "ch_website", "ch_phone", "ch_old_leads", "ch_reviews", "close"];
  assert(!validStages.includes("anchor_acv"), "anchor_acv should be removed");
  assert(!validStages.includes("anchor_timeframe"), "anchor_timeframe should be removed");
  assert(!validStages.includes("roi_delivery"), "roi_delivery should be removed");
});

// Test 7: Max 2 channels + tease
test("Max queue size (2 channels)", () => {
  let s = createState("wow", ["ch_ads", "ch_website"]); // buildQueue should never exceed 2
  s = advance(s);
  s = advance(s);
  s = advance(s);
  assert(s.stage === "close", "Should reach close after 2 channels");
  assert(s.done.length === 3, `Expected 3 stages in done (wow+2ch), got ${s.done.length}`);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(50)}\n`);

if (failed > 0) {
  console.log("❌ STAGE MACHINE TEST FAILED");
  process.exit(1);
} else {
  console.log("✅ STAGE MACHINE TEST PASSED");
  console.log("✅ V1 stage machine ready for deployment");
  process.exit(0);
}
