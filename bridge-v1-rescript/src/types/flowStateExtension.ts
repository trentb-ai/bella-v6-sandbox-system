// FlowState extension types — Sprint 0
// These types EXTEND the existing State interface. Do not modify the existing State
// definition directly yet — Sprint 1A, 1B, 2 will wire these in.
// For now, export the types so they can be imported when needed.

export interface UnifiedLeadState {
  // Canonical cross-channel fields — write-once with correction window
  inbound_volume_weekly?: number;        // weekly inbound leads
  conversion_rate?: number;              // 0-1 decimal (not 0-100)
  avg_client_value?: number;             // ACV in dollars
  response_time_hours?: number;          // current speed-to-lead in hours

  // Timestamps for 2-minute correction window (Issue 5 / Issue 2)
  inbound_volume_weekly_set_at?: number;
  conversion_rate_set_at?: number;
  avg_client_value_set_at?: number;
  response_time_hours_set_at?: number;
}

export interface QuestionCacheEntry {
  question: string;              // the actual question text asked
  extractionField: string;       // e.g. 'inboundLeads', 'acv', 'conversionRate'
  channel: string;               // e.g. 'ch_alex', 'ch_chris'
  extractedValue?: string | number | null;  // null = asked but not answered
  attempts: number;              // how many times this field was asked
  lastAsked: number;             // timestamp ms
}

// Fields to add to State in Sprint 1A/1B:
export interface FlowStateExtension {
  unifiedState: UnifiedLeadState;
  rejectedWowSteps: string[];          // e.g. ['wow_3', 'wow_4']
  lastWowSentiment: 'positive' | 'negative' | 'neutral' | null;
  questionCache: QuestionCacheEntry[];
  deepIntelReady: boolean;             // true when deep.status === 'done'
  deepIntelTs: number | null;          // timestamp when deep intel completed
}

// Default values — use when initialising State in Sprint 1A/1B
export const FLOW_STATE_EXTENSION_DEFAULTS: FlowStateExtension = {
  unifiedState: {},
  rejectedWowSteps: [],
  lastWowSentiment: null,
  questionCache: [],
  deepIntelReady: false,
  deepIntelTs: null,
};
