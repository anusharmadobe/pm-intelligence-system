export interface FeatureDefinition {
  canonicalName: string;
  aliases?: string[];
  keywords?: string[];
}

export interface FeatureMatch {
  canonicalName: string;
  confidence: number;
}

const DEFAULT_FEATURES: FeatureDefinition[] = [
  {
    canonicalName: 'Forms Experience Builder',
    aliases: ['FEB', 'Experience Builder'],
    keywords: ['forms experience builder', 'feb', 'experience builder']
  },
  {
    canonicalName: 'Automated Forms Conversion',
    aliases: ['AFCS', 'Forms Conversion Service'],
    keywords: ['automated forms conversion', 'afcs', 'forms conversion service']
  },
  {
    canonicalName: 'IC Editor',
    aliases: ['Intelligent Capture Editor'],
    keywords: ['ic editor', 'intelligent capture editor']
  },
  {
    canonicalName: 'Core Components',
    aliases: ['AEM Core Components'],
    keywords: ['core component', 'core components', 'aem core components']
  },
  {
    canonicalName: 'Data Binding',
    aliases: ['Pre-fill', 'Prefill'],
    keywords: ['data binding', 'pre-filling', 'prefill', 'form pre-fill', 'pre-fill']
  },
  {
    canonicalName: 'Forms',
    aliases: ['Adaptive Forms', 'Acrobat Forms'],
    keywords: ['adaptive form', 'acrobat form', 'forms']
  }
];

export function getFeatureDefinitions(): FeatureDefinition[] {
  return DEFAULT_FEATURES;
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

export function matchFeatures(text: string): FeatureMatch[] {
  const normalizedText = normalizeValue(text);
  const matches: FeatureMatch[] = [];
  const seen = new Set<string>();

  for (const feature of DEFAULT_FEATURES) {
    const candidates = [
      feature.canonicalName,
      ...(feature.aliases || []),
      ...(feature.keywords || [])
    ]
      .filter(Boolean)
      .map(normalizeValue);

    const hasMatch = candidates.some(candidate => candidate && normalizedText.includes(candidate));
    if (hasMatch && !seen.has(feature.canonicalName)) {
      matches.push({ canonicalName: feature.canonicalName, confidence: 0.6 });
      seen.add(feature.canonicalName);
    }
  }

  if (matches.length > 1) {
    const hasSpecific = matches.some(match => match.canonicalName !== 'Forms');
    if (hasSpecific) {
      return matches.filter(match => match.canonicalName !== 'Forms');
    }
  }

  return matches;
}
