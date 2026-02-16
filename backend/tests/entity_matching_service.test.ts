import { EntityMatchingService } from '../services/entity_matching_service';

describe('EntityMatchingService', () => {
  const service = new EntityMatchingService();

  it('returns high similarity for close matches', () => {
    const score = service.score({
      nameA: 'Acme Corp',
      nameB: 'Acme Corporation',
      embeddingSimilarity: 0.92,
      typeMatch: true
    });

    expect(score.string_similarity).toBeGreaterThan(0.7);
    expect(score.composite_score).toBeGreaterThan(0.75);
  });

  it('returns low similarity for unrelated entities', () => {
    const score = service.score({
      nameA: 'Acme Corp',
      nameB: 'Northern Lights Analytics',
      embeddingSimilarity: 0.1,
      typeMatch: true
    });

    expect(score.composite_score).toBeLessThan(0.5);
  });
});
