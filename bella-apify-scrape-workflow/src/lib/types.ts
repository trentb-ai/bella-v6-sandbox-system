// Shared types for bella-scrape-workflow-v9 modular rewrite

export interface WorkflowPayload {
  lid: string;
  url: string;
  name: string;
  firstName: string;
  email?: string;
}

export interface WorkflowResults {
  step_entry_0: WorkflowPayload;
  step_kv_put_1?: { success: boolean; key: string };
  step_http_request_2?: {
    status: number;
    headers: Record<string, string>;
    body: any;
    message: string;
  };
  step_transform_3?: { content: string };
  step_transform_4?: Record<string, any>;
  step_wait_event_7?: { event: null; timedOut: true };
  step_transform_12?: Record<string, any>;
  step_transform_13?: any;
  step_scrape_ad_pages_13b?: any;
  step_kv_put_14?: { success: boolean; key: string };
  step_kv_get_15?: { value: any; exists: boolean; metadata: any };
  step_transform_17?: { json: string };
  step_kv_put_18?: { success: boolean; key: string };
  step_transform_19?: { signal: string; status: string };
  step_return_20?: { status: string; lid: string; intel: string };
}

export interface WorkflowState {
  [key: string]: { input?: any; output?: any };
}

export interface Env {
  WORKFLOWS_KV: KVNamespace;
  BELLAV9ORCHESTRATOR_WORKFLOW: Workflow;
  AI: Ai;
  APIFY_TOKEN?: string;
  APIFY_API_KEY?: string;
  FIRECRAWL_KEY?: string;
  GEMINI_API_KEY?: string;
}

export interface StepFn {
  do: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}
