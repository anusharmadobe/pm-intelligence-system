import { fuzzyCustomerMatch, resolveToCanonicalName } from '../utils/text_processing';

describe('fuzzyCustomerMatch', () => {
  it('matches normalized customer names', () => {
    expect(fuzzyCustomerMatch('Acme Inc.', 'Acme')).toBe(true);
    expect(fuzzyCustomerMatch('Acme, LLC', 'acme')).toBe(true);
  });

  it('respects threshold for unrelated names', () => {
    expect(fuzzyCustomerMatch('Alpha Systems', 'Omega Widgets')).toBe(false);
  });
});

describe('resolveToCanonicalName', () => {
  it('resolves known aliases and typos', () => {
    expect(resolveToCanonicalName('Charles Shwab')).toBe('Charles Schwab');
    expect(resolveToCanonicalName('Brusnwick')).toBe('Brunswick');
    expect(resolveToCanonicalName('Abbvie')).toBe('AbbVie');
    expect(resolveToCanonicalName('UPS.com')).toBe('UPS');
    expect(resolveToCanonicalName('LPL financial')).toBe('LPL Financial');
  });

  it('returns cleaned input for unknown names', () => {
    expect(resolveToCanonicalName('Acme Widgets')).toBe('Acme Widgets');
    expect(resolveToCanonicalName('  Acme   Widgets  ')).toBe('Acme Widgets');
  });

  it('handles empty input', () => {
    expect(resolveToCanonicalName('')).toBe('');
    expect(resolveToCanonicalName('   ')).toBe('');
  });
});
