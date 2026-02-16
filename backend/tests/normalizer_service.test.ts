import { NormalizerService } from '../ingestion/normalizer_service';

describe('NormalizerService', () => {
  const normalizer = new NormalizerService();

  it('normalizes a valid signal', () => {
    const raw = normalizer.normalize({
      source: 'manual',
      content: 'Acme Corp reported an issue with FeatureX today.',
      metadata: { source_ref: 'test' }
    });
    expect(raw.id).toBeDefined();
    expect(raw.content).toContain('Acme Corp');
    expect(raw.content_hash).toBeDefined();
  });

  it('rejects invalid source', () => {
    expect(() =>
      normalizer.normalize({
        source: 'invalid_source',
        content: 'Some content that is long enough to pass validation.'
      })
    ).toThrow('Invalid source');
  });

  it('sanitizes HTML for web_scrape', () => {
    const raw = normalizer.normalize({
      source: 'web_scrape',
      content: '<script>alert(1)</script>Visible text',
      metadata: {}
    });
    expect(raw.content).toBe('Visible text');
  });
});
