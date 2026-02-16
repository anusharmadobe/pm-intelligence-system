import assert from 'assert';

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';

async function request(
  path: string,
  options: RequestInit = {},
  allowedStatuses: number[] = [200],
  timeoutMs = 30000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal });
  clearTimeout(timeout);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return json;
}

async function main() {
  console.log('Starting V2 end-to-end test');

  const registrationHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.AGENT_REGISTRATION_SECRET) {
    registrationHeaders['X-Registration-Secret'] = process.env.AGENT_REGISTRATION_SECRET;
  }
  const registration = await request(
    '/api/agents/v1/auth/register',
    {
      method: 'POST',
      headers: registrationHeaders,
      body: JSON.stringify({
        agent_name: `e2e-agent-${Date.now()}`,
        agent_class: 'integration',
        permissions: { read: true, write: true, events: true }
      })
    },
    [201]
  );
  assert(registration.api_key, 'API key missing from registration');
  const apiKey = registration.api_key;

  const authHeaders = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey
  };

  const health = await request('/api/agents/v1/health', { headers: authHeaders });
  assert(health.status === 'ok', 'Agent health check failed');

  const unauthorizedHealth = await request('/api/agents/v1/health', {}, [401]);
  assert(unauthorizedHealth.error, 'Expected unauthorized health error');

  const idempotencyKey = `e2e-${Date.now()}`;
  const ingest = await request(
    '/api/agents/v1/ingest',
    {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        source: 'manual',
        content: 'Acme Corp reports latency in checkout flow. FeatureX impacted.',
        metadata: { source: 'e2e' }
      })
    },
    [201]
  );
  assert(ingest.signal_id, 'Signal ingest failed');

  const ingestRepeat = await request('/api/agents/v1/ingest', {
    method: 'POST',
    headers: { ...authHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      source: 'manual',
      content: 'Acme Corp reports latency in checkout flow. FeatureX impacted.',
      metadata: { source: 'e2e' }
    })
  });
  assert(
    ingestRepeat.signal_id === ingest.signal_id,
    'Idempotent ingest did not return the original signal_id'
  );

  const invalidIngest = await request(
    '/api/agents/v1/ingest',
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ source: 'manual' })
    },
    [400]
  );
  assert(invalidIngest.error, 'Expected invalid ingest error');

  const provenance = await request(`/api/agents/v1/provenance/${ingest.signal_id}`, {
    headers: authHeaders
  });
  assert(provenance.signal, 'Provenance signal missing');

  const queryResult = await request('/api/agents/v1/query', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      query: 'checkout latency',
      limit: 5
    })
  });
  assert(queryResult.answer, 'Query answer missing');
  assert(queryResult.supporting_signals, 'Query supporting_signals missing');

  const sourceRegister = await request(
    '/api/agents/v1/sources',
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        source_name: `e2e-source-${Date.now()}`,
        source_type: 'manual',
        status: 'connected'
      })
    },
    [201]
  );
  assert(sourceRegister.source, 'Source registration failed');

  const sourcesList = await request('/api/agents/v1/sources', { headers: authHeaders });
  assert(sourcesList.sources, 'Sources list missing');

  if (sourceRegister?.source?.id) {
    await request(
      `/api/agents/v1/sources/${sourceRegister.source.id}`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'disabled' })
      },
      [200]
    );
  }

  const customer = await request(`/api/agents/v1/customer/${encodeURIComponent('Acme Corp')}`, {
    headers: authHeaders
  });
  assert(customer, 'Customer profile missing');

  const heatmap = await request('/api/agents/v1/heatmap?dimension=issues_by_customer&limit=5', {
    headers: authHeaders
  });
  assert(heatmap.rows, 'Heatmap rows missing');

  const trends = await request('/api/agents/v1/trends?entity_type=issue&window_days=28', {
    headers: authHeaders
  });
  assert(trends.trends, 'Trends missing');

  const opportunities = await request('/api/agents/v1/opportunities', {
    headers: authHeaders
  });
  assert(opportunities.opportunities, 'Opportunities missing');

  const systemHealth = await request('/api/health', {}, [200, 503]);
  assert(systemHealth.status, 'System health missing');

  let rateLimited = false;
  for (let i = 0; i < 65; i++) {
    const response = await fetch(`${baseUrl}/api/agents/v1/health`, { headers: authHeaders });
    if (response.status === 429) {
      rateLimited = true;
      break;
    }
  }
  assert(rateLimited, 'Expected rate limiting to trigger');

  if (process.env.FF_A2A_SERVER === 'true') {
    const a2aResult = await request('/a2a', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          skill_id: 'query-trends',
          input: {
            entity_type: 'issue',
            window_days: 28,
            limit: 5
          }
        }
      })
    });
    assert(a2aResult.result?.task?.status?.state === 'completed', 'A2A task incomplete');
  }

  console.log('V2 end-to-end test completed successfully');
}

main().catch((error) => {
  console.error('E2E test failed', error);
  process.exit(1);
});
