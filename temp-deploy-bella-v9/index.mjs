import { WorkflowEntrypoint } from 'cloudflare:workers';

export class BellaV9Orchestrator extends WorkflowEntrypoint {
  async run(event, step) {
    console.log('type:WF_START:timestamp:'+Date.now()+':instanceId:'+event.instanceId+':eventTimestamp:'+event.timestamp+':payload:'+JSON.stringify(event.payload));
    const _workflowResults = {};
    const _workflowState = {};

    try {
      console.log('type:WF_NODE_START:nodeId:node-entry:nodeName:'+"entry"+':nodeType:'+'entry'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_entry_0 = event.payload || {};
        _workflowState['node-entry'] = {
          input: event.payload,
          output: _workflowResults.step_entry_0
        };
      _workflowState['node-entry'] = _workflowState['node-entry'] || { output: _workflowResults.step_entry_0 };
      console.log('type:WF_NODE_END:nodeId:node-entry:nodeName:'+"entry"+':nodeType:'+'entry'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-entry']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-entry:nodeName:'+"entry"+':nodeType:'+'entry'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-kv-stub:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_1 = await step.do("step_kv_put_1", async () => {
          const inputData = _workflowState['node-entry']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:stub`;
          const value = `{"status": "pending", "basics": {"name": "${_workflowResults.step_entry_0.name}", "url": "${_workflowResults.step_entry_0.url}", "firstName": "${_workflowResults.step_entry_0.firstName}"}}`;
          await this.env["WORKFLOWS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-kv-stub'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-kv-stub'] = _workflowState['node-kv-stub'] || { output: _workflowResults.step_kv_put_1 };
      console.log('type:WF_NODE_END:nodeId:node-kv-stub:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-kv-stub']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-kv-stub:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-firecrawl:nodeName:'+"http-request"+':nodeType:'+'http-request'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_http_request_2 = await step.do('step_http_request_2', async () => {
          const inputData = _workflowState['node-kv-stub']?.output || event.payload;
          const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: 'POST',
            headers: {
            'Authorization': `Bearer ${this.env.FIRECRAWL_KEY}`,
            'Content-Type': "application/json"
            },
            body: `{"url": "${_workflowResults.step_entry_0.url}", "formats": ["markdown"], "onlyMainContent": true}`,
            signal: AbortSignal.timeout(150000)
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          const body = await response.json();
          const result = {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: body,
            message: 'HTTP request completed successfully'
          };
          _workflowState['node-firecrawl'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-firecrawl'] = _workflowState['node-firecrawl'] || { output: _workflowResults.step_http_request_2 };
      console.log('type:WF_NODE_END:nodeId:node-firecrawl:nodeName:'+"http-request"+':nodeType:'+'http-request'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-firecrawl']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-firecrawl:nodeName:'+"http-request"+':nodeType:'+'http-request'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-truncate-content:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_3 = await step.do('step_transform_3', async () => {
              const inputData = _workflowState['node-firecrawl']?.output || event.payload;
              const result = await (async () => { const fcResp = _workflowState['node-firecrawl']?.output?.body || {};
        const entries = Object.entries(fcResp);
        const mainEntry = entries.find(([k]) => k !== 'success');
        const scrapeObj = mainEntry ? mainEntry[1] : {};
        const md = (scrapeObj?.markdown || '').slice(0, 4000);
        return { content: md }; })();
              _workflowState['node-truncate-content'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-truncate-content'] = _workflowState['node-truncate-content'] || { output: _workflowResults.step_transform_3 };
      console.log('type:WF_NODE_END:nodeId:node-truncate-content:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-truncate-content']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-truncate-content:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-fire-apify:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_4 = await step.do('step_transform_4', async () => {
              const inputData = _workflowState['node-truncate-content']?.output || event.payload;
              const result = await (async () => { const entry = _workflowState['node-entry']?.output || {};
        const bizName = entry.name || '';
        const siteUrl = entry.url || '';
        const domainName = siteUrl ? new URL(siteUrl).hostname.replace('www.', '') : '';
        const slug = bizName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const apifyTk = this.env.APIFY_TOKEN || this.env.APIFY_API_KEY;
        const actors = [
          { key: 'facebook_ads', actor: 'apify~facebook-ads-scraper', payload: { startUrls: [{ url: 'https://www.facebook.com/ads/library/?search_term=' + domainName }], maxAds: 10 } },
          { key: 'google_ads', actor: 'apify~google-search-scraper', payload: { queries: 'site:google.com/aclk ' + domainName, maxPagesPerQuery: 1 } },
          { key: 'indeed', actor: 'misceres~indeed-scraper', payload: { position: '', company: bizName, country: 'AU', maxItems: 5 } },
          { key: 'google_maps', actor: 'compass~google-maps-reviews-scraper', payload: { searchStringsArray: [bizName], maxCrawledPlacesPerSearch: 1, language: 'en', maxReviews: 8 } },
          { key: 'linkedin', actor: 'bebity~linkedin-scraper', payload: { urls: ['https://www.linkedin.com/company/' + slug], proxy: { useApifyProxy: true } } }
        ];
        const startResults = await Promise.all(
          actors.map(a =>
            fetch('https://api.apify.com/v2/acts/' + a.actor + '/runs?token=' + apifyTk, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(a.payload)
            }).then(r => r.json()).then(j => { const dObj = Object.values(j || {}).find(v => v && typeof v === 'object') || {}; return { key: a.key, runId: dObj.id || null, status: 'started' }; }).catch(e => ({ key: a.key, runId: null, status: 'failed', error: e.message }))
          )
        );
        const runs = {};
        startResults.forEach(r => { runs[r.key] = r; });
        return runs; })();
              _workflowState['node-fire-apify'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-fire-apify'] = _workflowState['node-fire-apify'] || { output: _workflowResults.step_transform_4 };
      console.log('type:WF_NODE_END:nodeId:node-fire-apify:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-fire-apify']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-fire-apify:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-consultant-ai:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_workers_ai_5 = await step.do('step_workers_ai_5', async () => {
          const inputData = _workflowState['node-fire-apify']?.output || event.payload;
          const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
            prompt: `The business name is ${JSON.stringify(_workflowState['node-entry'].output.name)}. Using content from ${JSON.stringify(_workflowResults.step_transform_3.content)}, output one polished paragraph only. Flattery + sophisticated insight on market positioning, who they help, how they help. Always use the business name naturally the way a human would say it in conversation — e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no tone analysis, no bullets.`, temperature: 0.7
          });
          const result = {
            response: response,
            text: response.response || response.text || JSON.stringify(response),
            usage: response.usage || {}
          };
          _workflowState['node-consultant-ai'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-consultant-ai'] = _workflowState['node-consultant-ai'] || { output: _workflowResults.step_workers_ai_5 };
      console.log('type:WF_NODE_END:nodeId:node-consultant-ai:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-consultant-ai']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-consultant-ai:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-kv-phase-a:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_6 = await step.do("step_kv_put_6", async () => {
          const inputData = _workflowState['node-consultant-ai']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:phase_a`;
          const value = `${_workflowResults.step_workers_ai_5.text}`;
          await this.env["WORKFLOWS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-kv-phase-a'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-kv-phase-a'] = _workflowState['node-kv-phase-a'] || { output: _workflowResults.step_kv_put_6 };
      console.log('type:WF_NODE_END:nodeId:node-kv-phase-a:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-kv-phase-a']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-kv-phase-a:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-wait-call-connected:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        try {
          const _waitEvent = await step.waitForEvent('step_wait_event_7', { type: 'call-connected', timeout: '5 minutes' });
          _workflowResults.step_wait_event_7 = { event: _waitEvent, timedOut: false };
        } catch (e) {
          if ('continue' === 'continue') {
            _workflowResults.step_wait_event_7 = { event: null, timedOut: true };
          } else {
            throw e;
          }
        }
      _workflowState['node-wait-call-connected'] = _workflowState['node-wait-call-connected'] || { output: _workflowResults.step_wait_event_7 };
      console.log('type:WF_NODE_END:nodeId:node-wait-call-connected:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-wait-call-connected']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-wait-call-connected:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-kv-get-fast:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_get_8 = await step.do("step_kv_get_8", async () => {
          const inputData = _workflowState['node-wait-call-connected']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:phase_a`;
          const value = await this.env["WORKFLOWS_KV"].get(key, { type: "text" });
          const result = {
            value,
            exists: value !== null,
            metadata: value ? { key } : null
          };

          _workflowState['node-kv-get-fast'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-kv-get-fast'] = _workflowState['node-kv-get-fast'] || { output: _workflowResults.step_kv_get_8 };
      console.log('type:WF_NODE_END:nodeId:node-kv-get-fast:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-kv-get-fast']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-kv-get-fast:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-ai-refine-wow:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_workers_ai_9 = await step.do('step_workers_ai_9', async () => {
              const inputData = _workflowState['node-kv-get-fast']?.output || event.payload;
              const response = await this.env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
                prompt: `You are writing the opening 25-40 second WOW script for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is ${JSON.stringify(_workflowState['node-entry'].output.firstName)}. Their business name is ${JSON.stringify(_workflowState['node-entry'].output.name)}. They just connected to a personalized demo call. Using this background on their business:

        ${JSON.stringify(_workflowResults.step_kv_get_8.value)}

        Write Bella's opening that: 1) Greets ${JSON.stringify(_workflowState['node-entry'].output.firstName)} warmly by first name and welcomes them to their personalized demo, 2) References one strong specific observation about their website — hero message, positioning, or value proposition, 3) Mentions their offer, CTA, ICP, or social proof with genuine appreciation, 4) Connects this intelligence to how the AI team has been pre-trained: 'This is exactly the kind of business intelligence we've already used to pre-train your AI team, so they feel like they've been inside [business] for years.'

        Rules: 3-5 sentences max. Use the business name naturally the way a human would say it in conversation — e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Never say 'your organization' or 'your firm'. Consultative, warm, confident — like a trusted strategic advisor who has done deep homework. No criticism, no implied gaps, no fixes — pure positive. Never say 'As an AI' or '100 data points'. Do NOT ask for numbers or mention ROI yet. Write as spoken dialogue only, no labels or stage directions.`, temperature: 0.7, max_tokens: 512
              });
              const result = {
                response: response,
                text: response.response || response.text || JSON.stringify(response),
                usage: response.usage || {}
              };
              _workflowState['node-ai-refine-wow'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-ai-refine-wow'] = _workflowState['node-ai-refine-wow'] || { output: _workflowResults.step_workers_ai_9 };
      console.log('type:WF_NODE_END:nodeId:node-ai-refine-wow:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-ai-refine-wow']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-ai-refine-wow:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_10 = await step.do('step_transform_10', async () => {
              const inputData = _workflowState['node-ai-refine-wow']?.output || event.payload;
              const result = await (async () => { const geminiKey = this.env.GEMINI_API_KEY;
        if (!geminiKey) { return { text: inputData.text || '', raw: inputData.text || '', gemini_status: 'no_key' }; }
        const rawSnippet = inputData.text || '';

        if (!rawSnippet || rawSnippet.length < 10) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'skipped_empty' }; }
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'You are Bella, a confident, warm female strategic advisor. Polish this script so every single word sounds like natural spoken conversation. Contractions always (it is → it\'s, we have → we\'ve, they are → they\'re). Natural rhythm and flow. Shorten any business name to how a human would actually say it aloud (KPMG Australia → KPMG, Smith & Sons Plumbing → Smith and Sons). Remove any stiff corporate language — no "your organization", "your firm", "leverage", "utilize". Keep the meaning and structure identical. Do not shorten or remove any sentences. Output ONLY the polished dialogue, nothing else:\n\n' + rawSnippet }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 2048 } }) });
        const geminiJson = await resp.json();
        const polished = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || rawSnippet;

        return { text: polished, raw: rawSnippet, gemini_status: resp.status }; })();
              _workflowState['node-gemini-polish'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-gemini-polish'] = _workflowState['node-gemini-polish'] || { output: _workflowResults.step_transform_10 };
      console.log('type:WF_NODE_END:nodeId:node-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-gemini-polish']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_11 = await step.do("step_kv_put_11", async () => {
          const inputData = _workflowState['node-gemini-polish']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:stage1_snippet`;
          const value = `${_workflowResults.step_transform_10.text}`;
          await this.env["WORKFLOWS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-kv-write-snippet'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-kv-write-snippet'] = _workflowState['node-kv-write-snippet'] || { output: _workflowResults.step_kv_put_11 };
      console.log('type:WF_NODE_END:nodeId:node-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-kv-write-snippet']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-collect-apify:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_12 = await step.do('step_transform_12', async () => {
              const inputData = _workflowState['node-kv-write-snippet']?.output || event.payload;
              const result = await (async () => { const runs = _workflowState['node-fire-apify']?.output || {};
        const apifyTk = this.env.APIFY_TOKEN || this.env.APIFY_API_KEY;
        const pollRun = async (key, runId) => {
          if (!runId) return { key, items: [], status: 'no_run' };
          try {
            for (let i = 0; i < 20; i++) {
              const statusResp = await fetch('https://api.apify.com/v2/actor-runs/' + runId + '?token=' + apifyTk);
              if (!statusResp.ok) return { key, items: [], status: 'api_error_' + statusResp.status };
              const statusJson = await statusResp.json();
              const dObj = Object.values(statusJson || {}).find(v => v && typeof v === 'object') || {};
              const runStatus = dObj.status || '';
              if (runStatus === 'SUCCEEDED') {
                const dsId = dObj.defaultDatasetId;
                if (!dsId) return { key, items: [], status: 'no_dataset' };
                const itemsResp = await fetch('https://api.apify.com/v2/datasets/' + dsId + '/items?token=' + apifyTk + '&limit=15');
                const items = await itemsResp.json();
                return { key, items: items || [], status: 'done' };
              }
              if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {
                return { key, items: [], status: runStatus.toLowerCase() };
              }
              await new Promise(resolve => setTimeout(resolve, 4000));
            }
            return { key, items: [], status: 'poll_timeout' };
          } catch (e) {
            return { key, items: [], status: 'error', error: e.message };
          }
        };
        const results = await Promise.all(
          Object.entries(runs).map(([key, run]) => pollRun(key, run?.runId))
        );
        const out = {};
        results.forEach(r => { out[r.key] = r.items; if (r.status !== 'done') out[r.key + '_status'] = r.status; });
        return out; })();
              _workflowState['node-collect-apify'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-collect-apify'] = _workflowState['node-collect-apify'] || { output: _workflowResults.step_transform_12 };
      console.log('type:WF_NODE_END:nodeId:node-collect-apify:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-collect-apify']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-collect-apify:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-extract-deep:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_13 = await step.do('step_transform_13', async () => {
              const inputData = _workflowState['node-collect-apify']?.output || event.payload;
              const result = await (async () => { const scrape = _workflowState['node-collect-apify']?.output || {};
        const place = (Array.isArray(scrape.google_maps) ? scrape.google_maps[0] : scrape.google_maps) || {};
        const reviews = (place.reviews || []).slice(0, 5).map(r => ({ text: (r?.text || '').slice(0, 200), stars: r?.stars, name: r?.name }));
        const fbAds = Array.isArray(scrape.facebook_ads) ? scrape.facebook_ads : [];
        const googleAds = Array.isArray(scrape.google_ads) ? scrape.google_ads : [];
        const indeedJobs = Array.isArray(scrape.indeed) ? scrape.indeed : [];
        const linkedinInfo = (Array.isArray(scrape.linkedin) ? scrape.linkedin[0] : scrape.linkedin) || {};
        return { google_rating: place.totalScore || place.rating || null, review_count: place.reviewsCount || 0, address: place.address || null, categories: place.categories || [], reviews_sample: reviews, is_running_fb_ads: fbAds.length > 0, fb_ads_count: fbAds.length, fb_ads_sample: fbAds.slice(0, 3).map(a => ({ text: ((a?.bodyText || a?.caption) || '').slice(0, 200), cta: a?.callToActionType || '' })), is_running_google_ads: googleAds.length > 0, google_ads_count: googleAds.length, is_hiring: indeedJobs.length > 0, job_count: indeedJobs.length, jobs_sample: indeedJobs.slice(0, 3).map(j => ({ title: j?.title || j?.positionName || '', salary: j?.salary || '' })), linkedin_employees: linkedinInfo?.employeeCount || linkedinInfo?.staffCount || null, linkedin_industry: linkedinInfo?.industryName || linkedinInfo?.industry || null, linkedin_description: (linkedinInfo?.description || '').slice(0, 300), raw_json: JSON.stringify({ google_maps: place, fb_ads_count: fbAds.length, google_ads_count: googleAds.length, indeed_count: indeedJobs.length, linkedin: linkedinInfo }) }; })();
              _workflowState['node-extract-deep'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-extract-deep'] = _workflowState['node-extract-deep'] || { output: _workflowResults.step_transform_13 };
      console.log('type:WF_NODE_END:nodeId:node-extract-deep:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-extract-deep']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-extract-deep:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-enrich-extract:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_14 = await step.do('step_transform_14', async () => {
              const inputData = _workflowState['node-extract-deep']?.output || event.payload;
              const result = await (async () => { const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';
        const extracted = inputData || {};
        if (!enableDeep) { return extracted; }
        const raw = _workflowState['node-collect-apify']?.output || {};
        const fbAds = Array.isArray(raw.facebook_ads) ? raw.facebook_ads : [];
        const googleAds = Array.isArray(raw.google_ads) ? raw.google_ads : [];
        const indeedJobs = Array.isArray(raw.indeed) ? raw.indeed : [];
        const place = (Array.isArray(raw.google_maps) ? raw.google_maps[0] : raw.google_maps) || {};
        const allReviews = place.reviews || [];
        const li = (Array.isArray(raw.linkedin) ? raw.linkedin[0] : raw.linkedin) || {};
        const offerRx = /(?:free|complimentary|\d+%\s*off|\$\d+|\bsale\b|\bdiscount\b|no\s*obligation|limited\s*time|special\s*offer|quote|consultation|audit|assessment)/i;
        const ad_campaigns = fbAds.slice(0, 5).map(a => { const body = a?.bodyText || a?.caption || ''; const headline = a?.title || ''; const combined = headline + ' ' + body; const offerMatch = combined.match(offerRx); return { platform: 'facebook', headline: headline.slice(0, 200), body: body.slice(0, 500), offer: offerMatch ? offerMatch[0] : null, cta: (a?.callToActionType || '').replace(/_/g, ' ').toLowerCase(), landing_url: a?.linkUrl || '' }; });
        const gAds = googleAds.slice(0, 5).map(a => ({ platform: 'google', headline: (a?.title || '').slice(0, 200), body: (a?.description || '').slice(0, 300), offer: ((a?.title || '') + ' ' + (a?.description || '')).match(offerRx)?.[0] || null, cta: '', landing_url: a?.displayedUrl || a?.url || '' }));
        const allAds = [...ad_campaigns, ...gAds];
        const ad_offers = [...new Set(allAds.filter(a => a.offer).map(a => a.offer))];
        const ad_ctas = [...new Set(allAds.map(a => a.cta).filter(Boolean))];
        const landing_urls = [...new Set(allAds.map(a => a.landing_url).filter(u => u && u.startsWith('http')))].slice(0, 3);
        const catMap = { receptionist: 'call_handling', 'front desk': 'call_handling', admin: 'call_handling', 'customer service': 'call_handling', sales: 'sales', 'business dev': 'sales', account: 'sales', marketing: 'marketing', digital: 'marketing', seo: 'marketing', social: 'marketing', developer: 'technical', engineer: 'technical' };
        const catRole = t => { const l = (t || '').toLowerCase(); for (const [k, v] of Object.entries(catMap)) { if (l.includes(k)) return v; } return 'other'; };
        const job_roles = indeedJobs.slice(0, 5).map(j => ({ title: j?.title || j?.positionName || '', company: j?.company || '', location: j?.location || '', description: (j?.description || j?.snippet || '').slice(0, 500), salary: j?.salary || '', type: j?.jobType || j?.type || '', category: catRole(j?.title || j?.positionName || '') }));
        const hiring_categories = [...new Set(job_roles.map(j => j.category))];
        const themeMap = { service_quality: ['excellent','outstanding','professional','thorough','knowledgeable','expert','amazing','fantastic','wonderful'], speed: ['fast','quick','prompt','efficient','timely','responsive','immediate'], value: ['value','worth','affordable','reasonable','fair price','competitive'], staff_friendly: ['friendly','welcoming','warm','helpful','kind','patient','caring','lovely','pleasant'], reliability: ['reliable','consistent','dependable','trustworthy'] };
        const classifyThemes = text => { const l = (text || '').toLowerCase(); return Object.entries(themeMap).filter(([, kws]) => kws.some(k => l.includes(k))).map(([t]) => t); };
        const reviews_detailed = allReviews.slice(0, 8).map(r => { const txt = (r?.text || '').slice(0, 500); const th = classifyThemes(txt); return { text: txt, stars: r?.stars || 0, author: r?.name || '', date: r?.publishedAtDate || '', themes: th, sentiment: (r?.stars || 0) >= 4 ? 'positive' : (r?.stars || 0) <= 2 ? 'negative' : 'neutral', owner_replied: !!(r?.responseFromOwnerText) }; });
        const theme_summary = {};
        reviews_detailed.forEach(r => r.themes.forEach(t => { theme_summary[t] = (theme_summary[t] || 0) + 1; }));
        const top_review_themes = Object.entries(theme_summary).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
        const linkedin_detail = { employees: li?.employeeCount || li?.staffCount || null, industry: li?.industryName || li?.industry || null, description: (li?.description || '').slice(0, 500), specialties: li?.specialities || li?.specialties || [], founded: li?.foundedOn || li?.founded || null };
        return { ...extracted, enriched: true, ad_campaigns: allAds, ad_offers, ad_ctas, landing_urls, job_roles, hiring_categories, reviews_detailed, review_theme_summary: theme_summary, top_review_themes, linkedin_detail }; })();
              _workflowState['node-enrich-extract'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-enrich-extract'] = _workflowState['node-enrich-extract'] || { output: _workflowResults.step_transform_14 };
      console.log('type:WF_NODE_END:nodeId:node-enrich-extract:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-enrich-extract']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-enrich-extract:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-crawl-landings:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_15 = await step.do('step_transform_15', async () => {
              const inputData = _workflowState['node-enrich-extract']?.output || event.payload;
              const result = await (async () => { const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';
        if (!enableDeep) { return inputData || {}; }
        const urls = inputData?.landing_urls || [];
        if (urls.length === 0) { return { ...inputData, conversion_events: [], crawl_status: 'skipped_no_urls', urls_crawled: 0 }; }
        const ctaRx = /(?:book|call|quote|free|consult|demo|trial|start|get\s*started|sign\s*up|contact|schedule|request|enquir|apply|download)/i;
        const crawlOne = async (url) => { try { const ctrl = new AbortController(); const tid = setTimeout(() => ctrl.abort(), 10000); const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BellaBot/1.0)' }, redirect: 'follow' }); clearTimeout(tid); if (!resp.ok) return null; const html = (await resp.text()).slice(0, 50000); const forms = (html.match(/<form[^>]*>[\s\S]*?<\/form>/gi) || []).map(f => { const fields = (f.match(/name\s*=\s*["']([^"']+)/gi) || []).map(m => m.replace(/name\s*=\s*["']/i, '')); const hasContact = fields.some(fl => /email|phone|name|message/i.test(fl)); return hasContact ? 'contact form (' + fields.filter(fl => /email|phone|name|message/i.test(fl)).join(', ') + ')' : 'form (' + fields.slice(0, 3).join(', ') + ')'; }).slice(0, 3); const buttons = (html.match(/<(?:button|inputData[^>]*type\s*=\s*["']submit["'])[^>]*>([^<]*)/gi) || []).map(b => b.replace(/<[^>]+>/g, '').trim()).filter(b => b.length > 1 && b.length < 50).slice(0, 5); const links = (html.match(/<a[^>]*>([^<]{2,40})<\/a>/gi) || []).map(l => l.replace(/<[^>]+>/g, '').trim()).filter(l => ctaRx.test(l)).slice(0, 5); const has_phone = /href\s*=\s*["']tel:/i.test(html); const has_chat = /livechat|intercom|drift|tawk|zendesk|hubspot|crisp|olark/i.test(html); return { url, forms, cta_buttons: buttons, cta_links: links, has_phone, has_chat }; } catch (e) { return null; } };
        const results = (await Promise.all(urls.map(crawlOne))).filter(Boolean);
        return { ...inputData, conversion_events: results, crawl_status: results.length === urls.length ? 'done' : 'partial', urls_crawled: results.length }; })();
              _workflowState['node-crawl-landings'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-crawl-landings'] = _workflowState['node-crawl-landings'] || { output: _workflowResults.step_transform_15 };
      console.log('type:WF_NODE_END:nodeId:node-crawl-landings:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-crawl-landings']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-crawl-landings:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-classify-deep-ai:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_16 = await step.do('step_transform_16', async () => {
              const inputData = _workflowState['node-crawl-landings']?.output || event.payload;
              const result = await (async () => { const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';
        if (!enableDeep) { return inputData || {}; }
        const reviews = inputData?.reviews_detailed || [];
        const jobs = inputData?.job_roles || [];
        if (reviews.length === 0 && jobs.length === 0) { return { ...inputData, review_analysis: null, job_analysis: null, business_maturity: null, ai_status: 'skipped_no_data' }; }
        const reviewSnippets = reviews.slice(0, 5).map(r => r.text.slice(0, 150) + ' [' + r.stars + ' stars]').join('\n');
        const jobSnippets = jobs.slice(0, 5).map(j => j.title + (j.description ? ': ' + j.description.slice(0, 100) : '') + (j.salary ? ' (' + j.salary + ')' : '')).join('\n');
        const prompt = 'Analyze this business intelligence. Output JSON ONLY, no markdown, no explanation.\n\nREVIEWS:\n' + (reviewSnippets || 'None') + '\n\nJOB LISTINGS:\n' + (jobSnippets || 'None') + '\n\nOutput this exact JSON structure:\n{"review_analysis":{"dominant_theme":"string","secondary_theme":"string","sentiment_summary":"string","notable_quote":"best review snippet"},"job_analysis":{"primary_category":"string","demand_signal":"string","key_requirements":["string"],"is_growth_hiring":true},"business_maturity":"string"}';
        try {
          const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', { prompt: prompt, temperature: 0.3, max_tokens: 512 });
          const text = result?.response || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
          return { ...inputData, review_analysis: parsed.review_analysis || null, job_analysis: parsed.job_analysis || null, business_maturity: parsed.business_maturity || null, ai_status: 'success' };
        } catch (e) {
          return { ...inputData, review_analysis: null, job_analysis: null, business_maturity: null, ai_status: 'failed', ai_error: (e?.message || 'unknown') };
        } })();
              _workflowState['node-classify-deep-ai'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-classify-deep-ai'] = _workflowState['node-classify-deep-ai'] || { output: _workflowResults.step_transform_16 };
      console.log('type:WF_NODE_END:nodeId:node-classify-deep-ai:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-classify-deep-ai']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-classify-deep-ai:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-supergod-merge:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_17 = await step.do('step_transform_17', async () => {
              const inputData = _workflowState['node-classify-deep-ai']?.output || event.payload;
              const result = await (async () => { const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';
        if (!enableDeep) { return inputData || {}; }
        const enrich = _workflowState['node-enrich-extract']?.output || {};
        const crawl = _workflowState['node-crawl-landings']?.output || {};
        const classify = _workflowState['node-classify-deep-ai']?.output || {};
        const base = _workflowState['node-extract-deep']?.output || {};
        let jobRoles = enrich.job_roles || [];
        if (jobRoles.length > 20) { const clientFacing = ['call_handling', 'sales', 'marketing']; const filtered = jobRoles.filter(j => clientFacing.includes(j.category)).slice(0, 5); jobRoles = filtered.length > 0 ? filtered : jobRoles.slice(0, 5); }
        const merged = { ...base, enriched: true, ad_campaigns: enrich.ad_campaigns || [], ad_offers: enrich.ad_offers || [], ad_ctas: enrich.ad_ctas || [], conversion_events: crawl.conversion_events || [], job_roles: jobRoles, hiring_categories: enrich.hiring_categories || [], reviews_detailed: enrich.reviews_detailed || [], review_theme_summary: enrich.review_theme_summary || {}, top_review_themes: enrich.top_review_themes || [], review_analysis: classify.review_analysis || null, job_analysis: classify.job_analysis || null, business_maturity: classify.business_maturity || null, linkedin_detail: enrich.linkedin_detail || {}, crawl_status: crawl.crawl_status || 'none', ai_status: classify.ai_status || 'none' };
        const baseJson = JSON.parse(base.raw_json || '{}');
        const forKv = { ...baseJson };
        ['enriched','ad_campaigns','ad_offers','ad_ctas','conversion_events','job_roles','hiring_categories','reviews_detailed','review_theme_summary','top_review_themes','review_analysis','job_analysis','business_maturity','linkedin_detail','crawl_status','ai_status'].forEach(k => { if (merged[k] !== undefined) forKv[k] = merged[k]; });
        merged.raw_json = JSON.stringify(forKv);
        return merged; })();
              _workflowState['node-supergod-merge'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-supergod-merge'] = _workflowState['node-supergod-merge'] || { output: _workflowResults.step_transform_17 };
      console.log('type:WF_NODE_END:nodeId:node-supergod-merge:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-supergod-merge']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-supergod-merge:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-deep-quality-gate:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_18 = await step.do('step_transform_18', async () => {
              const inputData = _workflowState['node-supergod-merge']?.output || event.payload;
              const result = await (async () => { const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';
        if (!enableDeep) { return inputData || {}; }
        const d = inputData || {};
        const fields = { ad_campaigns: (d.ad_campaigns?.length || 0) > 0, ad_offers: (d.ad_offers?.length || 0) > 0, conversion_events: (d.conversion_events?.length || 0) > 0, job_roles: (d.job_roles?.length || 0) > 0, reviews_detailed: (d.reviews_detailed?.length || 0) > 0, review_analysis: !!d.review_analysis, job_analysis: !!d.job_analysis, linkedin_detail: !!(d.linkedin_detail?.employees || d.linkedin_detail?.founded) };
        const populated = Object.values(fields).filter(Boolean).length;
        const total = Object.keys(fields).length;
        const score = Math.round((populated / total) * 100) / 100;
        const missing = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);
        console.log('[SUPERGOD] score=' + score + ' ads=' + (d.ad_campaigns?.length || 0) + ' jobs=' + (d.job_roles?.length || 0) + ' reviews=' + (d.reviews_detailed?.length || 0) + ' landings=' + (d.conversion_events?.length || 0) + ' ai=' + (d.ai_status || 'none'));
        if (d.enriched !== true) { console.log('[SUPERGOD] FALLBACK - enriched flag missing'); const shallow = _workflowState['node-extract-deep']?.output || {}; return { ...shallow, supergod_quality: { score: 0, status: 'fallback', reason: 'enriched_flag_missing' } }; }
        return { ...d, supergod_quality: { score, fields_populated: populated, total_fields: total, missing_fields: missing } }; })();
              _workflowState['node-deep-quality-gate'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-deep-quality-gate'] = _workflowState['node-deep-quality-gate'] || { output: _workflowResults.step_transform_18 };
      console.log('type:WF_NODE_END:nodeId:node-deep-quality-gate:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-deep-quality-gate']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-deep-quality-gate:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-kv-deep-flags:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_19 = await step.do("step_kv_put_19", async () => {
          const inputData = _workflowState['node-deep-quality-gate']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:deep_flags`;
          const value = `${_workflowResults.step_transform_18.raw_json}`;
          await this.env["WORKFLOWS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-kv-deep-flags'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-kv-deep-flags'] = _workflowState['node-kv-deep-flags'] || { output: _workflowResults.step_kv_put_19 };
      console.log('type:WF_NODE_END:nodeId:node-kv-deep-flags:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-kv-deep-flags']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-kv-deep-flags:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_get_20 = await step.do("step_kv_get_20", async () => {
          const inputData = _workflowState['node-kv-deep-flags']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:deep_flags`;
          const value = await this.env["WORKFLOWS_KV"].get(key, { type: "json" });
          const result = {
            value,
            exists: value !== null,
            metadata: value ? { key } : null
          };

          _workflowState['node-kv-get-deep'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-kv-get-deep'] = _workflowState['node-kv-get-deep'] || { output: _workflowResults.step_kv_get_20 };
      console.log('type:WF_NODE_END:nodeId:node-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-kv-get-deep']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-consultant-ai-v2:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_workers_ai_21 = await step.do('step_workers_ai_21', async () => {
              const inputData = _workflowState['node-kv-get-deep']?.output || event.payload;
              const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
                prompt: `The business name is ${JSON.stringify(_workflowState['node-entry'].output.name)}. Using this deep intelligence about the prospect's business (Google Maps reviews, ads activity, hiring signals, LinkedIn profile):

        ${JSON.stringify(_workflowResults.step_kv_get_20.value)}

        Output one polished paragraph of flattery and insight. Reference their Google rating, reviews, ad campaigns, hiring growth, or LinkedIn presence where available. Focus on their reputation, market activity, and growth trajectory. Always use the business name naturally the way a human would say it in conversation — e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no negativity. Pure positive positioning. One paragraph only, written as natural speech.`, temperature: 0.7
              });
              const result = {
                response: response,
                text: response.response || response.text || JSON.stringify(response),
                usage: response.usage || {}
              };
              _workflowState['node-consultant-ai-v2'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-consultant-ai-v2'] = _workflowState['node-consultant-ai-v2'] || { output: _workflowResults.step_workers_ai_21 };
      console.log('type:WF_NODE_END:nodeId:node-consultant-ai-v2:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-consultant-ai-v2']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-consultant-ai-v2:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-build-intel-json:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_transform_22 = await step.do('step_transform_22', async () => {
          const inputData = _workflowState['node-consultant-ai-v2']?.output || event.payload;
          const result = await (async () => { const summary = inputData.text || ''; const deepVal = _workflowResults.step_kv_get_20.value || {}; return { json: JSON.stringify({ summary, deep_data: deepVal }) }; })();
          _workflowState['node-build-intel-json'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-build-intel-json'] = _workflowState['node-build-intel-json'] || { output: _workflowResults.step_transform_22 };
      console.log('type:WF_NODE_END:nodeId:node-build-intel-json:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-build-intel-json']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-build-intel-json:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-kv-write-intel:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_23 = await step.do("step_kv_put_23", async () => {
          const inputData = _workflowState['node-build-intel-json']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:intel`;
          const value = `${_workflowResults.step_transform_22.json}`;
          await this.env["WORKFLOWS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-kv-write-intel'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-kv-write-intel'] = _workflowState['node-kv-write-intel'] || { output: _workflowResults.step_kv_put_23 };
      console.log('type:WF_NODE_END:nodeId:node-kv-write-intel:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-kv-write-intel']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-kv-write-intel:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-wait-deep-ready:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        try {
          const _waitEvent = await step.waitForEvent('step_wait_event_24', { type: 'deep-ready', timeout: '3 minutes' });
          _workflowResults.step_wait_event_24 = { event: _waitEvent, timedOut: false };
        } catch (e) {
          if ('continue' === 'continue') {
            _workflowResults.step_wait_event_24 = { event: null, timedOut: true };
          } else {
            throw e;
          }
        }
      _workflowState['node-s2-wait-deep-ready'] = _workflowState['node-s2-wait-deep-ready'] || { output: _workflowResults.step_wait_event_24 };
      console.log('type:WF_NODE_END:nodeId:node-s2-wait-deep-ready:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-wait-deep-ready']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-wait-deep-ready:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_get_25 = await step.do("step_kv_get_25", async () => {
          const inputData = _workflowState['node-s2-wait-deep-ready']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:deep_flags`;
          const value = await this.env["WORKFLOWS_KV"].get(key, { type: "json" });
          const result = {
            value,
            exists: value !== null,
            metadata: value ? { key } : null
          };

          _workflowState['node-s2-kv-get-deep'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s2-kv-get-deep'] = _workflowState['node-s2-kv-get-deep'] || { output: _workflowResults.step_kv_get_25 };
      console.log('type:WF_NODE_END:nodeId:node-s2-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-kv-get-deep']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-ai-flattery:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_workers_ai_26 = await step.do('step_workers_ai_26', async () => {
              const inputData = _workflowState['node-s2-kv-get-deep']?.output || event.payload;
              const response = await this.env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
                prompt: `You are writing a findings paragraph for Bella, Strategic Intel Director at Pillar and Post. The prospect's business name is ${JSON.stringify(_workflowState['node-entry'].output.name)}.

        Using this deep intelligence data about the prospect's business:

        ${JSON.stringify(_workflowResults.step_kv_get_25.value)}

        Write one polished paragraph (4-6 sentences) of genuine flattery and market insight based ONLY on the data provided. Lead with 'a few things stood out straight away' from the data. Reference these signals where available:
        - Google Maps rating and review volume (e.g. 'Your 4.8 rating from over 200 reviews shows your reputation is a real strength'). When quoting or referencing a specific review snippet, ALWAYS include the reviewer\\'s FULL NAME (first and last) from the data (e.g., 'one reviewer, Michael Thompson, said [snippet]'). Never quote a review anonymously or with first name only.
        - Facebook/Google ad activity (e.g. 'I see you're running targeted ads on Facebook and Google, which tells me you're serious about growth')
        - LinkedIn profile and employee count (e.g. 'With a team of 50 on LinkedIn, it's clear you're scaling operations effectively')
        - Hiring signals from Indeed (e.g. 'The active job postings on Indeed suggest demand is surging ahead of capacity')

        SUPERGOD specifics — when these fields exist in the data, use them for MAXIMUM personalization:
        - If ad_campaigns with offers exist: name the SPECIFIC offer and CTA (e.g., 'your "Free Audit" campaign on Facebook with a "Book Now" call-to-action tells me you know how to drive targeted leads')
        - If job_roles exist: name the SPECIFIC role, department, and requirements (e.g., 'hiring for a Senior Accountant with CPA qualifications in tax advisory tells me client demand is surging ahead of capacity')
        - If review_analysis.dominant_theme exists: reference it (e.g., 'reviewers keep highlighting your responsiveness and personal attention — that reputation is gold')
        - If review_analysis.notable_quote exists: weave it in naturally and ALWAYS attribute by FULL NAME — first and last (e.g., 'one of your recent reviewers, Sarah Mitchell, said [quote] — that says everything'). The reviewer full name is in reviews_detailed[].author — never quote a review without the full name.
        - If linkedin_detail.founded exists: reference longevity (e.g., 'established since 2005 with a team of 50 specialising in tax advisory — that stability speaks volumes')
        - If conversion_events show forms/CTAs: reference them (e.g., 'your "Get Your Free Quote" landing page shows you understand conversion')
        - If reviews_detailed show owner_replied=true: mention engagement (e.g., 'I noticed you actively respond to reviews, which shows you genuinely care')
        Fall back to generic signals gracefully if these fields are missing.

        Industry mirroring — match the language to their sector (e.g., legal: clients/matters; medical: patients/appointments; trades: jobs/callouts; finance: policyholders/quotes).

        Naming rules: Use the full business name '${JSON.stringify(_workflowState['node-entry'].output.name)}' exactly on first reference. Shorten only if natural and accurate for subsequent mentions (e.g., 'McDonald Brothers' first, then 'McDonald\\'s' if common; never possessives like 'McDonald\\'s' unless original; avoid errors like 'Pitcher\\'s' for 'Pitcher Partners'—use 'Pitcher Partners' or 'Pitcher' if conversational).

        Rules: Pure positive — highlight strengths only, no criticism/gaps/fixes. End by connecting to pre-training: 'This is exactly the kind of business intelligence we\\'ve already used to pre-train your AI team, so they feel like they\\'ve been inside [business_name] for years.' No 'As an AI'. Write as natural spoken dialogue only.`, temperature: 0.7, max_tokens: 512
              });
              const result = {
                response: response,
                text: response.response || response.text || JSON.stringify(response),
                usage: response.usage || {}
              };
              _workflowState['node-s2-ai-flattery'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s2-ai-flattery'] = _workflowState['node-s2-ai-flattery'] || { output: _workflowResults.step_workers_ai_26 };
      console.log('type:WF_NODE_END:nodeId:node-s2-ai-flattery:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-ai-flattery']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-ai-flattery:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-ai-clarify:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_workers_ai_27 = await step.do('step_workers_ai_27', async () => {
              const inputData = _workflowState['node-s2-ai-flattery']?.output || event.payload;
              const response = await this.env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
                prompt: `You are generating targeted clarification questions for Bella, Strategic Intel Director at Pillar and Post. The prospect's business name is ${JSON.stringify(_workflowState['node-entry'].output.name)} and their first name is ${JSON.stringify(_workflowState['node-entry'].output.firstName)}.

        Here is the deep intelligence data:
        ${JSON.stringify(_workflowResults.step_kv_get_25.value)}

        And here are the flattery findings:
        ${JSON.stringify(_workflowResults.step_workers_ai_26.text)}

        Based on the data, determine which channels are triggered:
        1. WEBSITE — always triggered
        2. PHONE — if the business has a visible phone number, Google listing, or contact page
        3. ADS — if facebook_ads count > 0 OR google_ads count > 0 (HIGHEST PRIORITY)
        4. OLD LEADS — if the business appears established (3+ years based on review history or LinkedIn)
        5. REVIEWS — if Google Maps reviews exist with a rating

        Generate exactly 2-3 targeted questions that:
        - Ask about their CURRENT situation for the triggered channels
        - Mirror their industry language (legal=clients/matters, medical=patients/appointments, trades=jobs/callouts, etc.)
        - Are designed to uncover pain points without being negative
        - Reference specific data points from the intelligence where possible

        SUPERGOD specifics — when granular data exists, make questions hyper-targeted:
        - If ad_campaigns with specific offers exist: ask about THAT offer\\'s performance (e.g., 'I see you\\'re running a "Free Audit" campaign on Facebook — how many leads is that generating each week?')
        - If ad_ctas include 'book now' or 'call now': ask about conversion from those CTAs specifically
        - If job_roles with specific titles exist: reference the SPECIFIC role (e.g., 'I noticed you\\'re hiring for a Senior Accountant — is that because client demand is growing faster than your team can handle?')
        - If job_analysis.demand_signal exists: reference it
        - If top_review_themes show specific strengths: reference them with reviewer FULL NAMES (first and last) where available (e.g., 'Reviewers like Sarah Mitchell and Michael Chen keep mentioning how responsive your team is — are you finding it harder to maintain that as you grow?')
        - If conversion_events show multiple forms/CTAs: ask about which converts best
        Fall back to generic channel questions if granular fields are missing.

        Format: Output ONLY the questions as natural spoken dialogue, numbered 1-3. Each question should be 1-2 sentences. No preamble, no labels, no stage directions.`, temperature: 0.7, max_tokens: 512
              });
              const result = {
                response: response,
                text: response.response || response.text || JSON.stringify(response),
                usage: response.usage || {}
              };
              _workflowState['node-s2-ai-clarify'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s2-ai-clarify'] = _workflowState['node-s2-ai-clarify'] || { output: _workflowResults.step_workers_ai_27 };
      console.log('type:WF_NODE_END:nodeId:node-s2-ai-clarify:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-ai-clarify']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-ai-clarify:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-build-payload:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_28 = await step.do('step_transform_28', async () => {
              const inputData = _workflowState['node-s2-ai-clarify']?.output || event.payload;
              const result = await (async () => { const flattery = _workflowState['node-s2-ai-flattery']?.output?.text || '';
        const questions = _workflowState['node-s2-ai-clarify']?.output?.text || '';
        const deepData = _workflowState['node-s2-kv-get-deep']?.output?.value || {};
        const channelsTriggered = ['website'];
        if (deepData.google_maps && (deepData.google_maps.totalScore || deepData.google_maps.reviewsCount)) channelsTriggered.push('reviews');
        if ((deepData.fb_ads_count || 0) > 0 || (deepData.google_ads_count || 0) > 0) channelsTriggered.push('ads');
        if (deepData.linkedin && (deepData.linkedin.employeeCount || 0) > 10) channelsTriggered.push('old_leads');
        channelsTriggered.push('phone');
        const intelPayload = JSON.stringify({ stage2_flattery: flattery, stage2_questions: questions, channels_triggered: channelsTriggered, deep_data: deepData });
        const convMemoryPayload = JSON.stringify({ stage2_findings: flattery, stage2_clarify_questions: questions, channels: channelsTriggered });
        return { intel_json: intelPayload, conv_memory_json: convMemoryPayload, combined_snippet: flattery + '\n\n' + questions }; })();
              _workflowState['node-s2-build-payload'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s2-build-payload'] = _workflowState['node-s2-build-payload'] || { output: _workflowResults.step_transform_28 };
      console.log('type:WF_NODE_END:nodeId:node-s2-build-payload:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-build-payload']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-build-payload:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-kv-write-stage2:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_29 = await step.do('step_transform_29', async () => {
              const inputData = _workflowState['node-s2-build-payload']?.output || event.payload;
              const result = await (async () => { const lid = _workflowState['node-entry']?.output?.lid || '';
        const payload = _workflowState['node-s2-build-payload']?.output || {};
        await this.env.WORKFLOWS_KV.put('lead:' + lid + ':intel', payload.intel_json, { expirationTtl: 3600 });
        await this.env.WORKFLOWS_KV.put('lead:' + lid + ':conv_memory', payload.conv_memory_json, { expirationTtl: 3600 });
        return { success: true, keys_written: ['intel', 'conv_memory'] }; })();
              _workflowState['node-s2-kv-write-stage2'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s2-kv-write-stage2'] = _workflowState['node-s2-kv-write-stage2'] || { output: _workflowResults.step_transform_29 };
      console.log('type:WF_NODE_END:nodeId:node-s2-kv-write-stage2:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-kv-write-stage2']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-kv-write-stage2:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_30 = await step.do('step_transform_30', async () => {
              const inputData = _workflowState['node-s2-kv-write-stage2']?.output || event.payload;
              const result = await (async () => { const geminiKey = this.env.GEMINI_API_KEY;
        const rawSnippet = _workflowState['node-s2-build-payload']?.output?.combined_snippet || '';
        if (!geminiKey) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'no_key' }; }
        if (!rawSnippet || rawSnippet.length < 10) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'skipped_empty' }; }
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'You are Bella, a confident, warm female strategic advisor. This is a findings and questions script for a prospect call. Polish it so every word sounds like natural spoken conversation. Contractions always. Natural rhythm and flow. Shorten any business name to how a human would say it aloud only if accurate and natural—verify and correct any errors (e.g., fix \'Pitcher\'s\' to \'Pitcher Partners\' or \'Pitcher\' if appropriate). Ensure facts from the inputData are accurate—no inaccuracies. The findings paragraph should flow directly into the questions — no awkward transitions. Keep meaning and structure identical. Do not remove any sentences. Output ONLY the polished dialogue:\n\n' + rawSnippet }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 4096 } }) });
        const geminiJson = await resp.json();
        const polished = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || rawSnippet;
        return { text: polished, raw: rawSnippet, gemini_status: resp.status }; })();
              _workflowState['node-s2-gemini-polish'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s2-gemini-polish'] = _workflowState['node-s2-gemini-polish'] || { output: _workflowResults.step_transform_30 };
      console.log('type:WF_NODE_END:nodeId:node-s2-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-gemini-polish']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s2-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_31 = await step.do("step_kv_put_31", async () => {
          const inputData = _workflowState['node-s2-gemini-polish']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:stage2_snippet`;
          const value = `${_workflowResults.step_transform_30.text}`;
          await this.env["WORKFLOWS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-s2-kv-write-snippet'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s2-kv-write-snippet'] = _workflowState['node-s2-kv-write-snippet'] || { output: _workflowResults.step_kv_put_31 };
      console.log('type:WF_NODE_END:nodeId:node-s2-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s2-kv-write-snippet']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s2-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-signal-update-kv:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_32 = await step.do('step_transform_32', async () => {
              const inputData = _workflowState['node-s2-kv-write-snippet']?.output || event.payload;
              const result = await (async () => { const lid = _workflowState['node-entry']?.output?.lid || '';
        await this.env.WORKFLOWS_KV.put('lead:' + lid + ':stage2_ready', JSON.stringify({ ready: true, ts: Date.now() }), { expirationTtl: 3600 });
        return { signal: 'stage-ready', status: 'stage2-complete', lid: lid }; })();
              _workflowState['node-signal-update-kv'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-signal-update-kv'] = _workflowState['node-signal-update-kv'] || { output: _workflowResults.step_transform_32 };
      console.log('type:WF_NODE_END:nodeId:node-signal-update-kv:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-signal-update-kv']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-signal-update-kv:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-wait-numbers:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        try {
          const _waitEvent = await step.waitForEvent('step_wait_event_33', { type: 'numbers-captured', timeout: '5 minutes' });
          _workflowResults.step_wait_event_33 = { event: _waitEvent, timedOut: false };
        } catch (e) {
          if ('continue' === 'continue') {
            _workflowResults.step_wait_event_33 = { event: null, timedOut: true };
          } else {
            throw e;
          }
        }
      _workflowState['node-s3-wait-numbers'] = _workflowState['node-s3-wait-numbers'] || { output: _workflowResults.step_wait_event_33 };
      console.log('type:WF_NODE_END:nodeId:node-s3-wait-numbers:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-wait-numbers']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-wait-numbers:nodeName:'+"wait-event"+':nodeType:'+'wait-event'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-kv-get-captured:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_get_34 = await step.do("step_kv_get_34", async () => {
          const inputData = _workflowState['node-s3-wait-numbers']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:captured_inputs`;
          const value = await this.env["LEADS_KV"].get(key, { type: "json" });
          const result = {
            value,
            exists: value !== null,
            metadata: value ? { key } : null
          };

          _workflowState['node-s3-kv-get-captured'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s3-kv-get-captured'] = _workflowState['node-s3-kv-get-captured'] || { output: _workflowResults.step_kv_get_34 };
      console.log('type:WF_NODE_END:nodeId:node-s3-kv-get-captured:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-kv-get-captured']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-kv-get-captured:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_get_35 = await step.do("step_kv_get_35", async () => {
          const inputData = _workflowState['node-s3-kv-get-captured']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:deep_flags`;
          const value = await this.env["LEADS_KV"].get(key, { type: "json" });
          const result = {
            value,
            exists: value !== null,
            metadata: value ? { key } : null
          };

          _workflowState['node-s3-kv-get-deep'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s3-kv-get-deep'] = _workflowState['node-s3-kv-get-deep'] || { output: _workflowResults.step_kv_get_35 };
      console.log('type:WF_NODE_END:nodeId:node-s3-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-kv-get-deep']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-kv-get-deep:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-kv-get-conv:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_get_36 = await step.do("step_kv_get_36", async () => {
          const inputData = _workflowState['node-s3-kv-get-deep']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:conv_memory`;
          const value = await this.env["LEADS_KV"].get(key, { type: "json" });
          const result = {
            value,
            exists: value !== null,
            metadata: value ? { key } : null
          };

          _workflowState['node-s3-kv-get-conv'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s3-kv-get-conv'] = _workflowState['node-s3-kv-get-conv'] || { output: _workflowResults.step_kv_get_36 };
      console.log('type:WF_NODE_END:nodeId:node-s3-kv-get-conv:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-kv-get-conv']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-kv-get-conv:nodeName:'+"kv-get"+':nodeType:'+'kv-get'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-calc-roi:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_37 = await step.do('step_transform_37', async () => {
              const inputData = _workflowState['node-s3-kv-get-conv']?.output || event.payload;
              const result = await (async () => { const captured = _workflowState['node-s3-kv-get-captured']?.output?.value || {};
        const deep = _workflowState['node-s3-kv-get-deep']?.output?.value || {};
        const rev = parseFloat(captured.monthly_revenue || captured.revenue || 0);
        const calls = parseInt(captured.monthly_calls || captured.calls_per_week * 4.3 || 0);
        const adSpend = parseFloat(captured.monthly_ad_spend || captured.ad_spend || 0);
        const missedPct = parseFloat(captured.missed_call_pct || 30) / 100;
        const closeRate = parseFloat(captured.close_rate || 25) / 100;
        const avgJobVal = rev > 0 && calls > 0 ? rev / (calls * closeRate || 1) : parseFloat(captured.avg_job_value || 500);
        const missedCalls = Math.round(calls * missedPct);
        const recoverableCalls = Math.round(missedCalls * 0.7);
        const recoveredRev = Math.round(recoverableCalls * closeRate * avgJobVal);
        const adWaste = adSpend > 0 ? Math.round(adSpend * missedPct) : 0;
        const speedToLeadLift = adSpend > 0 ? Math.round(adSpend * 0.15) : 0;
        const totalAnnualROI = (recoveredRev + adWaste + speedToLeadLift) * 12;
        const channels = deep.channels_triggered || [];
        const hasAds = channels.includes('ads') || (deep.fb_ads_count || 0) > 0 || (deep.google_ads_count || 0) > 0;
        const hasReviews = channels.includes('reviews') || (deep.review_count || 0) > 0;
        return { rev, calls, adSpend, missedCalls, recoverableCalls, recoveredRev, adWaste, speedToLeadLift, avgJobVal, totalAnnualROI, hasAds, hasReviews, channels, closeRate: Math.round(closeRate * 100), missedPct: Math.round(missedPct * 100) }; })();
              _workflowState['node-s3-calc-roi'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s3-calc-roi'] = _workflowState['node-s3-calc-roi'] || { output: _workflowResults.step_transform_37 };
      console.log('type:WF_NODE_END:nodeId:node-s3-calc-roi:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-calc-roi']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-calc-roi:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-ai-roi-narrative:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_workers_ai_38 = await step.do('step_workers_ai_38', async () => {
              const inputData = _workflowState['node-s3-calc-roi']?.output || event.payload;
              const response = await this.env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
                prompt: `You are writing the Stage 3 ROI presentation script for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is ${JSON.stringify(_workflowState['node-entry'].output.firstName)}. Their business is ${JSON.stringify(_workflowState['node-entry'].output.name)}.

        Here are the calculated ROI numbers:
        ${JSON.stringify(_workflowResults.step_transform_37)}

        And here is the deep intelligence:
        ${JSON.stringify(_workflowResults.step_kv_get_35.value)}

        Conversation context so far:
        ${JSON.stringify(_workflowResults.step_kv_get_36.value)}

        Write Bella's ROI presentation (30-45 seconds spoken). Structure:
        1) Transition: 'So based on what you've shared with me, ${JSON.stringify(_workflowState['node-entry'].output.firstName)}, let me show you exactly what we're looking at.'
        2) Mirror back THEIR numbers naturally — monthly calls, revenue, missed call percentage — so they feel heard.
        3) Present the recoverable revenue: missed calls x close rate x avg job value. Use their exact numbers. Say the dollar figure confidently.
        4) If they're running ads: mention the ad waste from missed calls on paid traffic. 'You're spending \$X on ads but missing Y% of those calls — that's \$Z going straight down the drain every month.'
        5) Total annual ROI figure — say it as a single powerful number.
        6) Close with: 'And that's a conservative estimate — we haven't even factored in speed-to-lead improvements or after-hours recovery.'

        Rules: Use ONLY the numbers from the ROI data — never invent figures. If a number is 0 or missing, skip that line gracefully. Use the business name naturally (shorten if conversational). Confident, warm, consultative tone. No 'As an AI'. Write as spoken dialogue only, no labels or stage directions. 4-6 sentences max.`, temperature: 0.6, max_tokens: 512
              });
              const result = {
                response: response,
                text: response.response || response.text || JSON.stringify(response),
                usage: response.usage || {}
              };
              _workflowState['node-s3-ai-roi-narrative'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s3-ai-roi-narrative'] = _workflowState['node-s3-ai-roi-narrative'] || { output: _workflowResults.step_workers_ai_38 };
      console.log('type:WF_NODE_END:nodeId:node-s3-ai-roi-narrative:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-ai-roi-narrative']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-ai-roi-narrative:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-ai-channel-recs:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_workers_ai_39 = await step.do('step_workers_ai_39', async () => {
              const inputData = _workflowState['node-s3-ai-roi-narrative']?.output || event.payload;
              const response = await this.env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
                prompt: `You are writing channel-specific AI team recommendations for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is ${JSON.stringify(_workflowState['node-entry'].output.firstName)}. Their business is ${JSON.stringify(_workflowState['node-entry'].output.name)}.

        ROI data:
        ${JSON.stringify(_workflowResults.step_transform_37)}

        Deep intelligence:
        ${JSON.stringify(_workflowResults.step_kv_get_35.value)}

        Based on the triggered channels and data, write 2-3 sentences that connect the ROI to SPECIFIC AI team members. Use this mapping:
        - PHONE/missed calls: 'Your AI receptionist catches every call — even at 2am on a Sunday'
        - ADS/ad spend: 'Your AI speed-to-lead agent responds to ad enquiries in under 60 seconds — before they click on a competitor'
        - REVIEWS: 'Your AI reputation manager follows up every job with a review request, building on that rating'
        - OLD LEADS/database: 'Your AI reactivation agent re-engages every dormant lead in your database with personalised outreach'
        - WEBSITE: 'Your AI webchat agent captures enquiries 24/7 and books them straight into your calendar'

        Only mention channels that have data. Mirror their industry language. Confident and specific. Write as natural spoken dialogue — no bullets, no labels. 2-3 sentences max.`, temperature: 0.6, max_tokens: 256
              });
              const result = {
                response: response,
                text: response.response || response.text || JSON.stringify(response),
                usage: response.usage || {}
              };
              _workflowState['node-s3-ai-channel-recs'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s3-ai-channel-recs'] = _workflowState['node-s3-ai-channel-recs'] || { output: _workflowResults.step_workers_ai_39 };
      console.log('type:WF_NODE_END:nodeId:node-s3-ai-channel-recs:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-ai-channel-recs']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-ai-channel-recs:nodeName:'+"workers-ai"+':nodeType:'+'workers-ai'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-build-payload:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_40 = await step.do('step_transform_40', async () => {
              const inputData = _workflowState['node-s3-ai-channel-recs']?.output || event.payload;
              const result = await (async () => { const roi = _workflowState['node-s3-calc-roi']?.output || {};
        const narrative = _workflowState['node-s3-ai-roi-narrative']?.output?.text || '';
        const recs = _workflowState['node-s3-ai-channel-recs']?.output?.text || '';
        const captured = _workflowState['node-s3-kv-get-captured']?.output?.value || {};
        const roiPayload = JSON.stringify({ roi_numbers: roi, captured_inputs: captured, narrative, channel_recs: recs });
        const combinedSnippet = narrative + '\n\n' + recs;
        return { roi_json: roiPayload, combined_snippet: combinedSnippet, narrative, recs }; })();
              _workflowState['node-s3-build-payload'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s3-build-payload'] = _workflowState['node-s3-build-payload'] || { output: _workflowResults.step_transform_40 };
      console.log('type:WF_NODE_END:nodeId:node-s3-build-payload:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-build-payload']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-build-payload:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-kv-write-roi:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_41 = await step.do("step_kv_put_41", async () => {
          const inputData = _workflowState['node-s3-build-payload']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:roi_data`;
          const value = `${_workflowResults.step_transform_40.roi_json}`;
          await this.env["LEADS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-s3-kv-write-roi'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s3-kv-write-roi'] = _workflowState['node-s3-kv-write-roi'] || { output: _workflowResults.step_kv_put_41 };
      console.log('type:WF_NODE_END:nodeId:node-s3-kv-write-roi:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-kv-write-roi']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-kv-write-roi:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
            _workflowResults.step_transform_42 = await step.do('step_transform_42', async () => {
              const inputData = _workflowState['node-s3-kv-write-roi']?.output || event.payload;
              const result = await (async () => { const geminiKey = this.env.GEMINI_API_KEY;
        const rawSnippet = _workflowState['node-s3-build-payload']?.output?.combined_snippet || '';
        if (!geminiKey) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'no_key' }; }
        if (!rawSnippet || rawSnippet.length < 10) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'skipped_empty' }; }
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'You are Bella, a confident, warm female strategic advisor presenting ROI numbers to a prospect. Polish this script so every word sounds like natural spoken conversation. Contractions always. The numbers must remain EXACTLY as written — do not round, change, or recalculate any figures. Natural rhythm — pause-worthy moments before big numbers. Shorten business names to how a human would say them aloud. Remove stiff language. Keep meaning and structure identical. Output ONLY the polished dialogue:\n\n' + rawSnippet }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } }) });
        const geminiJson = await resp.json();
        const polished = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || rawSnippet;
        return { text: polished, raw: rawSnippet, gemini_status: resp.status }; })();
              _workflowState['node-s3-gemini-polish'] = {
                input: inputData,
                output: result
              };
              return result;
            });
      _workflowState['node-s3-gemini-polish'] = _workflowState['node-s3-gemini-polish'] || { output: _workflowResults.step_transform_42 };
      console.log('type:WF_NODE_END:nodeId:node-s3-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-gemini-polish']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-gemini-polish:nodeName:'+"transform"+':nodeType:'+'transform'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_43 = await step.do("step_kv_put_43", async () => {
          const inputData = _workflowState['node-s3-gemini-polish']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:stage3_snippet`;
          const value = `${_workflowResults.step_transform_42.text}`;
          await this.env["LEADS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-s3-kv-write-snippet'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s3-kv-write-snippet'] = _workflowState['node-s3-kv-write-snippet'] || { output: _workflowResults.step_kv_put_43 };
      console.log('type:WF_NODE_END:nodeId:node-s3-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-kv-write-snippet']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-kv-write-snippet:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-kv-write-ready:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_44 = await step.do("step_kv_put_44", async () => {
          const inputData = _workflowState['node-s3-kv-write-snippet']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:stage3_ready`;
          const value = "{\"ready\": true}";
          await this.env["LEADS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-s3-kv-write-ready'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s3-kv-write-ready'] = _workflowState['node-s3-kv-write-ready'] || { output: _workflowResults.step_kv_put_44 };
      console.log('type:WF_NODE_END:nodeId:node-s3-kv-write-ready:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-kv-write-ready']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-kv-write-ready:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-s3-signal-complete:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_kv_put_45 = await step.do("step_kv_put_45", async () => {
          const inputData = _workflowState['node-s3-kv-write-ready']?.output || event.payload;
          const key = `lead:${_workflowResults.step_entry_0.lid}:stage3_complete`;
          const value = "{\"complete\": true, \"status\": \"roi-delivered\"}";
          await this.env["LEADS_KV"].put(key, value, {
            expirationTtl: 3600
          });
          const result = { success: true, key };
          _workflowState['node-s3-signal-complete'] = {
            input: inputData,
            output: result
          };
          return result;
        });
      _workflowState['node-s3-signal-complete'] = _workflowState['node-s3-signal-complete'] || { output: _workflowResults.step_kv_put_45 };
      console.log('type:WF_NODE_END:nodeId:node-s3-signal-complete:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-s3-signal-complete']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-s3-signal-complete:nodeName:'+"kv-put"+':nodeType:'+'kv-put'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }

    try {
      console.log('type:WF_NODE_START:nodeId:node-return:nodeName:'+"return"+':nodeType:'+'return'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId);
        _workflowResults.step_return_46 = await step.do('step_return_46', async () => {
          const result = JSON.parse(`{"status": "complete", "lid": "${_workflowResults.step_entry_0.lid}", "intel": "${_workflowResults.step_workers_ai_21.text}"}`);
          _workflowState['node-return'] = {
            input: _workflowState['node-s3-signal-complete']?.output || event.payload,
            output: result
          };
          return result;
        });
      _workflowState['node-return'] = _workflowState['node-return'] || { output: _workflowResults.step_return_46 };
      console.log('type:WF_NODE_END:nodeId:node-return:nodeName:'+"return"+':nodeType:'+'return'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:true:output:'+JSON.stringify(_workflowState['node-return']?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('type:WF_NODE_ERROR:nodeId:node-return:nodeName:'+"return"+':nodeType:'+'return'+':timestamp:'+Date.now()+':instanceId:'+event.instanceId+':success:false:error:'+errorMessage);
      throw error;
    }
    console.log('type:WF_END:timestamp:'+Date.now()+':instanceId:'+event.instanceId+':results:'+JSON.stringify(_workflowResults));
    return _workflowResults;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // GET /status/:instanceId — check workflow status
    if (path.startsWith('/status/')) {
      const instanceId = path.split('/status/')[1];
      if (!instanceId) return Response.json({ error: 'Missing instanceId' }, { status: 400 });
      try {
        const instance = await env.BELLAV9ORCHESTRATOR_WORKFLOW.get(instanceId);
        return Response.json({ id: instanceId, details: await instance.status() });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 404 });
      }
    }

    // POST /event/:instanceId — send event to a running workflow
    if (req.method === 'POST' && path.startsWith('/event/')) {
      const instanceId = path.split('/event/')[1];
      if (!instanceId) return Response.json({ error: 'Missing instanceId' }, { status: 400 });
      try {
        const body = await req.json();
        const instance = await env.BELLAV9ORCHESTRATOR_WORKFLOW.get(instanceId);
        await instance.sendEvent(body);
        return Response.json({ ok: true, instanceId, event: body });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // POST / — create new workflow instance
    const params = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const newId = crypto.randomUUID();
    let instance = await env.BELLAV9ORCHESTRATOR_WORKFLOW.create({
      id: newId,
      params: params
    });
    return Response.json({
      id: instance.id,
      details: await instance.status()
    });
  }
}