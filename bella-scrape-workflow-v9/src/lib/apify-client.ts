// Apify polling helpers — extracted verbatim from deployed.js parallel step

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

export async function pollRun(
  key: string,
  runId: string | null,
  apifyTk: string
): Promise<{ key: string; items: any[]; status: string; error?: string }> {
  if (!runId) return { key, items: [], status: "no_run" };
  try {
    for (let i = 0; i < 15; i++) {
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
