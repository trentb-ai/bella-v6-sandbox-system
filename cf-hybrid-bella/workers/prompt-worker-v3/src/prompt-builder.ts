/**
 * prompt-worker-v3/src/prompt-builder.ts — Prompt assembly from TurnPlan
 * Chunk 2 — V3
 *
 * buildPrompt() → [systemMessage, userMessage] for Gemini.
 * Total budget: < 2600 chars (system + user combined).
 * Brain decides WHAT to say. Prompt Worker decides HOW to say it.
 * Prompt Worker never reads lead_facts, KV, or DO state — everything comes from TurnPlan.
 */

import type { TurnPlan } from '@bella/contracts';
import type { GeminiMessage } from './types';
import { BELLA_PERSONA } from './persona';

// ─── buildPrompt() ───────────────────────────────────────────────────────────

export function buildPrompt(plan: TurnPlan): GeminiMessage[] {
  return [
    { role: 'system', content: buildSystemMessage(plan) },
    { role: 'user', content: buildUserMessage(plan) },
  ];
}

// ─── System Message ──────────────────────────────────────────────────────────

/**
 * Persona + reference data. Bounded to ~1.5K chars.
 */
function buildSystemMessage(plan: TurnPlan): string {
  const sections: string[] = [];

  sections.push('==== BELLA PERSONA ====');
  sections.push(BELLA_PERSONA);

  sections.push('\n==== REFERENCE DATA (do not read aloud) ====');

  if (plan.confirmedFacts.length > 0) {
    sections.push('Confirmed facts:');
    sections.push(plan.confirmedFacts.map(f => `• ${f}`).join('\n'));
  }

  if (plan.contextNotes.length > 0) {
    sections.push('\nContext notes:');
    sections.push(plan.contextNotes.map(n => `• ${n}`).join('\n'));
  }

  if (plan.activeMemory.length > 0) {
    sections.push('\nActive memory:');
    sections.push(plan.activeMemory.map(m => `• ${m}`).join('\n'));
  }

  return sections.join('\n');
}

// ─── User Message ────────────────────────────────────────────────────────────

/**
 * Directive + output contract. Directive comes first.
 */
function buildUserMessage(plan: TurnPlan): string {
  const speakSection = buildSpeakSection(plan);

  const paraphraseRule = plan.mandatory
    ? 'You MUST deliver the speak text verbatim — do not paraphrase'
    : 'Paraphrase naturally while keeping the objective';

  const parts: string[] = [];

  parts.push('==== MANDATORY DIRECTIVE ====');
  parts.push(`Stage: ${plan.stage}`);
  parts.push(`Objective: ${plan.directive}`);

  if (speakSection) {
    parts.push('');
    parts.push(speakSection);
  }

  parts.push('');
  parts.push('==== OUTPUT CONTRACT ====');
  parts.push(`- Respond in 1-3 sentences maximum (${plan.maxTokens} token budget)`);
  parts.push('- DO NOT re-ask anything listed in CONFIRMED FACTS above');
  parts.push('- DO NOT do math, calculations, or estimate dollar values — all numbers come from the plan');
  parts.push(`- ${paraphraseRule}`);
  parts.push('- Never apologise');
  parts.push("- Never criticise the prospect's website or business");
  parts.push('- This is an INBOUND demo — the prospect submitted their details on your website');

  return parts.join('\n');
}

// ─── speakSection conditional ────────────────────────────────────────────────

function buildSpeakSection(plan: TurnPlan): string {
  if (!plan.speakText) return '';
  return plan.mandatory
    ? `SPEAK THIS EXACTLY: ${plan.speakText}`
    : `SUGGESTED WORDING (paraphrase naturally): ${plan.speakText}`;
}
