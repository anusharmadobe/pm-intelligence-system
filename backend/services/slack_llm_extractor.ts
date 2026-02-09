import { logger } from '../utils/logger';
import { LLMProvider } from './llm_service';
import { SlackLLMExtraction } from './slack_llm_extraction_service';
import { getFeatureDefinitions } from '../config/feature_dictionary';
import { getThemeDefinitions } from '../config/theme_dictionary';

export interface SlackSignalLike {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  created_at?: Date;
}

function buildPrompt(signal: SlackSignalLike): string {
  const features = getFeatureDefinitions().map(feature => feature.canonicalName);
  const themes = getThemeDefinitions().map(theme => theme.name);
  const metadata = signal.metadata || {};

  return `You are extracting structured product insights from a single Slack message.
Return ONLY valid JSON (no markdown), following this schema:
{
  "customers": [{"name": "string", "confidence": 0.0}],
  "features": [{"name": "string", "confidence": 0.0}],
  "themes": [{"name": "string", "confidence": 0.0}],
  "issues": [{"title": "string", "category": "string", "severity": 1, "confidence": 0.0}],
  "requests": [{"text": "string", "confidence": 0.0}]
}

Constraints:
- Use only evidence present in the message.
- If a field is unknown, return an empty array.
- Keep titles <= 140 characters.
- Use severity 1-5 if present in text; omit if not inferable.

Known features (use if applicable): ${features.join(', ')}
Known themes (use if applicable): ${themes.join(', ')}

Slack metadata (may contain customer names): ${JSON.stringify(metadata)}

Message:
${signal.content}
`;
}

function cleanJsonResponse(response: string): string {
  const trimmed = response.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : trimmed;
}

function normalizeExtraction(raw: any): SlackLLMExtraction {
  const toArray = (value: any) => (Array.isArray(value) ? value : []);
  const clampConfidence = (value: any, fallback: number) => {
    const numeric = typeof value === 'number' ? value : fallback;
    return Math.max(0, Math.min(1, numeric));
  };

  return {
    customers: toArray(raw.customers).map((entry: any) => ({
      name: String(entry?.name || '').trim(),
      confidence: clampConfidence(entry?.confidence, 0.7)
    })).filter((entry: any) => entry.name),
    features: toArray(raw.features).map((entry: any) => ({
      name: String(entry?.name || '').trim(),
      confidence: clampConfidence(entry?.confidence, 0.6)
    })).filter((entry: any) => entry.name),
    themes: toArray(raw.themes).map((entry: any) => ({
      name: String(entry?.name || '').trim(),
      confidence: clampConfidence(entry?.confidence, 0.5)
    })).filter((entry: any) => entry.name),
    issues: toArray(raw.issues).map((entry: any) => ({
      title: String(entry?.title || '').trim().slice(0, 140),
      category: entry?.category ? String(entry.category).trim() : 'uncategorized',
      severity: typeof entry?.severity === 'number' ? entry.severity : undefined,
      confidence: clampConfidence(entry?.confidence, 0.6)
    })).filter((entry: any) => entry.title),
    requests: toArray(raw.requests).map((entry: any) => ({
      text: String(entry?.text || '').trim(),
      confidence: clampConfidence(entry?.confidence, 0.5)
    })).filter((entry: any) => entry.text)
  };
}

export async function extractSlackSignalWithLLM(
  signal: SlackSignalLike,
  llmProvider: LLMProvider
): Promise<SlackLLMExtraction> {
  const prompt = buildPrompt(signal);
  const response = await llmProvider(prompt);

  try {
    const cleaned = cleanJsonResponse(response);
    const parsed = JSON.parse(cleaned);
    return normalizeExtraction(parsed);
  } catch (error: any) {
    logger.warn('Failed to parse LLM extraction response', {
      signalId: signal.id,
      error: error?.message || String(error)
    });
    throw new Error('LLM extraction response was invalid JSON.');
  }
}
