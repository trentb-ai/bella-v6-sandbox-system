
import { WorkflowCompiler } from '../workflows-backend/src/services/compiler/workflow-compiler';
import { runPromise } from '../workflows-backend/src/core/effect/runtime';
import { bellaV9OrchestratorStarter } from '../workflows-backend/src/services/starters/starters/bella';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function deployBellaV9() {
  console.log('🚀 Starting Bella V9 SUPERGOD Deployment...');

  const workflowId = 'bella-v9-orchestrator-test';
  const workflowName = 'bella-scrape-workflow-v9-test'; // Deployment target name
  const className = 'BellaV9Orchestrator';

  console.log('📦 Compiling workflow...');
  const compileEffect = WorkflowCompiler.compile(
    {
      name: workflowName,
      nodes: bellaV9OrchestratorStarter.workflow.nodes as any,
      edges: bellaV9OrchestratorStarter.workflow.edges as any
    },
    {
      workflowId,
      desiredWorkflowName: workflowName,
      className
    }
  );

  const result = await runPromise(compileEffect);

  if (result.status !== 'success') {
    console.error('❌ Compilation failed:', result.errors);
    process.exit(1);
  }

  console.log('✅ Compilation successful.');

  const deployDir = join(__dirname, '..', 'temp-deploy-bella-v9');
  rmSync(deployDir, { recursive: true, force: true });
  mkdirSync(deployDir, { recursive: true });

  const workerPath = join(deployDir, 'index.mjs');
  const configPath = join(deployDir, 'wrangler.json');

  writeFileSync(workerPath, result.tsCode, 'utf-8');
  
  // Refine wrangler config for deployment
  const config = JSON.parse(result.wranglerConfig);
  config.name = workflowName;
  config.main = 'index.mjs';
  config.compatibility_date = '2025-10-22'; // Per central truth plan versioning
  config.compatibility_flags = ['nodejs_compat'];
  
  // Ensure KV binding is correct
  // The compiler should have added it if nodes use it.
  // Let's manually ensure WORKFLOWS_KV is bound if not already.
  // Ensure KV bindings are correct and have IDs
  const KV_ID = '0fec6982d8644118aba1830afd4a58cb';
  if (!config.kv_namespaces) config.kv_namespaces = [];
  
  // Filter out the default 'KV' binding if it's there and empty, or update it
  config.kv_namespaces = config.kv_namespaces.map((kv: any) => {
    if (kv.binding === 'WORKFLOWS_KV' || kv.binding === 'KV') {
      return { ...kv, binding: 'WORKFLOWS_KV', id: KV_ID };
    }
    if (kv.binding === 'LEADS_KV') {
      return { ...kv, id: KV_ID };
    }
    return kv;
  });

  // If WORKFLOWS_KV is still missing, add it
  if (!config.kv_namespaces.find((kv: any) => kv.binding === 'WORKFLOWS_KV')) {
    config.kv_namespaces.push({
      binding: 'WORKFLOWS_KV',
      id: KV_ID
    });
  }

  // LEADS_KV — same namespace, new binding name used by Stage 3+ nodes
  if (!config.kv_namespaces.find((kv: any) => kv.binding === 'LEADS_KV')) {
    config.kv_namespaces.push({
      binding: 'LEADS_KV',
      id: KV_ID
    });
  }

  // SUPERGOD gating — set to 'true' to enable granular Apify extraction
  if (!config.vars) config.vars = {};
  config.vars.ENABLE_DEEP_MAX = 'true';  // Toggle to 'false' to disable SUPERGOD

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  console.log(`📂 Prepared deployment files in ${deployDir}`);
  console.log('⚡ Deploying to Cloudflare...');

  const deployProcess = spawnSync('npx', ['wrangler', 'deploy', '-c', 'wrangler.json'], {
    cwd: deployDir,
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '9488d0601315a70cac36f9bd87aa4e82' }
  });

  if (deployProcess.status === 0) {
    console.log('🎉 Bella V9 SUPERGOD deployed successfully!');
  } else {
    console.error('❌ Deployment failed with exit code', deployProcess.status);
    process.exit(deployProcess.status ?? 1);
  }
}

deployBellaV9().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
