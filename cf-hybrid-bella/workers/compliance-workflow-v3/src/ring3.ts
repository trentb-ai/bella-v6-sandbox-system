/**
 * compliance-workflow-v3/src/ring3.ts
 * Ring 3 — Nightly drift scoring (async Cloudflare Workflow).
 * Aggregates D1 quality_scores, writes nightly report to R2.
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { NightlyPayload } from './types';

interface Env {
  DB: D1Database;
  AUDIT_BUCKET: R2Bucket;
  VERSION?: string;
}

interface NightlyStats {
  date: string;
  total: number;
  flagged: number;
  driftRate: number;
  breakdown: any[];
}

export class NightlyReplayWorkflow extends WorkflowEntrypoint<Env, NightlyPayload> {
  async run(event: WorkflowEvent<NightlyPayload>, step: WorkflowStep) {
    const targetDate =
      event.payload.date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Step 1: Aggregate D1 quality_scores for target date
    const stats: NightlyStats = await step.do('aggregate', async (): Promise<NightlyStats> => {
      const rows = await this.env.DB.prepare(
        `SELECT drift_type, AVG(compliance_score) as avg_score, COUNT(*) as count
         FROM quality_scores
         WHERE DATE(created_at) = ?
         GROUP BY drift_type`
      )
        .bind(targetDate)
        .all();

      const total = rows.results.reduce((s: number, r: any) => s + (r.count as number), 0);
      const flagged = rows.results.reduce(
        (s: number, r: any) => (r.drift_type !== 'none' ? s + (r.count as number) : s),
        0
      );

      return {
        date: targetDate,
        total,
        flagged,
        driftRate: total > 0 ? flagged / total : 0,
        breakdown: rows.results as any[],
      };
    }) as NightlyStats;

    // Step 2: Write R2 nightly report
    await step.do('write-report', async () => {
      const key = `nightly/${targetDate}.json`;
      const report: NightlyStats & { generatedAt: string } = {
        ...stats,
        generatedAt: new Date().toISOString(),
      };
      await this.env.AUDIT_BUCKET.put(key, JSON.stringify(report), {
        httpMetadata: { contentType: 'application/json' },
      });
      console.log(
        `[COMPLIANCE] Nightly report key=${key} driftRate=${(stats.driftRate * 100).toFixed(1)}% total=${stats.total}`
      );
    });
  }
}
