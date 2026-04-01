// Apify helpers — fire actors + poll for results + memory quota management

// Per-actor timeout overrides (ms) — browser-heavy actors need more time
const ACTOR_TIMEOUT_OVERRIDES: Record<string, number> = {
  facebook_ads: 120000,
  google_ads_transparency: 120000,
};

export async function fireActor(
  key: string, actor: string, payload: any, apifyTk: string
): Promise<{ key: string; runId: string | null; status: string }> {
  try {
    const url = "https://api.apify.com/v2/acts/" + actor + "/runs?token=" + apifyTk;
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    };
    const resp = await fetch(url, opts);
    const j: any = await resp.json();
    const dObj: any = (j && j.data) || Object.values(j || {}).find((v: any) => v && typeof v === "object" && v.id) || {};

    // P2-T3: Retry once after 3s if no run ID returned (transient Apify rate limit)
    if (!dObj.id) {
      console.log("[apify] WARN: No runId for " + key + " — retrying in 3s. response=" + JSON.stringify(j).slice(0, 300));
      await new Promise(r => setTimeout(r, 3000));
      const retryResp = await fetch(url, opts);
      const rj: any = await retryResp.json();
      const rObj: any = (rj && rj.data) || Object.values(rj || {}).find((v: any) => v && typeof v === "object" && v.id) || {};
      if (rObj.id) {
        console.log("[apify] Retry succeeded for " + key + " runId=" + rObj.id);
        return { key, runId: rObj.id, status: "started_retry" };
      }
      console.log("[apify] Retry also failed for " + key + " response=" + JSON.stringify(rj).slice(0, 300));
      return { key, runId: null, status: "no_id" };
    }
    return { key, runId: dObj.id, status: "started" };
  } catch (e: any) {
    console.log("[apify] ERROR firing " + key + ": " + e.message);
    return { key, runId: null, status: "failed" };
  }
}

export interface WaveResult {
  items: Record<string, any[]>;
  debug: { key: string; runId: string | null; fireStatus: string; pollStatus: string; itemCount: number; error?: string }[];
}

export async function fireAndPollWave(
  actors: { key: string; actor: string; payload: any }[],
  apifyTk: string,
  baseTimeoutMs: number = 90000
): Promise<WaveResult> {
  // Fire all actors in this wave
  const runs = await Promise.all(
    actors.map(a => fireActor(a.key, a.actor, a.payload, apifyTk))
  );
  const fireLog = runs.map(r => r.key + ":" + (r.runId ? r.runId.slice(0, 8) : "FAIL")).join(", ");
  console.log("[apify] Wave fired: " + fireLog);

  // Poll all runs until complete — use per-actor timeout overrides where defined
  const pollResults = await Promise.all(
    runs.map(r => {
      const timeout = ACTOR_TIMEOUT_OVERRIDES[r.key] ?? baseTimeoutMs;
      return withTimeout(pollRun(r.key, r.runId, apifyTk), timeout)
        .then(res => res || { key: r.key, items: [], status: "timeout_race" });
    })
  );

  // P2-T4: Re-poll timed-out Wave 1 actors with 60s grace (re-poll existing run, don't re-fire)
  const timedOut = pollResults
    .map((r: any, idx: number) => ({ ...r, idx }))
    .filter((r: any) => r.status === "timeout_race" && runs[r.idx].runId);

  if (timedOut.length > 0) {
    console.log("[apify] Re-polling " + timedOut.length + " timed-out actors with 60s grace: " + timedOut.map((r: any) => r.key).join(", "));
    const retryResults = await Promise.all(
      timedOut.map((r: any) =>
        withTimeout(pollRun(r.key, runs[r.idx].runId, apifyTk), 60000)
          .then(res => res || { key: r.key, items: [], status: "timeout_race_retry" })
      )
    );
    // Merge retry results back
    retryResults.forEach((retry: any) => {
      const origIdx = pollResults.findIndex((p: any) => p.key === retry.key);
      if (origIdx >= 0 && (retry.items?.length > 0 || retry.status === "done")) {
        pollResults[origIdx] = retry;
        console.log("[apify] Retry succeeded for " + retry.key + " items=" + (retry.items?.length || 0));
      }
    });
  }

  // Collect items + debug info
  const items: Record<string, any[]> = {};
  const debug: WaveResult["debug"] = [];
  pollResults.forEach((r: any, i: number) => {
    items[r.key] = r.items || [];
    debug.push({
      key: r.key,
      runId: runs[i].runId,
      fireStatus: runs[i].status,
      pollStatus: r.status,
      itemCount: r.items?.length || 0,
      error: r.error
    });
    console.log("[apify] " + r.key + ": fire=" + runs[i].status + " poll=" + r.status + " items=" + (r.items?.length || 0) + (r.error ? " err=" + r.error : ""));
  });
  return { items, debug };
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

// ── MEMORY QUOTA MANAGEMENT ──

export async function checkApifyMemory(apifyTk: string): Promise<number> {
  try {
    const resp = await fetch("https://api.apify.com/v2/users/me/limits?token=" + apifyTk);
    const j: any = await resp.json();
    return j?.data?.currentMemoryMbytes || 0;
  } catch (e) {
    return 0;
  }
}

export async function waitForMemory(
  needed: number, apifyTk: string, cap: number = 8192
): Promise<{ available: number; ok: boolean }> {
  for (let retry = 0; retry < 3; retry++) {
    const current = await checkApifyMemory(apifyTk);
    const available = cap - current;
    console.log("[APIFY_QUOTA] Memory check: current=" + current + "MB available=" + available + "MB needed=" + needed + "MB");
    if (available >= needed) return { available, ok: true };
    console.log("[APIFY_QUOTA] Insufficient memory, waiting 5s (retry " + (retry + 1) + "/3)...");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const current = await checkApifyMemory(apifyTk);
  return { available: cap - current, ok: (cap - current) >= needed };
}

export async function pollRun(
  key: string,
  runId: string | null,
  apifyTk: string
): Promise<{ key: string; items: any[]; status: string; error?: string }> {
  if (!runId) return { key, items: [], status: "no_run" };
  try {
    for (let i = 0; i < 45; i++) {
      const statusResp = await fetch("https://api.apify.com/v2/actor-runs/" + runId + "?token=" + apifyTk);
      if (!statusResp.ok) return { key, items: [], status: "api_error_" + statusResp.status };
      const statusJson: any = await statusResp.json();
      const dObj: any = Object.values(statusJson || {}).find((v: any) => v && typeof v === "object") || {};
      const runStatus = dObj.status || "";
      if (runStatus === "SUCCEEDED") {
        const dsId = dObj.defaultDatasetId;
        if (!dsId) return { key, items: [], status: "no_dataset" };
        const itemsResp = await fetch("https://api.apify.com/v2/datasets/" + dsId + "/items?token=" + apifyTk + "&limit=10");
        const items: any = await itemsResp.json();
        return { key, items: items || [], status: "done" };
      }
      if (runStatus === "FAILED" || runStatus === "ABORTED" || runStatus === "TIMED-OUT") {
        return { key, items: [], status: runStatus.toLowerCase() };
      }
      await new Promise((resolve) => setTimeout(resolve, 2e3));
    }
    return { key, items: [], status: "poll_timeout" };
  } catch (e: any) {
    return { key, items: [], status: "error", error: e.message };
  }
}
