import { matchFeatures } from '../config/feature_dictionary';

describe('feature dictionary', () => {
  it('matches canonical feature names', () => {
    const matches = matchFeatures('We rely on Forms Experience Builder for onboarding');
    expect(matches.map(match => match.canonicalName)).toContain('Forms Experience Builder');
  });

  it('matches feature aliases and keywords', () => {
    const matches = matchFeatures('Issue with feb and automated forms conversion');
    const names = matches.map(match => match.canonicalName);
    expect(names).toContain('Forms Experience Builder');
    expect(names).toContain('Automated Forms Conversion');
  });

  it('avoids generic Forms when a specific match exists', () => {
    const matches = matchFeatures('Forms Experience Builder is blocked today');
    const names = matches.map(match => match.canonicalName);
    expect(names).toContain('Forms Experience Builder');
    expect(names).not.toContain('Forms');
  });

  it('returns empty array when no features found', () => {
    const matches = matchFeatures('Nothing product related in this sentence');
    expect(matches).toEqual([]);
  });
});
