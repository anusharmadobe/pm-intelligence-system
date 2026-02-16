const apiKeyInput = document.getElementById('apiKeyInput');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const saveApiKeyBtn = document.getElementById('saveApiKey');
const clearApiKeyBtn = document.getElementById('clearApiKey');
const logoutApiKeyBtn = document.getElementById('logoutApiKey');
const registerReadOnlyBtn = document.getElementById('registerReadOnly');

const API_BASE = '';

function setStatus(text, ok = false) {
  apiKeyStatus.textContent = text;
  apiKeyStatus.style.background = ok ? '#22c55e' : '#9ca3af';
  apiKeyStatus.style.color = ok ? '#0f172a' : '#111827';
}

function loadApiKey() {
  const key = sessionStorage.getItem('pm_api_key');
  if (key) {
    apiKeyInput.value = key;
    setStatus('Key loaded', true);
  } else {
    setStatus('No key');
  }
}

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus('No key');
    sessionStorage.removeItem('pm_api_key');
    return;
  }
  sessionStorage.setItem('pm_api_key', key);
  setStatus('Key saved', true);
}

function getApiKey() {
  return sessionStorage.getItem('pm_api_key') || '';
}

async function apiRequest(path, options = {}, requireKey = true) {
  const headers = options.headers || {};
  if (requireKey) {
    const key = getApiKey();
    if (!key) {
      throw new Error('Missing API key. Register or paste one above.');
    }
    headers['X-API-Key'] = key;
  }
  headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || response.statusText);
  }
  return text ? JSON.parse(text) : {};
}

function showOutput(elementId, data) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

// Tabs
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    btn.setAttribute('tabindex', '0');
    const panel = document.getElementById(btn.dataset.tab);
    panel?.classList.add('active');
  });
});
document.querySelector('.tabs button')?.classList.add('active');
document.querySelector('.tabs button')?.setAttribute('aria-selected', 'true');
document.querySelector('.tabs button')?.setAttribute('tabindex', '0');
document.querySelector('.tab-panel')?.classList.add('active');

// API key controls
saveApiKeyBtn.addEventListener('click', saveApiKey);
clearApiKeyBtn.addEventListener('click', () => {
  sessionStorage.removeItem('pm_api_key');
  apiKeyInput.value = '';
  setStatus('No key');
});
logoutApiKeyBtn.addEventListener('click', () => {
  sessionStorage.removeItem('pm_api_key');
  apiKeyInput.value = '';
  setStatus('Logged out');
});
registerReadOnlyBtn.addEventListener('click', async () => {
  try {
    const payload = {
      agent_name: `ui-readonly-${Date.now()}`,
      agent_class: 'orchestrator',
      permissions: { read: true, write: false, events: true }
    };
    const response = await apiRequest('/api/agents/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, false);
    apiKeyInput.value = response.api_key || '';
    saveApiKey();
    showOutput('agentRegistration', response);
  } catch (error) {
    showOutput('agentRegistration', String(error));
  }
});

// PM Dashboard actions
document.getElementById('runSearch').addEventListener('click', async () => {
  try {
    const query = document.getElementById('searchQuery').value.trim();
    const source = document.getElementById('searchSource').value;
    const date_from = document.getElementById('searchDateFrom').value;
    const date_to = document.getElementById('searchDateTo').value;
    const params = new URLSearchParams({ query, source });
    if (date_from) params.append('date_from', date_from);
    if (date_to) params.append('date_to', date_to);
    const data = await apiRequest(`/api/agents/v1/signals?${params.toString()}`);
    showOutput('searchResults', data);
  } catch (error) {
    showOutput('searchResults', String(error));
  }
});

document.getElementById('fetchCustomer').addEventListener('click', async () => {
  try {
    const name = document.getElementById('customerName').value.trim();
    const data = await apiRequest(`/api/agents/v1/customer/${encodeURIComponent(name)}`);
    showOutput('customerProfile', data);
  } catch (error) {
    showOutput('customerProfile', String(error));
  }
});

document.getElementById('runQuery').addEventListener('click', async () => {
  try {
    const query = document.getElementById('queryText').value.trim();
    const data = await apiRequest('/api/agents/v1/query', {
      method: 'POST',
      body: JSON.stringify({ query })
    });
    showOutput('queryResult', data);
  } catch (error) {
    showOutput('queryResult', String(error));
  }
});

document.getElementById('ingestSignal').addEventListener('click', async () => {
  try {
    const source = document.getElementById('ingestSource').value.trim() || 'manual';
    const content = document.getElementById('ingestContent').value.trim();
    const metadataText = document.getElementById('ingestMetadata').value.trim();
    const metadata = metadataText ? JSON.parse(metadataText) : {};
    const data = await apiRequest('/api/agents/v1/ingest', {
      method: 'POST',
      body: JSON.stringify({ source, content, metadata })
    });
    showOutput('ingestResult', data);
  } catch (error) {
    showOutput('ingestResult', String(error));
  }
});

// PM Leader actions
document.getElementById('runHeatmap').addEventListener('click', async () => {
  try {
    const dimension = document.getElementById('heatmapDimension').value;
    const metric = document.getElementById('heatmapMetric').value;
    const limit = document.getElementById('heatmapLimit').value;
    const params = new URLSearchParams({ dimension, metric, limit });
    const data = await apiRequest(`/api/agents/v1/heatmap?${params.toString()}`);
    showOutput('heatmapResults', data);
  } catch (error) {
    showOutput('heatmapResults', String(error));
  }
});

document.getElementById('runTrends').addEventListener('click', async () => {
  try {
    const entity_type = document.getElementById('trendEntityType').value;
    const direction = document.getElementById('trendDirection').value;
    const window_days = document.getElementById('trendWindow').value;
    const params = new URLSearchParams({ entity_type, direction, window_days });
    const data = await apiRequest(`/api/agents/v1/trends?${params.toString()}`);
    showOutput('trendResults', data);
  } catch (error) {
    showOutput('trendResults', String(error));
  }
});

document.getElementById('runOpportunities').addEventListener('click', async () => {
  try {
    const data = await apiRequest('/api/agents/v1/opportunities');
    showOutput('opportunityResults', data);
  } catch (error) {
    showOutput('opportunityResults', String(error));
  }
});

// New PM actions
document.getElementById('runEntitySearch').addEventListener('click', async () => {
  try {
    const query = document.getElementById('entitySearch').value.trim();
    const params = new URLSearchParams({ query });
    const data = await apiRequest(`/api/agents/v1/entities?${params.toString()}`);
    showOutput('entityResults', data);
  } catch (error) {
    showOutput('entityResults', String(error));
  }
});

document.getElementById('fetchEntity').addEventListener('click', async () => {
  try {
    const id = document.getElementById('entityId').value.trim();
    const data = await apiRequest(`/api/agents/v1/entities/${encodeURIComponent(id)}`);
    showOutput('entityDetail', data);
  } catch (error) {
    showOutput('entityDetail', String(error));
  }
});

// Stakeholder reports
document.getElementById('runReport').addEventListener('click', async () => {
  try {
    const report_type = document.getElementById('reportType').value;
    const audience = document.getElementById('reportAudience').value;
    const time_window_days = parseInt(document.getElementById('reportWindow').value, 10);
    const data = await apiRequest('/api/agents/v1/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ report_type, audience, time_window_days })
    });
    showOutput('reportOutput', data.report || data);
  } catch (error) {
    showOutput('reportOutput', String(error));
  }
});

// Admin & Agents
document.getElementById('registerAgent').addEventListener('click', async () => {
  try {
    const agent_name = document.getElementById('agentName').value.trim() || `agent-${Date.now()}`;
    const agent_class = document.getElementById('agentClass').value;
    const permissions = {
      read: document.getElementById('agentPermRead').checked,
      write: document.getElementById('agentPermWrite').checked,
      events: document.getElementById('agentPermEvents').checked
    };
    const payload = { agent_name, agent_class, permissions };
    const data = await apiRequest('/api/agents/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, false);
    showOutput('agentRegistration', data);
  } catch (error) {
    showOutput('agentRegistration', String(error));
  }
});

document.getElementById('registerSource').addEventListener('click', async () => {
  try {
    const source_name = document.getElementById('sourceName').value.trim();
    const source_type = document.getElementById('sourceType').value;
    const data = await apiRequest('/api/agents/v1/sources', {
      method: 'POST',
      body: JSON.stringify({ source_name, source_type, status: 'connected' })
    });
    showOutput('sourcesOutput', data);
  } catch (error) {
    showOutput('sourcesOutput', String(error));
  }
});

document.getElementById('loadSources').addEventListener('click', async () => {
  try {
    const data = await apiRequest('/api/agents/v1/sources');
    showOutput('sourcesOutput', data);
  } catch (error) {
    showOutput('sourcesOutput', String(error));
  }
});

document.getElementById('loadEvents').addEventListener('click', async () => {
  try {
    const data = await apiRequest('/api/agents/v1/events/history');
    showOutput('eventsOutput', data);
  } catch (error) {
    showOutput('eventsOutput', String(error));
  }
});

// System health
document.getElementById('refreshHealth').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    showOutput('healthOutput', data);
  } catch (error) {
    showOutput('healthOutput', String(error));
  }
});

loadApiKey();
