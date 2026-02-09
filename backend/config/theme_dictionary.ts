/**
 * Flat theme definition (legacy, for backward compatibility)
 */
export interface ThemeDefinition {
  name: string;
  keywords: string[];
}

/**
 * Hierarchical theme structure (4 levels)
 */
export interface HierarchicalTheme {
  id: string;
  name: string;
  slug: string;
  level: 1 | 2 | 3 | 4;
  parentId?: string;
  keywords: string[];
  description?: string;
  priority?: number;
  children?: HierarchicalTheme[];
}

/**
 * Theme match result with hierarchy path
 */
export interface ThemeMatch {
  theme: HierarchicalTheme;
  path: string[];  // Full path from L1 to matched theme
  confidence: number;
  matchedKeywords: string[];
}

/**
 * 4-Level Theme Hierarchy
 * 
 * L1: Domain - Top-level categorization
 * L2: Category - Major grouping within domain
 * L3: Theme - Specific functional area (maps to legacy themes)
 * L4: Sub-theme - Granular topic or feature
 */
export const THEME_HIERARCHY: HierarchicalTheme[] = [
  {
    id: 'product-capabilities',
    name: 'Product Capabilities',
    slug: 'product-capabilities',
    level: 1,
    keywords: [],
    description: 'Core product features and functionality',
    priority: 10,
    children: [
      {
        id: 'user-experience',
        name: 'User Experience',
        slug: 'user-experience',
        level: 2,
        parentId: 'product-capabilities',
        keywords: ['ux', 'ui', 'usability', 'user experience'],
        priority: 9,
        children: [
          {
            id: 'authoring-ux',
            name: 'Authoring UX',
            slug: 'authoring-ux',
            level: 3,
            parentId: 'user-experience',
            keywords: ['author', 'authoring', 'editor', 'canvas', 'visual editor'],
            priority: 8,
            children: [
              {
                id: 'forms-experience-builder',
                name: 'Forms Experience Builder',
                slug: 'forms-experience-builder',
                level: 4,
                parentId: 'authoring-ux',
                keywords: ['feb', 'experience builder', 'forms builder', 'visual authoring'],
                priority: 7
              },
              {
                id: 'ic-editor',
                name: 'IC Editor',
                slug: 'ic-editor',
                level: 4,
                parentId: 'authoring-ux',
                keywords: ['ic editor', 'intelligent capture', 'ic authoring'],
                priority: 6
              },
              {
                id: 'rule-editor',
                name: 'Rule Editor',
                slug: 'rule-editor',
                level: 4,
                parentId: 'authoring-ux',
                keywords: ['rule editor', 'business rules', 'conditional logic'],
                priority: 5
              }
            ]
          },
          {
            id: 'rendering-pdf',
            name: 'Rendering & PDF',
            slug: 'rendering-pdf',
            level: 3,
            parentId: 'user-experience',
            keywords: ['render', 'pdf', 'output service', 'document of record', 'dor'],
            priority: 8,
            children: [
              {
                id: 'pdf-generation',
                name: 'PDF Generation',
                slug: 'pdf-generation',
                level: 4,
                parentId: 'rendering-pdf',
                keywords: ['pdf generation', 'generate pdf', 'pdf output'],
                priority: 7
              },
              {
                id: 'pre-rendering',
                name: 'Pre-rendering',
                slug: 'pre-rendering',
                level: 4,
                parentId: 'rendering-pdf',
                keywords: ['pre-render', 'pre-rendering', 'preview'],
                priority: 6
              },
              {
                id: 'pdf-accessibility',
                name: 'PDF Accessibility',
                slug: 'pdf-accessibility',
                level: 4,
                parentId: 'rendering-pdf',
                keywords: ['accessible pdf', 'tagged pdf', 'accessibility', 'wcag'],
                priority: 6
              }
            ]
          }
        ]
      },
      {
        id: 'data-management',
        name: 'Data Management',
        slug: 'data-management',
        level: 2,
        parentId: 'product-capabilities',
        keywords: ['data', 'form data', 'data model'],
        priority: 8,
        children: [
          {
            id: 'data-binding',
            name: 'Data Binding',
            slug: 'data-binding',
            level: 3,
            parentId: 'data-management',
            keywords: ['data binding', 'prefill', 'pre-fill', 'json data', 'schema'],
            priority: 7,
            children: [
              {
                id: 'fdm',
                name: 'Form Data Model',
                slug: 'fdm',
                level: 4,
                parentId: 'data-binding',
                keywords: ['fdm', 'form data model', 'data source'],
                priority: 6
              },
              {
                id: 'prefill-service',
                name: 'Prefill Service',
                slug: 'prefill-service',
                level: 4,
                parentId: 'data-binding',
                keywords: ['prefill', 'pre-fill', 'prepopulate'],
                priority: 5
              },
              {
                id: 'schema-binding',
                name: 'Schema Binding',
                slug: 'schema-binding',
                level: 4,
                parentId: 'data-binding',
                keywords: ['xsd', 'schema binding', 'json schema'],
                priority: 5
              }
            ]
          }
        ]
      },
      {
        id: 'platform-services',
        name: 'Platform Services',
        slug: 'platform-services',
        level: 2,
        parentId: 'product-capabilities',
        keywords: ['platform', 'services', 'cloud'],
        priority: 8,
        children: [
          {
            id: 'integrations',
            name: 'Integrations',
            slug: 'integrations',
            level: 3,
            parentId: 'platform-services',
            keywords: ['integration', 'connector', 'api', 'webhook'],
            priority: 7,
            children: [
              {
                id: 'marketo-integration',
                name: 'Marketo Integration',
                slug: 'marketo-integration',
                level: 4,
                parentId: 'integrations',
                keywords: ['marketo', 'marketo connector'],
                priority: 6
              },
              {
                id: 'workfront-integration',
                name: 'Workfront Integration',
                slug: 'workfront-integration',
                level: 4,
                parentId: 'integrations',
                keywords: ['workfront', 'workfront connector'],
                priority: 6
              },
              {
                id: 'rest-apis',
                name: 'REST APIs',
                slug: 'rest-apis',
                level: 4,
                parentId: 'integrations',
                keywords: ['rest api', 'api endpoint', 'rest service'],
                priority: 5
              }
            ]
          },
          {
            id: 'migration',
            name: 'Migration',
            slug: 'migration',
            level: 3,
            parentId: 'platform-services',
            keywords: ['migration', 'convert', 'conversion', 'legacy'],
            priority: 7,
            children: [
              {
                id: 'xdp-conversion',
                name: 'XDP Conversion',
                slug: 'xdp-conversion',
                level: 4,
                parentId: 'migration',
                keywords: ['xdp', 'xdp conversion', 'xdp to af'],
                priority: 6
              },
              {
                id: 'afcs',
                name: 'Automated Forms Conversion',
                slug: 'afcs',
                level: 4,
                parentId: 'migration',
                keywords: ['afcs', 'automated forms conversion', 'auto conversion'],
                priority: 6
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'quality-attributes',
    name: 'Quality Attributes',
    slug: 'quality-attributes',
    level: 1,
    keywords: [],
    description: 'Non-functional requirements and system qualities',
    priority: 9,
    children: [
      {
        id: 'performance',
        name: 'Performance',
        slug: 'performance',
        level: 2,
        parentId: 'quality-attributes',
        keywords: ['slow', 'latency', 'timeout', 'performance', 'speed', 'fast'],
        priority: 8,
        children: [
          {
            id: 'load-time',
            name: 'Load Time',
            slug: 'load-time',
            level: 3,
            parentId: 'performance',
            keywords: ['load time', 'page load', 'initial load'],
            priority: 7
          },
          {
            id: 'response-time',
            name: 'Response Time',
            slug: 'response-time',
            level: 3,
            parentId: 'performance',
            keywords: ['response time', 'api latency', 'slow response'],
            priority: 7
          }
        ]
      },
      {
        id: 'reliability',
        name: 'Reliability',
        slug: 'reliability',
        level: 2,
        parentId: 'quality-attributes',
        keywords: ['error', 'failure', 'crash', 'bug', 'broken', 'downtime'],
        priority: 8,
        children: [
          {
            id: 'error-handling',
            name: 'Error Handling',
            slug: 'error-handling',
            level: 3,
            parentId: 'reliability',
            keywords: ['error handling', 'exception', 'error message'],
            priority: 7
          },
          {
            id: 'availability',
            name: 'Availability',
            slug: 'availability',
            level: 3,
            parentId: 'reliability',
            keywords: ['uptime', 'downtime', 'availability', 'outage'],
            priority: 7
          }
        ]
      },
      {
        id: 'security-compliance',
        name: 'Security & Compliance',
        slug: 'security-compliance',
        level: 2,
        parentId: 'quality-attributes',
        keywords: ['pii', 'security', 'compliance', 'encryption', 'access-control', 'gdpr'],
        priority: 8,
        children: [
          {
            id: 'data-privacy',
            name: 'Data Privacy',
            slug: 'data-privacy',
            level: 3,
            parentId: 'security-compliance',
            keywords: ['pii', 'privacy', 'gdpr', 'data protection'],
            priority: 7
          },
          {
            id: 'access-control',
            name: 'Access Control',
            slug: 'access-control',
            level: 3,
            parentId: 'security-compliance',
            keywords: ['access control', 'permissions', 'authentication', 'authorization'],
            priority: 7
          }
        ]
      }
    ]
  }
];

/**
 * Flattened theme index for quick lookups
 */
const THEME_INDEX: Map<string, HierarchicalTheme> = new Map();
const THEME_BY_SLUG: Map<string, HierarchicalTheme> = new Map();

function buildThemeIndex(themes: HierarchicalTheme[]): void {
  for (const theme of themes) {
    THEME_INDEX.set(theme.id, theme);
    THEME_BY_SLUG.set(theme.slug, theme);
    if (theme.children) {
      buildThemeIndex(theme.children);
    }
  }
}

// Build index on module load
buildThemeIndex(THEME_HIERARCHY);

/**
 * Legacy flat theme definitions for backward compatibility
 */
const THEME_DEFINITIONS: ThemeDefinition[] = [
  { name: 'Authoring UX', keywords: ['author', 'authoring', 'editor', 'canvas', 'ui', 'ux', 'usability'] },
  { name: 'Integrations', keywords: ['integration', 'connector', 'marketo', 'workfront', 'mulesoft', 'api', 'webhook'] },
  { name: 'Data Binding', keywords: ['data binding', 'prefill', 'pre-fill', 'json data', 'schema', 'fdm'] },
  { name: 'Rendering & PDF', keywords: ['render', 'pdf', 'output service', 'document of record', 'dor'] },
  { name: 'Performance', keywords: ['slow', 'latency', 'timeout', 'performance'] },
  { name: 'Reliability', keywords: ['error', 'failure', 'crash', 'bug', 'broken'] },
  { name: 'Security & Compliance', keywords: ['pii', 'security', 'compliance', 'encryption', 'access-control'] },
  { name: 'Migration', keywords: ['migration', 'convert', 'conversion', 'legacy', 'xdp'] }
];

/**
 * Legacy: Match themes using flat structure (backward compatible)
 */
export function matchThemes(text: string): ThemeDefinition[] {
  const normalized = text.toLowerCase();
  const matches: ThemeDefinition[] = [];

  for (const theme of THEME_DEFINITIONS) {
    if (theme.keywords.some(keyword => normalized.includes(keyword))) {
      matches.push(theme);
    }
  }

  return matches;
}

/**
 * Legacy: Get flat theme definitions
 */
export function getThemeDefinitions(): ThemeDefinition[] {
  return THEME_DEFINITIONS;
}

/**
 * Match themes using hierarchical structure
 * Returns matches at all levels with full path
 */
export function matchHierarchicalThemes(text: string): ThemeMatch[] {
  const normalized = text.toLowerCase();
  const matches: ThemeMatch[] = [];

  function searchTheme(theme: HierarchicalTheme, path: string[]): void {
    const currentPath = [...path, theme.name];
    const matchedKeywords = theme.keywords.filter(kw => normalized.includes(kw.toLowerCase()));
    
    if (matchedKeywords.length > 0) {
      // Calculate confidence based on keyword matches and specificity
      const keywordScore = matchedKeywords.length / theme.keywords.length;
      const levelBonus = theme.level * 0.1; // Prefer more specific matches
      const confidence = Math.min(0.95, keywordScore * 0.7 + levelBonus);
      
      matches.push({
        theme,
        path: currentPath,
        confidence,
        matchedKeywords
      });
    }
    
    // Search children
    if (theme.children) {
      for (const child of theme.children) {
        searchTheme(child, currentPath);
      }
    }
  }

  for (const rootTheme of THEME_HIERARCHY) {
    searchTheme(rootTheme, []);
  }

  // Sort by confidence (highest first), then by level (most specific first)
  return matches.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return b.theme.level - a.theme.level;
  });
}

/**
 * Get theme by ID
 */
export function getThemeById(id: string): HierarchicalTheme | undefined {
  return THEME_INDEX.get(id);
}

/**
 * Get theme by slug
 */
export function getThemeBySlug(slug: string): HierarchicalTheme | undefined {
  return THEME_BY_SLUG.get(slug);
}

/**
 * Get full path for a theme
 */
export function getThemePath(themeId: string): string[] {
  const path: string[] = [];
  let current = THEME_INDEX.get(themeId);
  
  while (current) {
    path.unshift(current.name);
    current = current.parentId ? THEME_INDEX.get(current.parentId) : undefined;
  }
  
  return path;
}

/**
 * Get all themes at a specific level
 */
export function getThemesAtLevel(level: 1 | 2 | 3 | 4): HierarchicalTheme[] {
  const themes: HierarchicalTheme[] = [];
  
  for (const theme of THEME_INDEX.values()) {
    if (theme.level === level) {
      themes.push(theme);
    }
  }
  
  return themes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/**
 * Get children of a theme
 */
export function getThemeChildren(parentId: string): HierarchicalTheme[] {
  const parent = THEME_INDEX.get(parentId);
  return parent?.children || [];
}

/**
 * Get all descendant themes (recursive)
 */
export function getThemeDescendants(parentId: string): HierarchicalTheme[] {
  const descendants: HierarchicalTheme[] = [];
  
  function collectDescendants(theme: HierarchicalTheme): void {
    if (theme.children) {
      for (const child of theme.children) {
        descendants.push(child);
        collectDescendants(child);
      }
    }
  }
  
  const parent = THEME_INDEX.get(parentId);
  if (parent) {
    collectDescendants(parent);
  }
  
  return descendants;
}

/**
 * Get the full theme hierarchy
 */
export function getThemeHierarchy(): HierarchicalTheme[] {
  return THEME_HIERARCHY;
}

/**
 * Get all themes as flat list
 */
export function getAllThemes(): HierarchicalTheme[] {
  return Array.from(THEME_INDEX.values());
}
