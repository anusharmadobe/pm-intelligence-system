/**
 * Configurable entity definitions for customer names and topic keywords.
 * This allows easy extension without code changes.
 */

export interface CustomerDefinition {
  /** Primary name */
  name: string;
  /** Alternative names/variations */
  aliases?: string[];
  /** Whether to match case-insensitively */
  caseSensitive?: boolean;
}

export interface TopicDefinition {
  /** Topic name */
  name: string;
  /** Keywords that match this topic */
  keywords: string[];
  /** Priority (higher = more specific, checked first) */
  priority?: number;
}

/**
 * Known customers - can be extended or loaded from database/config file.
 */
export const KNOWN_CUSTOMERS: CustomerDefinition[] = [
  {
    name: 'NFCU',
    aliases: ['Navy Federal Credit Union', 'Navy Federal'],
    caseSensitive: false
  },
  {
    name: 'IRS',
    aliases: ['Internal Revenue Service', 'IRS/Accenture Federal', 'IRS/DMAF'],
    caseSensitive: false
  },
  {
    name: 'LPL Financial',
    aliases: ['LPL', 'LPL Financials', 'LPL financial'],
    caseSensitive: false
  },
  {
    name: 'Clark County',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Adobe',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'AbbVie',
    aliases: ['Abbvie', 'ABBVIE'],
    caseSensitive: false
  },
  {
    name: 'Accenture',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Altec',
    aliases: ['Aftia', 'Aftia (altec)', 'Altec (partner: Aftia)'],
    caseSensitive: false
  },
  {
    name: 'Arneh',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Assured Edge Income Protector',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'BrightLine',
    aliases: ['Brightline', 'brightline'],
    caseSensitive: false
  },
  {
    name: 'Brunswick',
    aliases: ['Brusnwick'],
    caseSensitive: false
  },
  {
    name: 'Busch Group',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Carpenter',
    aliases: ['Carpenter (Partner : 4 Point )'],
    caseSensitive: false
  },
  {
    name: 'Charles Schwab',
    aliases: ['Charles Shwab', 'Schwab', 'Shwab'],
    caseSensitive: false
  },
  {
    name: 'Continental Tires',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Corebridge Financial',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Fidelity Stock Plan Services',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Ford',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'GM Financial',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Jet2',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'KrisShop',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Lumen',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Macquarie',
    aliases: ['Macquarie | Global Credential Pack', 'Oppty: Macquarie | Global Credential Pack'],
    caseSensitive: false
  },
  {
    name: 'Maurice Blackburn',
    aliases: ['mauriceblackburn.com.au'],
    caseSensitive: false
  },
  {
    name: 'Max Income Comparison',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Micron',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'NFL',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Nedbank',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Shred-it',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'SmartDoc Technologies',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Spark NZ',
    aliases: ['Spark'],
    caseSensitive: false
  },
  {
    name: 'State of Pennsylvania',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Stericycle',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'Toyota Financial Services',
    aliases: [],
    caseSensitive: false
  },
  {
    name: 'UPS',
    aliases: ['UPS.com'],
    caseSensitive: false
  },
  {
    name: 'Verizon',
    aliases: [],
    caseSensitive: false
  },
  {
    name: '4Point',
    aliases: ['4point', '4 Point'],
    caseSensitive: false
  }
];

/**
 * Topic definitions with keywords - can be extended or loaded from database/config file.
 * Ordered by priority (higher priority = more specific, checked first).
 */
export const TOPIC_DEFINITIONS: TopicDefinition[] = [
  {
    name: 'Forms Experience Builder',
    keywords: ['forms experience builder', 'feb', 'experience builder'],
    priority: 10
  },
  {
    name: 'Automated Forms Conversion',
    keywords: ['automated forms conversion', 'afcs', 'forms conversion service'],
    priority: 9
  },
  {
    name: 'IC Editor',
    keywords: ['ic editor', 'intelligent capture editor'],
    priority: 8
  },
  {
    name: 'Core Components',
    keywords: ['core component', 'core components', 'aem core components'],
    priority: 7
  },
  {
    name: 'Data Binding',
    keywords: ['data binding', 'pre-filling', 'prefill', 'form pre-fill', 'pre-fill'],
    priority: 6
  },
  {
    name: 'Forms',
    keywords: ['form', 'forms', 'adaptive form', 'acrobat form'],
    priority: 5
  },
  {
    name: 'Customer Meeting',
    keywords: ['customer meeting', 'customer call', 'customer sync', 'customer sync up'],
    priority: 4
  },
  {
    name: 'Go-Live',
    keywords: ['go-live', 'went live', 'golive', 'deployment', 'production deployment'],
    priority: 3
  },
  {
    name: 'Feature Request',
    keywords: ['requirement', 'need', 'want', 'request', 'feature request', 'would like'],
    priority: 2
  },
  {
    name: 'Issue/Blocker',
    keywords: ['issue', 'problem', 'blocked', 'fail', 'error', 'bug', 'broken'],
    priority: 1
  }
].sort((a, b) => (b.priority || 0) - (a.priority || 0)); // Sort by priority descending

/**
 * Get all customer names (including aliases) for matching.
 */
export function getAllCustomerNames(): string[] {
  const names: string[] = [];
  for (const customer of KNOWN_CUSTOMERS) {
    names.push(customer.name);
    if (customer.aliases) {
      names.push(...customer.aliases);
    }
  }
  return names;
}

/**
 * Get topic keywords ordered by priority.
 */
export function getTopicKeywords(): Array<{ topic: string; keywords: string[]; priority: number }> {
  return TOPIC_DEFINITIONS.map(def => ({
    topic: def.name,
    keywords: def.keywords,
    priority: def.priority || 0
  }));
}
