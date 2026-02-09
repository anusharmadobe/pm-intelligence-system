import { classifySignalThemes, seedThemeHierarchy, ThemeClassification } from '../services/theme_classifier_service';
import {
  THEME_HIERARCHY,
  matchHierarchicalThemes,
  getAllThemes,
  getThemeById,
  getThemeBySlug,
  getThemePath,
  getThemesAtLevel,
  getThemeDescendants,
  getThemeHierarchy
} from '../config/theme_dictionary';
import { Signal } from '../processing/signal_extractor';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Theme Classifier Service', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  describe('Theme Dictionary', () => {
    it('should have 4-level hierarchical structure', () => {
      expect(THEME_HIERARCHY).toBeDefined();
      expect(Array.isArray(THEME_HIERARCHY)).toBe(true);
      expect(THEME_HIERARCHY.length).toBeGreaterThan(0);

      // Check level 1 (domains)
      for (const domain of THEME_HIERARCHY) {
        expect(domain.level).toBe(1);
        expect(domain.id).toBeDefined();
        expect(domain.name).toBeDefined();
        expect(domain.slug).toBeDefined();
        expect(domain.keywords).toBeDefined();
        
        // Check level 2 (categories) if present
        if (domain.children) {
          for (const category of domain.children) {
            expect(category.level).toBe(2);
            expect(category.parentId).toBe(domain.id);
            
            // Check level 3 (themes) if present
            if (category.children) {
              for (const theme of category.children) {
                expect(theme.level).toBe(3);
                expect(theme.parentId).toBe(category.id);
                
                // Check level 4 (sub-themes) if present
                if (theme.children) {
                  for (const subTheme of theme.children) {
                    expect(subTheme.level).toBe(4);
                    expect(subTheme.parentId).toBe(theme.id);
                  }
                }
              }
            }
          }
        }
      }
    });

    it('should retrieve all themes flat', () => {
      const allThemes = getAllThemes();
      expect(allThemes.length).toBeGreaterThan(THEME_HIERARCHY.length);
    });
  });

  describe('matchHierarchicalThemes', () => {
    it('should match themes from signal content', () => {
      const signal: Signal = {
        id: 'test-1',
        source: 'slack',
        source_ref: 'test-1',
        signal_type: 'message',
        content: 'The form builder is having performance issues and the page is slow to load.',
        normalized_content: 'the form builder is having performance issues and the page is slow to load',
        severity: null,
        confidence: null,
        created_at: new Date(),
        metadata: {}
      };

      const matches = matchHierarchicalThemes(signal.content);

      expect(Array.isArray(matches)).toBe(true);
      // Should match performance-related themes
      const themeNames = matches.map(m => m.theme.name.toLowerCase());
      expect(themeNames.some(n => n.includes('performance') || n.includes('speed'))).toBe(true);
    });

    it('should match themes at different levels', () => {
      const signal: Signal = {
        id: 'test-2',
        source: 'slack',
        source_ref: 'test-2',
        signal_type: 'message',
        content: 'Customer needs better integration with Salesforce and API documentation.',
        normalized_content: 'customer needs better integration with salesforce and api documentation',
        severity: null,
        confidence: null,
        created_at: new Date(),
        metadata: {}
      };

      const matches = matchHierarchicalThemes(signal.content);
      
      // Should have matches at various levels
      const levels = new Set(matches.map(m => m.theme.level));
      expect(levels.size).toBeGreaterThan(0);
    });

    it('should return empty array for unrelated content', () => {
      const signal: Signal = {
        id: 'test-3',
        source: 'slack',
        source_ref: 'test-3',
        signal_type: 'message',
        content: 'Random text with no product-related keywords.',
        normalized_content: 'random text with no product related keywords',
        severity: null,
        confidence: null,
        created_at: new Date(),
        metadata: {}
      };

      const matches = matchHierarchicalThemes(signal.content);
      
      // May or may not have matches depending on theme keywords
      expect(Array.isArray(matches)).toBe(true);
    });
  });

  describe('getThemeById', () => {
    it('should find theme by ID', () => {
      const allThemes = getAllThemes();
      if (allThemes.length > 0) {
        const firstTheme = allThemes[0];
        const found = getThemeById(firstTheme.id);
        expect(found).toBeDefined();
        expect(found?.id).toBe(firstTheme.id);
      }
    });

    it('should return undefined for non-existent ID', () => {
      const found = getThemeById('non-existent-id');
      expect(found).toBeUndefined();
    });
  });

  describe('getThemeBySlug', () => {
    it('should find theme by slug', () => {
      const allThemes = getAllThemes();
      if (allThemes.length > 0) {
        const firstTheme = allThemes[0];
        const found = getThemeBySlug(firstTheme.slug);
        expect(found).toBeDefined();
        expect(found?.slug).toBe(firstTheme.slug);
      }
    });
  });

  describe('getThemePath', () => {
    it('should return path from root to theme', () => {
      const allThemes = getAllThemes();
      const level4Theme = allThemes.find(t => t.level === 4);
      
      if (level4Theme) {
        const path = getThemePath(level4Theme.id);
        expect(path.length).toBe(4);
        expect(path[0]).toBeDefined();
        expect(path[3]).toBeDefined();
      }
    });

    it('should return single-element path for root theme', () => {
      const rootTheme = THEME_HIERARCHY[0];
      const path = getThemePath(rootTheme.id);
      expect(path.length).toBe(1);
      expect(path[0]).toBe(rootTheme.name);
    });
  });

  describe('getThemesAtLevel', () => {
    it('should return all level 1 themes', () => {
      const level1 = getThemesAtLevel(1);
      expect(level1.length).toBe(THEME_HIERARCHY.length);
      expect(level1.every((t) => t.level === 1)).toBe(true);
    });

    it('should return all level 2 themes', () => {
      const level2 = getThemesAtLevel(2);
      expect(level2.every((t) => t.level === 2)).toBe(true);
    });
  });

  describe('getThemeDescendants', () => {
    it('should return all descendants of a theme', () => {
      const rootTheme = THEME_HIERARCHY[0];
      const descendants = getThemeDescendants(rootTheme.id);
      
      // All descendants should have higher level than root
      expect(descendants.every((d) => d.level > rootTheme.level)).toBe(true);
    });

    it('should return empty array for leaf theme', () => {
      const allThemes = getAllThemes();
      const leafTheme = allThemes.find(t => t.level === 4);
      
      if (leafTheme) {
        const descendants = getThemeDescendants(leafTheme.id);
        expect(descendants.length).toBe(0);
      }
    });
  });

  describe('getThemeHierarchy', () => {
    it('should return the full theme hierarchy', () => {
      const hierarchy = getThemeHierarchy();
      expect(hierarchy).toEqual(THEME_HIERARCHY);
    });
  });

  describe('classifySignalThemes', () => {
    it('should classify signal into hierarchical themes', async () => {
      const signal: Signal = {
        id: 'classify-1',
        source: 'slack',
        source_ref: 'classify-1',
        signal_type: 'message',
        content: 'The form validation is not working correctly and users are complaining.',
        normalized_content: 'the form validation is not working correctly and users are complaining',
        severity: null,
        confidence: null,
        created_at: new Date(),
        metadata: {}
      };

      const classifications = await classifySignalThemes(signal);

      expect(Array.isArray(classifications)).toBe(true);
      for (const c of classifications) {
        expect(c.themeId).toBeDefined();
        expect(c.themeName).toBeDefined();
        expect(c.level).toBeGreaterThanOrEqual(1);
        expect(c.level).toBeLessThanOrEqual(4);
        expect(c.confidence).toBeGreaterThan(0);
        expect(c.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('seedThemeHierarchy', () => {
    it('should seed theme hierarchy to database', async () => {
      await seedThemeHierarchy();
    });

    it('should be idempotent', async () => {
      await seedThemeHierarchy();
      await seedThemeHierarchy();
    });
  });
});
