/**
 * close-paths.test.ts — Close Stage Path A (free trial) and Path B (agent handoff)
 *
 * Assertions from the brief:
 * 1. POST /turn with closeChoice='trial' → closeSubStage = 'email_capture'
 * 2. POST /turn with email transcript → closeSubStage = 'confirmed', closeComplete = true
 * 3. POST /turn with closeChoice='demo' → closeSubStage = 'agent_handoff', closeComplete = true
 * 4. Agent opener speak contains exact locked phrases
 * 5. Pricing objection: closePricingObjectionPending set, subStage unchanged
 * 6. Pricing objection clears on next turn, resumes normal path
 */

import { describe, it, expect } from 'vitest';
import { mockState, mockIntel, ALL_WOW_STEPS } from './helpers';
import { processFlow } from '../flow';
import { buildStageDirective } from '../moves';
import { buildMergedIntel } from '../flow';
import { assertInvariants } from './invariants';
import type { ConversationState, MergedIntel, FlowResult } from '../types';

const NOW = Date.now();

/** Wrapper: runs processFlow then asserts all state invariants. */
function flowAndAssert(
  state: ConversationState,
  intel: MergedIntel,
  transcript: string,
  ctx?: string,
): FlowResult {
  if (state.pendingDelivery) state.pendingDelivery.issuedAt -= 5000;
  const result = processFlow(state, intel, transcript, `turn_${Date.now()}`, NOW);
  assertInvariants(state, ctx ?? transcript.slice(0, 40));
  return result;
}

/** Create a state that is already at the close stage (recommendation spoken). */
function closeState(overrides?: Partial<ConversationState>): ConversationState {
  return mockState({
    currentStage: 'close',
    currentWowStep: null,
    completedStages: ['greeting', 'wow', 'recommendation'],
    completedWowSteps: ALL_WOW_STEPS,
    topAgents: ['chris', 'alex', 'maddie'],
    firstName: 'Trent',
    business: 'Acme Corp',
    closeSubStage: null,
    closeChoice: null,
    closeComplete: null,
    trialEmail: null,
    agentRequested: null,
    closePricingObjectionPending: null,
    ...overrides,
  });
}

const intel = mockIntel({ fast: { business_name: 'Acme Corp', first_name: 'Trent' } });

// ─────────────────────────────────────────────────────────────────────────────
// PATH A — FREE TRIAL
// ─────────────────────────────────────────────────────────────────────────────

describe('Close Path A — free trial', () => {
  it('ASSERTION 1: "yes" at offer advances to email_capture', () => {
    const state = closeState();
    flowAndAssert(state, intel, 'Yes, let\'s do the trial', 'offer→email_capture');
    expect(state.closeSubStage).toBe('email_capture');
    expect(state.closeChoice).toBe('trial');
    expect(state.closeComplete).toBeFalsy();
  });

  it('ASSERTION 1b: "activate" keyword at offer advances to email_capture', () => {
    const state = closeState();
    flowAndAssert(state, intel, "Sure, let's activate it", 'activate→email_capture');
    expect(state.closeSubStage).toBe('email_capture');
  });

  it('ASSERTION 2: email in transcript advances to confirmed, closeComplete=true', () => {
    const state = closeState({ closeSubStage: 'email_capture', closeChoice: 'trial' });
    flowAndAssert(state, intel, 'Sure, it is trent@test.com', 'email→confirmed');
    expect(state.closeSubStage).toBe('confirmed');
    expect(state.trialEmail).toBe('trent@test.com');
    expect(state.closeComplete).toBe(true);
  });

  it('ASSERTION 2b: pre-extracted trialEmail also advances to confirmed', () => {
    const state = closeState({
      closeSubStage: 'email_capture',
      closeChoice: 'trial',
      trialEmail: 'extracted@example.com',
    });
    flowAndAssert(state, intel, 'Go ahead', 'pre-extracted-email→confirmed');
    expect(state.closeSubStage).toBe('confirmed');
    expect(state.closeComplete).toBe(true);
  });

  it('confirmed speak contains email address', () => {
    const state = closeState({
      closeSubStage: 'confirmed',
      closeChoice: 'trial',
      trialEmail: 'trent@test.com',
      closeComplete: true,
    });
    const mergedIntel = buildMergedIntel(state);
    const directive = buildStageDirective({ stage: 'close', intel: mergedIntel, state });
    expect(directive.speak).toContain('trent@test.com');
    expect(directive.speak).toContain("Beautiful — I've got");
    expect(directive.speak).toContain("You'll see that come through shortly");
  });

  it('confirmed is terminal — no further advancement', () => {
    const state = closeState({
      closeSubStage: 'confirmed',
      closeComplete: true,
      trialEmail: 'trent@test.com',
    });
    const result = flowAndAssert(state, intel, "That's great, what happens next?", 'confirmed-terminal');
    expect(state.closeSubStage).toBe('confirmed');
    expect(result.advanced).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATH B — AGENT HANDOFF
// ─────────────────────────────────────────────────────────────────────────────

describe('Close Path B — agent handoff', () => {
  it('ASSERTION 3: "demo" keyword at offer advances to agent_handoff, closeComplete=true', () => {
    const state = closeState();
    flowAndAssert(state, intel, "I'd like to hear the agent", 'demo→agent_handoff');
    expect(state.closeSubStage).toBe('agent_handoff');
    expect(state.closeChoice).toBe('demo');
    expect(state.closeComplete).toBe(true);
    expect(state.agentRequested).toBeTruthy();
  });

  it('ASSERTION 3b: "bring them on" advances to agent_handoff', () => {
    const state = closeState();
    flowAndAssert(state, intel, 'bring them on', 'bring→agent_handoff');
    expect(state.closeSubStage).toBe('agent_handoff');
  });

  it('defaults to topAgents[0] (chris) when no specific agent named', () => {
    const state = closeState({ topAgents: ['chris', 'alex'] });
    flowAndAssert(state, intel, "I'd like to hear the agent demo", 'default-agent');
    expect(state.agentRequested).toBe('chris');
  });

  it('resolves "alex" by name', () => {
    const state = closeState({ topAgents: ['chris', 'alex'] });
    flowAndAssert(state, intel, "I want to hear Alex", 'named-alex');
    expect(state.agentRequested).toBe('alex');
  });

  it('resolves "maddie" by name', () => {
    const state = closeState({ topAgents: ['chris', 'maddie'] });
    flowAndAssert(state, intel, "Can I hear Maddie?", 'named-maddie');
    expect(state.agentRequested).toBe('maddie');
  });

  it('ASSERTION 4: agent_handoff speak contains Chris opener verbatim', () => {
    const state = closeState({
      closeSubStage: 'agent_handoff',
      agentRequested: 'chris',
      closeComplete: true,
    });
    const mergedIntel = buildMergedIntel(state);
    const directive = buildStageDirective({ stage: 'close', intel: mergedIntel, state });
    // Lead-in
    expect(directive.speak).toContain("I'll bring Chris on now");
    expect(directive.speak).toContain("ready to blow them away");
    // Chris opener — locked phrases
    expect(directive.speak).toContain("Bella you know I'm always ready");
    expect(directive.speak).toContain("I'm Chris");
    expect(directive.speak).toContain("I have already been through your site");
    expect(directive.speak).toContain("just pretend you are a prospect walking in");
  });

  it('ASSERTION 4b: Alex opener contains locked phrases', () => {
    const state = closeState({
      closeSubStage: 'agent_handoff',
      agentRequested: 'alex',
      closeComplete: true,
    });
    const mergedIntel = buildMergedIntel(state);
    const directive = buildStageDirective({ stage: 'close', intel: mergedIntel, state });
    expect(directive.speak).toContain("Always ready Bella");
    expect(directive.speak).toContain("I'm Alex");
    expect(directive.speak).toContain("always first to respond to every inbound lead");
    expect(directive.speak).toContain("Send a test enquiry through your website right now");
  });

  it('ASSERTION 4c: Maddie opener contains locked phrases', () => {
    const state = closeState({
      closeSubStage: 'agent_handoff',
      agentRequested: 'maddie',
      closeComplete: true,
    });
    const mergedIntel = buildMergedIntel(state);
    const directive = buildStageDirective({ stage: 'close', intel: mergedIntel, state });
    expect(directive.speak).toContain("I'm Maddie");
    expect(directive.speak).toContain("nothing ever gets missed");
    expect(directive.speak).toContain("Give me a ring on your business number");
  });

  it('agent_handoff is terminal — no further advancement', () => {
    const state = closeState({
      closeSubStage: 'agent_handoff',
      agentRequested: 'chris',
      closeComplete: true,
    });
    const result = flowAndAssert(state, intel, 'Wow that was impressive', 'agent_handoff-terminal');
    expect(state.closeSubStage).toBe('agent_handoff');
    expect(result.advanced).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRICING OBJECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Close — pricing objection handler', () => {
  it('pricing objection at offer stage sets flag, does not advance subStage', () => {
    const state = closeState();
    flowAndAssert(state, intel, 'How much does it cost?', 'pricing-at-offer');
    expect(state.closePricingObjectionPending).toBe(true);
    expect(state.closeSubStage).toBeNull();
  });

  it('pricing objection at email_capture stage sets flag, does not advance subStage', () => {
    const state = closeState({ closeSubStage: 'email_capture', closeChoice: 'trial' });
    flowAndAssert(state, intel, "What's the fee for this?", 'pricing-at-email_capture');
    expect(state.closePricingObjectionPending).toBe(true);
    expect(state.closeSubStage).toBe('email_capture');
  });

  it('pricing objection directive delivers performance-based pricing response', () => {
    const state = closeState({ closePricingObjectionPending: true });
    const mergedIntel = buildMergedIntel(state);
    const directive = buildStageDirective({ stage: 'close', intel: mergedIntel, state });
    expect(directive.speak).toContain('performance-based pricing');
    expect(directive.speak).toContain('zero financial risk');
    expect(directive.speak).toContain("let's get you set up first");
  });

  it('pricing flag clears on next turn, then resumes to email_capture on trial response', () => {
    const state = closeState({ closePricingObjectionPending: true });
    // Next turn — pricing flag should clear and trial path should activate
    flowAndAssert(state, intel, "OK that makes sense, let's do the trial", 'pricing-cleared-then-trial');
    expect(state.closePricingObjectionPending).toBeFalsy();
    expect(state.closeSubStage).toBe('email_capture');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OFFER DIRECTIVE
// ─────────────────────────────────────────────────────────────────────────────

describe('Close — offer directive', () => {
  it('offer speak contains both paths', () => {
    const state = closeState();
    const mergedIntel = buildMergedIntel(state);
    const directive = buildStageDirective({ stage: 'close', intel: mergedIntel, state });
    expect(directive.speak).toContain('free trial');
    expect(directive.speak).toContain('bring one of the agents on the call');
    expect(directive.waitForUser).toBe(true);
  });

  it('offer does not advance on empty transcript', () => {
    const state = closeState();
    flowAndAssert(state, intel, '', 'empty-transcript');
    expect(state.closeSubStage).toBeNull();
  });

  it('ambiguous "show me" goes demo not trial', () => {
    const state = closeState();
    flowAndAssert(state, intel, 'show me', 'show-me-demo');
    expect(state.closeSubStage).toBe('agent_handoff');
    expect(state.closeChoice).toBe('demo');
  });
});
