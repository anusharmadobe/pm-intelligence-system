import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { apiClient } from './api_client';

function loadEnvFile(envPath: string) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        return;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch (error) {
    console.error('Failed to parse .env file:', error);
  }
}

// Load .env file from workspace root
function loadEnvironment() {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const envPath = path.join(workspaceRoot, '.env');
      if (fs.existsSync(envPath)) {
        loadEnvFile(envPath);
      } else {
        // Try parent directory (if extension is in cursor_extension subfolder)
        const parentEnvPath = path.join(workspaceRoot, '..', '.env');
        if (fs.existsSync(parentEnvPath)) {
          loadEnvFile(parentEnvPath);
        }
      }
    } else {
      // Fallback: try current working directory
      loadEnvFile(path.join(process.cwd(), '.env'));
    }
  } catch (error) {
    console.error('Failed to load environment:', error);
  }
}

// LLM Provider type (function that takes prompt and returns response)
type LLMProvider = (prompt: string) => Promise<string>;

let selectedModelId: string | null = null;
let globalStateRef: vscode.Memento | null = null;

function getCursorLm(): any {
  const vscodeAny: any = vscode;
  return (
    vscodeAny['lm'] ||
    vscodeAny.lm ||
    vscodeAny.languageModels ||
    vscodeAny.ai?.lm ||
    (global as any)?.lm ||
    (global as any)?.vscode?.lm
  );
}

async function ensureModelSelected(promptIfMissing: boolean): Promise<void> {
  const lm = getCursorLm();
  if (!lm || typeof lm.selectChatModels !== 'function') {
    throw new Error('No LLM model selector available in this Cursor version.');
  }

  const waitForChatModels = async (timeoutMs: number): Promise<any[]> => {
    if (!lm.onDidChangeChatModels || typeof lm.onDidChangeChatModels !== 'function') {
      return [];
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        disposable?.dispose();
        resolve([]);
      }, timeoutMs);
      const disposable = lm.onDidChangeChatModels(async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        disposable?.dispose();
        try {
          const updated = await lm.selectChatModels();
          resolve(updated || []);
        } catch {
          resolve([]);
        }
      });
    });
  };

  let models = await lm.selectChatModels();
  if (!models || models.length === 0) {
    const updated = await waitForChatModels(10000);
    models = updated;
  }
  if (!models || models.length === 0) {
    throw new Error(
      'No LLM models available in this Cursor environment. Please ensure Cursor AI is enabled and you are signed in. ' +
      'Open Cursor Chat once to initialize models, then try again.'
    );
  }

  const hasSelected = selectedModelId && models.some((m: any) => m?.id === selectedModelId);
  if (hasSelected || !promptIfMissing) {
    return;
  }

  const listLines = models.map((m: any) => {
    return `- ${m.name} (vendor: ${m.vendor}, family: ${m.family}, version: ${m.version}, id: ${m.id})`;
  });
  const doc = await vscode.workspace.openTextDocument({
    content: ['# Available LLM Models', '', ...listLines].join('\n'),
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc, { preview: false });

  const quickPickItems = models.map((m: any) => ({
    label: m.name || m.id,
    description: `${m.vendor} • ${m.family} • ${m.version}`,
    detail: m.id,
    modelId: m.id
  }));

  const sonnetIndex = models.findIndex((m: any) => {
    const haystack = `${m?.name || ''} ${m?.family || ''} ${m?.id || ''}`.toLowerCase();
    return haystack.includes('sonnet');
  });

  if (sonnetIndex >= 0) {
    (quickPickItems[sonnetIndex] as any).picked = true;
  } else if (quickPickItems.length > 0) {
    (quickPickItems[0] as any).picked = true;
  }

  const selected = (await vscode.window.showQuickPick(quickPickItems as any[], {
    placeHolder: 'Select LLM model (default is Claude Sonnet if available)',
    ignoreFocusOut: true
  })) as any;

  if (!selected) {
    throw new Error('No LLM model selected.');
  }

  selectedModelId = selected.modelId || null;
  if (globalStateRef) {
    await globalStateRef.update('pm-intelligence.selectedModelId', selectedModelId);
  }
  vscode.window.showInformationMessage(`Selected LLM model: ${selected.label}`);
}

const SIMPLE_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
  'this', 'that', 'these', 'those'
]);

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !SIMPLE_STOP_WORDS.has(token));
}

function tokenOverlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let overlap = 0;
  setA.forEach(token => {
    if (setB.has(token)) overlap += 1;
  });
  return overlap / Math.max(setA.size, setB.size);
}

async function fetchSignalsSample(maxSignals: number): Promise<any[]> {
  const pageSize = 100;
  const signals: any[] = [];
  let offset = 0;
  while (signals.length < maxSignals) {
    const response = await apiClient.getSignals({ limit: pageSize, offset });
    const batch = Array.isArray(response)
      ? response
      : (response as any).signals || (response as any).data || [];
    if (!batch.length) break;
    signals.push(...batch);
    offset += pageSize;
  }
  return signals.slice(0, maxSignals);
}

async function fetchAllSignals(): Promise<any[]> {
  const pageSize = 200;
  const signals: any[] = [];
  let offset = 0;
  while (true) {
    const response = await apiClient.getSignals({ limit: pageSize, offset });
    const batch = Array.isArray(response)
      ? response
      : (response as any).signals || (response as any).data || [];
    if (!batch.length) break;
    signals.push(...batch);
    offset += pageSize;
  }
  return signals;
}

function toCsvRows(rows: Array<Record<string, any>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: any) => {
    const str = value === undefined || value === null ? '' : String(value);
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };
  const lines = [
    headers.map(escape).join(',')
  ];
  rows.forEach(row => {
    lines.push(headers.map(h => escape(row[h])).join(','));
  });
  return lines.join('\n');
}

async function runLlmClusteringBatch(llmProvider: LLMProvider, signals: any[], batchIndex: number, batchCount: number) {
  const promptSignals = signals.map((s: any, idx: number) => {
    const text = String(s.content || s.text || '').slice(0, 300);
    return `${idx + 1}. [${s.id}] ${text}`;
  }).join('\n');

  const prompt = `You are clustering product signals into opportunities.
Return a JSON object with a single key "opportunities" (array).
Each opportunity must include:
- title (short)
- description (1-2 sentences)
- signal_ids (array of ids)

Batch ${batchIndex + 1} of ${batchCount}
Signals:
${promptSignals}
`;

  const llmResponse = await llmProvider(prompt);
  let llmData: any = null;
  try {
    llmData = JSON.parse(llmResponse);
  } catch {
    const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      llmData = JSON.parse(jsonMatch[0]);
    }
  }
  if (!llmData || !Array.isArray(llmData.opportunities)) {
    throw new Error('LLM response could not be parsed as JSON opportunities.');
  }
  return llmData.opportunities;
}

/**
 * Creates an LLM provider using Cursor's built-in LLM capabilities.
 * Uses Cursor's language model API (vscode.lm) which provides access to built-in LLMs.
 * No external APIs or local models - only Cursor's built-in LLMs.
 */
function createCursorLLMProvider(): LLMProvider {
  return async (prompt: string): Promise<string> => {
    // Use Cursor's built-in language model API
    // Cursor extensions have access to vscode.lm API for LLM invocations
    // Access via bracket notation to bypass TypeScript type checking
    const lm = getCursorLm();
    
    if (!lm) {
      throw new Error('Cursor LLM API not available. Please ensure you are running in Cursor IDE.');
    }

    const buildMessages = () => {
      const messageBuilder = (vscode as any).LanguageModelChatMessage;
      if (messageBuilder && typeof messageBuilder.User === 'function') {
        return [messageBuilder.User(prompt)];
      }
      return [{ role: 'user', content: prompt }];
    };

    const responseToText = async (response: any): Promise<string> => {
      if (typeof response === 'string') return response;
      if (response && typeof response.content === 'string') return response.content;
      if (response && typeof response.text === 'string') return response.text;
      if (response && response.response) return String(response.response);
      if (response && response.stream && typeof response.stream[Symbol.asyncIterator] === 'function') {
        let text = '';
        try {
          for await (const chunk of response.stream) {
            if (chunk && typeof chunk.text === 'string') {
              text += chunk.text;
            } else if (chunk && typeof chunk.content === 'string') {
              text += chunk.content;
            } else if (chunk && typeof chunk.value === 'string') {
              text += chunk.value;
            } else {
              text += String(chunk || '');
            }
          }
        } catch (error: any) {
          throw new Error(`Failed to read LLM stream: ${error?.message || String(error)}`);
        }
        if (text.trim().length > 0) return text;
      }
      return String(response);
    };

    const tryModel = async (model: any) => {
      if (model && typeof model.sendRequest === 'function') {
        const response = await model.sendRequest(buildMessages());
        return await responseToText(response);
      }
      return null;
    };

    const trySelectModels = async (selector?: any) => {
      if (typeof lm.selectChatModels !== 'function') return null;
      const models = await lm.selectChatModels(selector);
      if (models && models.length > 0) {
        const responseText = await tryModel(models[0]);
        if (responseText) return responseText;
      }
      return null;
    };

    try {
      if (typeof lm.selectChatModels === 'function') {
        const available = await lm.selectChatModels();
        if (!available || available.length === 0) {
          throw new Error('No LLM models available in this Cursor environment.');
        }
      }
      // Method 1: Try sendChatRequest (VS Code 1.80+ / Cursor API)
      if (typeof lm.sendChatRequest === 'function') {
        const response = await lm.sendChatRequest(
          buildMessages(),
          {
            model: undefined, // Use Cursor's default model
            temperature: 0.7
          }
        );
        return await responseToText(response);
      }

      // Method 2: Try preferred model id if selected
      if (selectedModelId) {
        const preferred = await trySelectModels({ id: selectedModelId });
        if (preferred) return preferred;
      }

      // Method 3: Try to pick Claude Sonnet if available
      if (typeof lm.selectChatModels === 'function') {
        const models = await lm.selectChatModels();
        const sonnet = models?.find((m: any) => {
          const haystack = `${m?.name || ''} ${m?.family || ''} ${m?.id || ''}`.toLowerCase();
          return haystack.includes('sonnet');
        });
        const responseText = await tryModel(sonnet);
        if (responseText) return responseText;
      }

      const selectors = [
        { label: 'default', selector: undefined },
        { label: 'cursor', selector: { vendor: 'cursor' } },
        { label: 'openai', selector: { vendor: 'openai' } },
        { label: 'anthropic', selector: { vendor: 'anthropic' } },
        { label: 'gpt-4', selector: { family: 'gpt-4' } },
        { label: 'gpt-4o', selector: { family: 'gpt-4o' } },
        { label: 'claude-3', selector: { family: 'claude-3' } },
        { label: 'claude-3.5', selector: { family: 'claude-3.5' } },
        { label: 'claude-sonnet', selector: { family: 'sonnet' } }
      ];

      // Method 4: Try selectChatModels with common selectors
      if (typeof lm.selectChatModels === 'function') {
        for (const entry of selectors) {
          const responseText = await trySelectModels(entry.selector);
          if (responseText) return responseText;
        }
      }

      // Method 5: Try getLanguageModels and use first available
      if (typeof lm.getLanguageModels === 'function') {
        const models = await lm.getLanguageModels();
        if (models && models.length > 0) {
          const responseText = await tryModel(models[0]);
          if (responseText) return responseText;
        }
      }

      // Method 6: Try getChatModels (alternate API naming)
      if (typeof lm.getChatModels === 'function') {
        const models = await lm.getChatModels();
        if (models && models.length > 0) {
          const responseText = await tryModel(models[0]);
          if (responseText) return responseText;
        }
      }

      // Method 7: Try models array
      if (Array.isArray((lm as any).models) && (lm as any).models.length > 0) {
        const responseText = await tryModel((lm as any).models[0]);
        if (responseText) return responseText;
      }
    } catch (error: any) {
      throw new Error(`Failed to invoke Cursor's built-in LLM: ${error.message}`);
    }

    const lmKeys = Object.keys(lm || {});
    const protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(lm || {}));
    throw new Error(
      `Cursor LLM API available but no compatible method found. Keys: ${lmKeys.join(', ') || 'none'}; ` +
      `Proto keys: ${protoKeys.join(', ') || 'none'}. Please check Cursor version.`
    );
  };
}

let llmBridgeServer: http.Server | null = null;

function startLlmBridgeServer(context: vscode.ExtensionContext) {
  if (llmBridgeServer) return;
  const token = process.env.CURSOR_LLM_BRIDGE_TOKEN;
  if (!token) {
    console.warn('CURSOR_LLM_BRIDGE_TOKEN is not set; LLM bridge server will not start.');
    return;
  }

  const port = Number(process.env.CURSOR_LLM_BRIDGE_PORT || 3344);
  const provider = createCursorLLMProvider();

  llmBridgeServer = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/llm') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const authHeader = req.headers['authorization'] || '';
      const tokenMatch = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';
      if (tokenMatch !== token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) {
          req.destroy();
        }
      });

      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const prompt = parsed.prompt;
          if (!prompt || typeof prompt !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'prompt is required' }));
            return;
          }
          const content = await provider(prompt);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content }));
        } catch (error: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error?.message || String(error) }));
        }
      });
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error?.message || String(error) }));
    }
  });

  llmBridgeServer.listen(port, '127.0.0.1', () => {
    console.log(`Cursor LLM bridge listening on http://127.0.0.1:${port}/llm`);
  });

  context.subscriptions.push({
    dispose: () => {
      if (llmBridgeServer) {
        llmBridgeServer.close();
        llmBridgeServer = null;
      }
    }
  });
}

/**
 * Activates the PM Intelligence System extension.
 * Provides commands for signal ingestion, opportunity detection, judgment creation, and artifact generation.
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("PM Intelligence Extension Active");
  
  // Load environment variables after activation
  loadEnvironment();
  globalStateRef = context.globalState;
  selectedModelId = context.globalState.get('pm-intelligence.selectedModelId') || null;
  startLlmBridgeServer(context);
  
  // Ensure extension is activated immediately
  vscode.window.showInformationMessage('PM Intelligence Extension Activated', { modal: false }).then(() => {
    // Extension is ready
  });

  // Command: Ingest Signal
  const ingestSignalCommand = vscode.commands.registerCommand(
    'pm-intelligence.ingestSignal',
    async () => {
      const source = await vscode.window.showInputBox({
        prompt: 'Signal source (e.g., slack, teams, grafana, splunk)',
        placeHolder: 'slack'
      });
      if (!source) return;

      const text = await vscode.window.showInputBox({
        prompt: 'Signal content (raw text, no summaries)',
        placeHolder: 'Enter raw signal text...'
      });
      if (!text) return;

      const type = await vscode.window.showInputBox({
        prompt: 'Signal type',
        placeHolder: 'bug_report, feature_request, etc.'
      }) || 'unknown';

      try {
        const signal = await apiClient.ingestSignal({
          source,
          text,
          type
        });
        vscode.window.showInformationMessage(`Signal ingested: ${signal.id.substring(0, 8)}...`);
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        vscode.window.showErrorMessage(`Failed to ingest signal: ${errorMessage}`);
        console.error('Ingest signal error:', error);
      }
    }
  );

  // Command: Detect Opportunities
  const detectOpportunitiesCommand = vscode.commands.registerCommand(
    'pm-intelligence.detectOpportunities',
    async () => {
      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Detecting opportunities...",
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0, message: "Detecting opportunities..." });
          const opportunities = await apiClient.detectOpportunities(true);
          progress.report({ increment: 100, message: "Complete!" });
          
          vscode.window.showInformationMessage(
            `Detected ${opportunities.length} opportunities`
          );
        });
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        vscode.window.showErrorMessage(`Failed to detect opportunities: ${errorMessage}`);
        console.error('Detect opportunities error:', error);
      }
    }
  );

  // Command: Create Judgment
  const createJudgmentCommand = vscode.commands.registerCommand(
    'pm-intelligence.createJudgment',
    async () => {
      try {
        // Show progress indicator
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Loading opportunities...",
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0, message: "Fetching opportunities..." });
          
          const opportunitiesResponse = await apiClient.getOpportunities();
          const opportunities = Array.isArray(opportunitiesResponse)
            ? opportunitiesResponse
            : (opportunitiesResponse as any).opportunities || [];
          
          if (opportunities.length === 0) {
            vscode.window.showWarningMessage('No opportunities found. Detect opportunities first.');
            return;
          }

          progress.report({ increment: 30, message: "Ready to select..." });

          const items = opportunities.map((opp: any) => ({
            label: opp.title || opp.id,
            description: opp.description || '',
            id: opp.id
          }));

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an opportunity to create judgment for'
          });
          if (!selected) return;
          
          const opportunityId = (selected as any).id;
          const opportunityLabel = (selected as any).label;

          // Get user ID (required for human-in-the-loop)
          const userId = await vscode.window.showInputBox({
            prompt: 'Your user ID (required for human-in-the-loop)',
            placeHolder: 'user@example.com'
          });
          if (!userId) {
            vscode.window.showWarningMessage('User ID required - judgments require human-in-the-loop');
            return;
          }

          progress.report({ increment: 50, message: "Fetching signals..." });
          const signals = await apiClient.getOpportunitySignals(opportunityId);
          const opportunity = opportunities.find((opp: any) => opp.id === opportunityId);

          if (signals.length === 0) {
            vscode.window.showWarningMessage(`No signals found for opportunity ${String(opportunityLabel)}`);
            return;
          }

          progress.report({ increment: 70, message: "Creating judgment with LLM..." });

          // Build synthesis prompt
          const signalTexts = signals.map((s: any) => `- [${s.source}] ${s.text}`).join('\n');
          const prompt = `Analyze this product opportunity and provide structured reasoning.

OPPORTUNITY:
Title: ${opportunity?.title || opportunityLabel}
Description: ${opportunity?.description || 'N/A'}
Signal Count: ${signals.length}

SIGNALS:
${signalTexts}

Provide your analysis in the following format:
ANALYSIS: [Your analysis of the opportunity, customer needs, and patterns]

RECOMMENDATION: [Your recommendation on how to proceed]

ASSUMPTIONS: [List any assumptions you're making, one per line starting with "-"]

MISSING_EVIDENCE: [List any evidence that would strengthen this opportunity, one per line starting with "-"]

CONFIDENCE: [A number between 0 and 1 indicating your confidence level]`;

          const llmProvider = createCursorLLMProvider();
          const llmResponse = await llmProvider(prompt);

          // Parse LLM response
          const analysisMatch = llmResponse.match(/ANALYSIS:\s*(.+?)(?=RECOMMENDATION:|$)/is);
          const recommendationMatch = llmResponse.match(/RECOMMENDATION:\s*(.+?)(?=ASSUMPTIONS:|MISSING_EVIDENCE:|CONFIDENCE:|$)/is);
          const confidenceMatch = llmResponse.match(/CONFIDENCE:\s*([0-9.]+)/i);
          
          const analysis = analysisMatch ? analysisMatch[1].trim() : llmResponse.substring(0, 500);
          const recommendation = recommendationMatch ? recommendationMatch[1].trim() : 'Review opportunity';
          const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

          progress.report({ increment: 90, message: "Saving judgment..." });

          // Save judgment via API
          const judgment = await apiClient.createJudgment({
            opportunityId: opportunityId,
            userId,
            analysis,
            recommendation,
            confidence: Math.max(0, Math.min(1, confidence)),
            reasoning: llmResponse
          });
          
          progress.report({ increment: 100, message: "Complete!" });
          
          vscode.window.showInformationMessage(
            `Judgment created: ${judgment.id.substring(0, 8)}... (confidence: ${judgment.confidence_level || 'medium'})`
          );
        });
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        vscode.window.showErrorMessage(`Failed to create judgment: ${errorMessage}`);
        console.error('Judgment creation error:', error);
      }
    }
  );

  // Command: Create Artifact
  const createArtifactCommand = vscode.commands.registerCommand(
    'pm-intelligence.createArtifact',
    async () => {
      try {
        const opportunitiesResponse = await apiClient.getOpportunities();
        const opportunities = Array.isArray(opportunitiesResponse)
          ? opportunitiesResponse
          : (opportunitiesResponse as any).opportunities || [];
        if (opportunities.length === 0) {
          vscode.window.showWarningMessage('No opportunities found.');
          return;
        }

        const oppItems = opportunities.map((opp: any) => ({
          label: opp.title || opp.id,
          description: opp.description || '',
          id: opp.id
        }));

        const selectedOpp = await vscode.window.showQuickPick(oppItems, {
          placeHolder: 'Select an opportunity'
        });
        if (!selectedOpp) return;
        
        const selectedOppId = (selectedOpp as any).id;

        const judgmentsResponse = await apiClient.getJudgments(selectedOppId);
        const judgments = Array.isArray(judgmentsResponse)
          ? judgmentsResponse
          : (judgmentsResponse as any).judgments || [];
        if (judgments.length === 0) {
          vscode.window.showWarningMessage('No judgments found for this opportunity. Create a judgment first.');
          return;
        }

        const judgmentItems = judgments.map((j: any) => ({
          label: (j.summary || '').substring(0, 50) + '...',
          description: `Confidence: ${j.confidence_level || 'unknown'}`,
          id: j.id
        }));

        const selectedJudgment = await vscode.window.showQuickPick(judgmentItems, {
          placeHolder: 'Select a judgment'
        });
        if (!selectedJudgment) return;
        
        const selectedJudgmentId = (selectedJudgment as any).id;

        const artifactType = await vscode.window.showQuickPick(
          ['PRD', 'RFC'],
          { placeHolder: 'Select artifact type' }
        ) as 'PRD' | 'RFC' | undefined;
        if (!artifactType) return;

        const userId = await vscode.window.showInputBox({
          prompt: 'Your user ID (required for human-in-the-loop)',
          placeHolder: 'user@example.com'
        });
        if (!userId) {
          vscode.window.showWarningMessage('User ID required - artifacts require human-in-the-loop');
          return;
        }

        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Creating artifact...",
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0, message: "Generating artifact with LLM..." });
          
          const selectedJudgmentData = judgments.find((j: any) => j.id === selectedJudgmentId);
          const llmProvider = createCursorLLMProvider();
          
          // Build artifact prompt
          const assumptions = selectedJudgmentData?.assumptions?.items || [];
          const missingEvidence = selectedJudgmentData?.missing_evidence?.items || [];
          const prompt = `Create a ${artifactType} draft based on the following judgment.

Judgment Summary: ${selectedJudgmentData?.summary || 'N/A'}
Assumptions: ${JSON.stringify(assumptions)}
Missing Evidence: ${JSON.stringify(missingEvidence)}
Confidence Level: ${selectedJudgmentData?.confidence_level || 'unknown'}

Requirements:
1. Create a complete ${artifactType} draft
2. Clearly label ALL assumptions in a dedicated "Assumptions" section
3. Include the judgment summary and analysis
4. Note any missing evidence that should be gathered
5. Use proper ${artifactType} structure and formatting

IMPORTANT: Clearly label all assumptions in the document.`;

          const artifactContent = await llmProvider(prompt);
          
          progress.report({ increment: 90, message: "Saving artifact..." });
          
          const artifact = await apiClient.createArtifact({
            judgmentId: selectedJudgmentId,
            type: artifactType,
            content: artifactContent
          });
          
          progress.report({ increment: 95, message: "Opening document..." });
          
          // Open artifact in new editor
          const doc = await vscode.workspace.openTextDocument({
            content: artifactContent,
            language: 'markdown'
          });
          await vscode.window.showTextDocument(doc);
          
          progress.report({ increment: 100, message: "Complete!" });
          vscode.window.showInformationMessage(`Artifact created: ${artifact.id?.substring(0, 8) || 'success'}...`);
        });
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        vscode.window.showErrorMessage(`Failed to create artifact: ${errorMessage}`);
        console.error('Create artifact error:', error);
      }
    }
  );

  // Command: View Signals
  const viewSignalsCommand = vscode.commands.registerCommand(
    'pm-intelligence.viewSignals',
    async () => {
      try {
        const response = await apiClient.getSignals();
        const signals = Array.isArray(response)
          ? response
          : (response as any).signals || (response as any).data || [];
        if (signals.length === 0) {
          vscode.window.showWarningMessage('No signals found.');
          return;
        }
        
        const content = signals.map((s: any) => 
          `[${s.source}] ${s.signal_type || 'unknown'}\n${(s.text || s.content || '').substring(0, 200)}\n---\n`
        ).join('\n');
        
        const doc = await vscode.workspace.openTextDocument({
          content: `# Signals (${signals.length} total)\n\n${content}`,
          language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        vscode.window.showErrorMessage(`Failed to view signals: ${errorMessage}`);
        console.error('View signals error:', error);
      }
    }
  );

  // Command: View Opportunities
  const viewOpportunitiesCommand = vscode.commands.registerCommand(
    'pm-intelligence.viewOpportunities',
    async () => {
      try {
        const opportunitiesResponse = await apiClient.getOpportunities();
        const opportunities = Array.isArray(opportunitiesResponse)
          ? opportunitiesResponse
          : (opportunitiesResponse as any).opportunities || [];
        if (opportunities.length === 0) {
          vscode.window.showWarningMessage('No opportunities found.');
          return;
        }
        
        const content = opportunities.map((opp: any) => 
          `## ${opp.title || opp.id}\n${opp.description || 'No description'}\n---\n`
        ).join('\n');
        
        const doc = await vscode.workspace.openTextDocument({
          content: `# Opportunities (${opportunities.length} total)\n\n${content}`,
          language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        vscode.window.showErrorMessage(`Failed to view opportunities: ${errorMessage}`);
        console.error('View opportunities error:', error);
      }
    }
  );

  // Command: View Metrics
  const viewMetricsCommand = vscode.commands.registerCommand(
    'pm-intelligence.viewMetrics',
    async () => {
      try {
        const metrics = await apiClient.getMetrics();
        const signalsBySource = (metrics as any).signals_by_source || (metrics as any).sources || {};
        const opportunitiesByStatus = (metrics as any).opportunities_by_status || (metrics as any).opportunities || {};
        const judgmentsByConfidence = (metrics as any).judgments_by_confidence || (metrics as any).judgments || {};
        const artifactsByType = (metrics as any).artifacts_by_type || (metrics as any).artifacts || {};
        const totalSignals = (metrics as any).total_signals || Object.values(signalsBySource).reduce((sum: number, v: any) => sum + Number(v || 0), 0);
        const totalOpportunities = (metrics as any).total_opportunities || Object.values(opportunitiesByStatus).reduce((sum: number, v: any) => sum + Number(v || 0), 0);
        const totalJudgments = (metrics as any).total_judgments || Object.values(judgmentsByConfidence).reduce((sum: number, v: any) => sum + Number(v || 0), 0);
        const totalArtifacts = (metrics as any).total_artifacts || Object.values(artifactsByType).reduce((sum: number, v: any) => sum + Number(v || 0), 0);
        
        const content = `# Adoption Metrics

## Signal Sources
${Object.entries(signalsBySource).map(([source, count]: [string, any]) => 
  `- ${source}: ${count} signals`
).join('\n')}

## Opportunities by Status
${Object.entries(opportunitiesByStatus).map(([status, count]: [string, any]) => 
  `- ${status}: ${count}`
).join('\n')}

## Judgments by Confidence
${Object.entries(judgmentsByConfidence).map(([level, count]: [string, any]) => 
  `- ${level}: ${count}`
).join('\n')}

## Artifacts by Type
${Object.entries(artifactsByType).map(([type, count]: [string, any]) => 
  `- ${type}: ${count}`
).join('\n')}

## Totals
- Total Signals: ${totalSignals}
- Total Opportunities: ${totalOpportunities}
- Total Judgments: ${totalJudgments}
- Total Artifacts: ${totalArtifacts}
`;

        const doc = await vscode.workspace.openTextDocument({
          content,
          language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        vscode.window.showErrorMessage(`Failed to retrieve signals: ${errorMessage}`);
        console.error('View signals error:', error);
      }
    }
  );

  // Command: Compare LLM Opportunities
  const compareLLMOpportunitiesCommand = vscode.commands.registerCommand(
    'pm-intelligence.compareLLMOpportunities',
    async () => {
      try {
        const maxSignalsInput = await vscode.window.showInputBox({
          prompt: 'Max signals to analyze with LLM (enter "all" for full dataset)',
          placeHolder: '200'
        });
        const useAllSignals = (maxSignalsInput || '').trim().toLowerCase() === 'all';
        const maxSignals = useAllSignals
          ? 0
          : Math.max(50, Math.min(500, parseInt(maxSignalsInput || '200', 10)));

        await ensureModelSelected(true);

        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Comparing LLM opportunities with current detection...',
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 5, message: 'Fetching signals...' });
          const signals = useAllSignals ? await fetchAllSignals() : await fetchSignalsSample(maxSignals);
          if (signals.length === 0) {
            vscode.window.showWarningMessage('No signals found to analyze.');
            return;
          }

          progress.report({ increment: 20, message: 'Fetching current opportunities...' });
          const opportunitiesResponse = await apiClient.getOpportunities();
          const opportunities = Array.isArray(opportunitiesResponse)
            ? opportunitiesResponse
            : (opportunitiesResponse as any).opportunities || [];

          progress.report({ increment: 40, message: 'Running LLM pass...' });
          const llmProvider = createCursorLLMProvider();
          const batchSize = 50;
          const batches: any[] = [];
          for (let i = 0; i < signals.length; i += batchSize) {
            batches.push(signals.slice(i, i + batchSize));
          }
          const llmOpportunities: any[] = [];
          for (let i = 0; i < batches.length; i += 1) {
            progress.report({ increment: 40 + Math.round((i / batches.length) * 20), message: `LLM batch ${i + 1}/${batches.length}` });
            const batchOpps = await runLlmClusteringBatch(llmProvider, batches[i], i, batches.length);
            llmOpportunities.push(...batchOpps);
          }

          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceRoot) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const outputPath = path.join(workspaceRoot, 'exports', `llm_opportunities_${ts}.json`);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, JSON.stringify({
              generated_at: new Date().toISOString(),
              signal_count: signals.length,
              opportunities: llmOpportunities
            }, null, 2));

            const csvPath = path.join(workspaceRoot, 'exports', `llm_opportunities_${ts}.csv`);
            const csvRows = llmOpportunities.map((opp: any) => ({
              title: String(opp.title || '').trim(),
              description: String(opp.description || '').trim(),
              signal_ids: Array.isArray(opp.signal_ids) ? opp.signal_ids.join('|') : ''
            }));
            fs.writeFileSync(csvPath, toCsvRows(csvRows));
          }

          progress.report({ increment: 70, message: 'Computing diff...' });
          const currentByTitle = opportunities.map((opp: any) => ({
            id: opp.id,
            title: opp.title || opp.id,
            tokens: normalizeTokens(opp.title || '')
          }));

          const llmOpps = llmOpportunities.map((opp: any) => ({
            title: String(opp.title || '').trim(),
            description: String(opp.description || '').trim(),
            signal_ids: Array.isArray(opp.signal_ids) ? opp.signal_ids : [],
            tokens: normalizeTokens(String(opp.title || ''))
          })).filter((opp: any) => opp.title);

          const matches: any[] = [];
          const llmOnly: any[] = [];
          const currentOnly: any[] = [];
          const matchedCurrent = new Set<string>();

          for (const llmOpp of llmOpps) {
            let bestMatch: any = null;
            let bestScore = 0;
            for (const curr of currentByTitle) {
              const score = tokenOverlapRatio(llmOpp.tokens, curr.tokens);
              if (score > bestScore) {
                bestScore = score;
                bestMatch = curr;
              }
            }
            if (bestMatch && bestScore >= 0.3) {
              matches.push({ llm: llmOpp, current: bestMatch, score: bestScore.toFixed(2) });
              matchedCurrent.add(bestMatch.id);
            } else {
              llmOnly.push(llmOpp);
            }
          }

          for (const curr of currentByTitle) {
            if (!matchedCurrent.has(curr.id)) {
              currentOnly.push(curr);
            }
          }

          progress.report({ increment: 95, message: 'Preparing report...' });
          const reportLines = [
            '# LLM Opportunity Comparison Report',
            '',
            `Signals analyzed: ${signals.length}`,
            `Current opportunities: ${opportunities.length}`,
            `LLM opportunities: ${llmOpps.length}`,
            'LLM output saved to: exports/llm_opportunities_<timestamp>.json',
            'LLM CSV saved to: exports/llm_opportunities_<timestamp>.csv',
            '',
            '## Matches (LLM ↔ Current)',
            matches.length
              ? matches.map((m: any) => `- ${m.llm.title} ↔ ${m.current.title} (score ${m.score})`).join('\n')
              : '- None',
            '',
            '## LLM-only opportunities',
            llmOnly.length
              ? llmOnly.map((m: any) => `- ${m.title}: ${m.description}`).join('\n')
              : '- None',
            '',
            '## Current-only opportunities',
            currentOnly.length
              ? currentOnly.map((m: any) => `- ${m.title}`).join('\n')
              : '- None'
          ];

          const doc = await vscode.workspace.openTextDocument({
            content: reportLines.join('\n'),
            language: 'markdown'
          });
          await vscode.window.showTextDocument(doc);

          progress.report({ increment: 100, message: 'Complete' });
        });
      } catch (error: any) {
        let errorMessage = error?.message || String(error);
        if (error?.name === 'AggregateError' || Array.isArray(error?.errors)) {
          const innerMessages = Array.from(error?.errors || []).map((inner: any) => inner?.message || String(inner));
          errorMessage = `AggregateError: ${innerMessages.filter(Boolean).join('; ') || 'Multiple errors'}`;
        }
        vscode.window.showErrorMessage(`Failed to compare opportunities: ${errorMessage}`);
        console.error('Compare LLM opportunities error:', error);
      }
    }
  );

  const selectLLMModelCommand = vscode.commands.registerCommand(
    'pm-intelligence.selectLLMModel',
    async () => {
      try {
        const lm = getCursorLm();

        if (!lm || typeof lm.selectChatModels !== 'function') {
          vscode.window.showErrorMessage('No LLM model selector available in this Cursor version.');
          return;
        }

        const models = await lm.selectChatModels();
        if (!models || models.length === 0) {
          vscode.window.showErrorMessage('No LLM models available in this Cursor environment.');
          return;
        }

        const listLines = models.map((m: any) => {
          return `- ${m.name} (vendor: ${m.vendor}, family: ${m.family}, version: ${m.version}, id: ${m.id})`;
        });
        const doc = await vscode.workspace.openTextDocument({
          content: ['# Available LLM Models', '', ...listLines].join('\n'),
          language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: false });

        const quickPickItems = models.map((m: any) => ({
          label: m.name || m.id,
          description: `${m.vendor} • ${m.family} • ${m.version}`,
          detail: m.id,
          modelId: m.id
        }));

        const sonnetIndex = models.findIndex((m: any) => {
          const haystack = `${m?.name || ''} ${m?.family || ''} ${m?.id || ''}`.toLowerCase();
          return haystack.includes('sonnet');
        });

        if (sonnetIndex >= 0) {
          (quickPickItems[sonnetIndex] as any).picked = true;
        } else if (quickPickItems.length > 0) {
          (quickPickItems[0] as any).picked = true;
        }

        const selected = await vscode.window.showQuickPick(quickPickItems as any[], {
          placeHolder: 'Select LLM model (default is Claude Sonnet if available)',
          ignoreFocusOut: true
        }) as any;

        if (!selected) {
          return;
        }

        selectedModelId = selected.modelId || null;
        await context.globalState.update('pm-intelligence.selectedModelId', selectedModelId);
        vscode.window.showInformationMessage(`Selected LLM model: ${selected.label}`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to list/select LLM models: ${error?.message || String(error)}`);
      }
    }
  );

  // Register Slack MCP commands (optional - lazy loaded)
  // Load Slack MCP commands asynchronously to avoid blocking activation
  (async () => {
    try {
      const slackModule = await import('./slack_mcp_commands');
      slackModule.registerSlackMCPCommands(context);
      console.log('Slack MCP commands registered successfully');
    } catch (slackError: any) {
      console.error('Failed to register Slack MCP commands (non-critical):', slackError?.message || String(slackError));
    }
  })();

  context.subscriptions.push(
    ingestSignalCommand,
    detectOpportunitiesCommand,
    createJudgmentCommand,
    createArtifactCommand,
    viewSignalsCommand,
    viewOpportunitiesCommand,
    viewMetricsCommand,
    compareLLMOpportunitiesCommand,
    selectLLMModelCommand
  );
}

export function deactivate() {
  // Cleanup if needed
}

