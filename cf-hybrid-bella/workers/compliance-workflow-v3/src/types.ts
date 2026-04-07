/**
 * compliance-workflow-v3/src/types.ts
 * Internal types for the compliance workflow.
 * CompliancePayload and ComplianceResult come from @bella/contracts.
 */

export interface NightlyPayload {
  date?: string;
}

export interface NightlyStats {
  date: string;
  total: number;
  flagged: number;
  driftRate: number;
  breakdown: unknown[];
}
