import { extractSlackSignalWithLLM } from '../services/slack_llm_extractor';
import { LLMProvider } from '../services/llm_service';

describe('Slack LLM extractor', () => {
  it('parses a valid JSON extraction response', async () => {
    const provider: LLMProvider = async () => JSON.stringify({
      customers: [{ name: 'Adobe', confidence: 0.9 }],
      features: [{ name: 'Forms Experience Builder', confidence: 0.8 }],
      themes: [{ name: 'Migration', confidence: 0.7 }],
      issues: [{ title: 'Blocked on migration path', category: 'blocker', severity: 5, confidence: 0.8 }],
      requests: [{ text: 'Provide migration checklist', confidence: 0.6 }]
    });

    const extraction = await extractSlackSignalWithLLM(
      { id: 'signal-1', content: 'Sample message' },
      provider
    );

    expect(extraction.customers?.[0].name).toBe('Adobe');
    expect(extraction.features?.[0].name).toBe('Forms Experience Builder');
    expect(extraction.themes?.[0].name).toBe('Migration');
    expect(extraction.issues?.[0].category).toBe('blocker');
    expect(extraction.requests?.[0].text).toBe('Provide migration checklist');
  });

  it('throws on invalid JSON', async () => {
    const provider: LLMProvider = async () => 'not-json';

    await expect(
      extractSlackSignalWithLLM({ id: 'signal-2', content: 'Sample' }, provider)
    ).rejects.toThrow('LLM extraction response was invalid JSON.');
  });
});
