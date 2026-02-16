import { logger } from '../utils/logger';
import { LLMProvider, createLLMProviderFromEnv } from './llm_service';

export interface CanonicalEntity {
  id: string;
  canonical_name: string;
  entity_type: string;
  aliases: string[];
}

export interface EntityMatchResult {
  matchedEntityId: string | null;
  confidence: number;
  reasoning: string;
  suggestedAliases: string[];
}

export interface CanonicalFormResult {
  canonicalName: string;
  confidence: number;
}

export interface EntityTypeResult {
  entityType: 'customer' | 'feature' | 'issue' | 'theme';
  confidence: number;
  reasoning: string;
}

export interface AliasGenerationResult {
  aliases: string[];
  reasoning: string;
}

/**
 * LLM-powered entity matching service
 * Uses LLM reasoning for robust entity resolution without regex
 */
export class LLMEntityMatcher {
  private llmProvider: LLMProvider | null = null;

  constructor() {
    try {
      this.llmProvider = createLLMProviderFromEnv();
    } catch (error) {
      logger.error('LLM Entity Matcher initialization failed', { error });
      throw new Error('LLM provider is required for entity matching. Check LLM configuration.');
    }
  }

  /**
   * Match entity mention to candidates using LLM reasoning
   * @param mention - Entity mention from signal (e.g., "MSFT", "Microsoft Corp")
   * @param candidates - List of canonical entities to match against
   * @param context - Signal text for context
   * @returns Best match with confidence + reasoning
   */
  async matchEntity(
    mention: string,
    candidates: CanonicalEntity[],
    context: string
  ): Promise<EntityMatchResult> {
    if (!this.llmProvider) {
      throw new Error('LLM provider not available');
    }

    if (candidates.length === 0) {
      return {
        matchedEntityId: null,
        confidence: 0,
        reasoning: 'No candidates provided',
        suggestedAliases: []
      };
    }

    const candidatesText = candidates.map((c, i) =>
      `${i + 1}. ${c.canonical_name} (type: ${c.entity_type}, aliases: ${c.aliases.join(', ') || 'none'})`
    ).join('\n');

    const prompt = `You are an entity resolution expert for a PM intelligence system.

Task: Match the entity mention to one of the candidate entities, or determine it's a new entity.

Entity Mention: "${mention}"
Context: "${context.slice(0, 500)}..." (truncated for brevity)

Candidate Entities:
${candidatesText}

Instructions:
1. Consider synonyms, abbreviations, and common variations
2. Use context to disambiguate (e.g., "Apple" could be fruit or company)
3. Be conservative - only match if you're confident (>0.65)
4. Return ONLY valid JSON (no markdown, no code blocks):
{
  "matched_entity_id": "<id or null if new entity>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation in 1-2 sentences>",
  "suggested_aliases": ["<alias1>", "<alias2>"]
}`;

    try {
      const response = await this.llmProvider(prompt);
      logger.debug('LLM entity match response', { mention, response: response.slice(0, 200) });

      // Parse JSON response
      const parsed = this.parseJsonResponse(response);

      // Validate response structure
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON response from LLM');
      }

      // Find matched entity ID if provided
      let matchedEntityId: string | null = null;
      if (parsed.matched_entity_id && parsed.matched_entity_id !== 'null') {
        // Check if it's a number (1, 2, 3) to select from candidates
        if (typeof parsed.matched_entity_id === 'number' || /^\d+$/.test(parsed.matched_entity_id)) {
          const index = parseInt(parsed.matched_entity_id.toString(), 10) - 1;
          if (index >= 0 && index < candidates.length) {
            matchedEntityId = candidates[index].id;
          }
        } else if (this.isValidUUID(parsed.matched_entity_id)) {
          // Valid UUID format
          matchedEntityId = parsed.matched_entity_id;
        } else {
          // LLM returned entity name instead of ID - try to find it in candidates
          logger.warn('LLM returned entity name instead of ID, attempting to match', {
            mention,
            returnedValue: parsed.matched_entity_id
          });
          const matchedCandidate = candidates.find(
            c => c.canonical_name.toLowerCase() === parsed.matched_entity_id.toLowerCase() ||
                 c.aliases.some(a => a.toLowerCase() === parsed.matched_entity_id.toLowerCase())
          );
          if (matchedCandidate) {
            matchedEntityId = matchedCandidate.id;
            logger.info('Successfully matched entity name to candidate', {
              returnedName: parsed.matched_entity_id,
              matchedId: matchedEntityId,
              canonicalName: matchedCandidate.canonical_name
            });
          } else {
            // Not found - treat as null (new entity)
            logger.warn('LLM returned unrecognized entity name, treating as null', {
              mention,
              returnedValue: parsed.matched_entity_id
            });
            matchedEntityId = null;
          }
        }
      }

      return {
        matchedEntityId,
        confidence: parsed.confidence || 0,
        reasoning: parsed.reasoning || 'No reasoning provided',
        suggestedAliases: Array.isArray(parsed.suggested_aliases) ? parsed.suggested_aliases : []
      };
    } catch (error: any) {
      logger.error('LLM entity matching failed', { error: error.message, mention, candidatesCount: candidates.length });
      return {
        matchedEntityId: null,
        confidence: 0,
        reasoning: `LLM matching failed: ${error.message}`,
        suggestedAliases: []
      };
    }
  }

  /**
   * Extract canonical form of entity mention using LLM
   * Example: "auth timeout" → "Authentication Timeout", "login bug" → "Login Bug"
   * @param mention - Raw entity mention
   * @param context - Signal text for context
   * @returns Canonical name
   */
  async extractCanonicalForm(mention: string, context: string): Promise<string> {
    if (!this.llmProvider) {
      // Fallback: simple title case
      return this.fallbackCanonicalForm(mention);
    }

    const prompt = `You are normalizing entity names for a knowledge graph.

Entity Mention: "${mention}"
Context: "${context.slice(0, 500)}..." (truncated for brevity)

Task: Extract the canonical (standard) form of this entity name.

Rules:
- Use proper case (e.g., "Microsoft", not "microsoft" or "MICROSOFT")
- Expand abbreviations when context is clear (e.g., "MSFT" → "Microsoft")
- Keep specificity (e.g., "Login Timeout Bug" not "Bug")
- Remove noise words ("the", "a", "issue with", "problem with")
- Keep it concise (2-5 words ideal)

Return ONLY the canonical name, no explanation, no quotes, no JSON.`;

    try {
      const response = await this.llmProvider(prompt);
      const canonicalName = response.trim().replace(/^["']|["']$/g, ''); // Remove quotes if present

      if (!canonicalName || canonicalName.length < 2 || canonicalName.length > 100) {
        logger.warn('LLM canonical form invalid, using fallback', { mention, response });
        return this.fallbackCanonicalForm(mention);
      }

      logger.debug('LLM canonical form extracted', { mention, canonicalName });
      return canonicalName;
    } catch (error: any) {
      logger.error('LLM canonical form extraction failed', { error: error.message, mention });
      return this.fallbackCanonicalForm(mention);
    }
  }

  /**
   * Classify entity type using LLM
   * Example: "Acme Corp" → "customer", "SSO feature" → "feature"
   * @param mention - Entity mention
   * @param context - Signal text for context
   * @returns Entity type classification
   */
  async classifyEntityType(mention: string, context: string): Promise<EntityTypeResult> {
    if (!this.llmProvider) {
      return {
        entityType: 'issue', // Default fallback
        confidence: 0.5,
        reasoning: 'LLM unavailable, using default type "issue"'
      };
    }

    const prompt = `You are classifying entities for a PM intelligence system.

Entity Mention: "${mention}"
Context: "${context.slice(0, 500)}..." (truncated for brevity)

Task: Classify this entity into one of these types:
- "customer": Company names, organization names (e.g., "Acme Corp", "Microsoft")
- "feature": Product features, capabilities (e.g., "SSO", "Dark Mode", "Export to PDF")
- "issue": Bugs, problems, defects (e.g., "Login Timeout", "Crash on Startup")
- "theme": High-level topics, categories (e.g., "Performance", "Security", "UX")

Return ONLY valid JSON (no markdown, no code blocks):
{
  "entity_type": "<customer|feature|issue|theme>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation in 1 sentence>"
}`;

    try {
      const response = await this.llmProvider(prompt);
      const parsed = this.parseJsonResponse(response);

      if (!parsed || !parsed.entity_type) {
        throw new Error('Invalid classification response');
      }

      const validTypes = ['customer', 'feature', 'issue', 'theme'];
      const entityType = validTypes.includes(parsed.entity_type) ? parsed.entity_type : 'issue';

      return {
        entityType: entityType as 'customer' | 'feature' | 'issue' | 'theme',
        confidence: parsed.confidence || 0.7,
        reasoning: parsed.reasoning || 'Classification based on context'
      };
    } catch (error: any) {
      logger.error('LLM entity type classification failed', { error: error.message, mention });
      return {
        entityType: 'issue',
        confidence: 0.5,
        reasoning: `Classification failed: ${error.message}`
      };
    }
  }

  /**
   * Generate aliases/synonyms for entity using LLM
   * Example: "Authentication" → ["Auth", "Sign-in", "Login"]
   * @param canonicalName - Canonical entity name
   * @param context - Optional context for better alias generation
   * @returns List of suggested aliases
   */
  async generateAliases(canonicalName: string, context?: string): Promise<AliasGenerationResult> {
    if (!this.llmProvider) {
      return {
        aliases: [],
        reasoning: 'LLM unavailable'
      };
    }

    const contextText = context ? `\nContext: "${context.slice(0, 300)}..."` : '';

    const prompt = `You are generating aliases for entity names in a knowledge graph.

Canonical Name: "${canonicalName}"${contextText}

Task: Generate 3-5 common aliases, abbreviations, or variations that people might use to refer to this entity.

Examples:
- "Authentication" → ["Auth", "Sign-in", "Login", "Sign In"]
- "Microsoft Corporation" → ["Microsoft", "MSFT", "MS"]
- "Single Sign-On" → ["SSO", "Single Sign On"]

Return ONLY valid JSON (no markdown, no code blocks):
{
  "aliases": ["<alias1>", "<alias2>", "<alias3>"],
  "reasoning": "<brief explanation in 1 sentence>"
}`;

    try {
      const response = await this.llmProvider(prompt);
      const parsed = this.parseJsonResponse(response);

      if (!parsed || !Array.isArray(parsed.aliases)) {
        throw new Error('Invalid aliases response');
      }

      // Filter out duplicates and the canonical name itself
      const uniqueAliases = ([...new Set(parsed.aliases)] as string[])
        .filter((alias: string) => alias && alias.toLowerCase() !== canonicalName.toLowerCase())
        .slice(0, 5); // Limit to 5 aliases

      return {
        aliases: uniqueAliases,
        reasoning: parsed.reasoning || 'Generated based on common variations'
      };
    } catch (error: any) {
      logger.error('LLM alias generation failed', { error: error.message, canonicalName });
      return {
        aliases: [],
        reasoning: `Alias generation failed: ${error.message}`
      };
    }
  }

  /**
   * Parse JSON response from LLM (handles markdown code blocks)
   */
  private parseJsonResponse(response: string): any {
    try {
      // Remove markdown code blocks if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
      }

      // Try to find JSON object in response using non-greedy match and limiting scope
      // First, try to find the first complete JSON object
      const firstBrace = cleaned.indexOf('{');
      if (firstBrace !== -1) {
        // Find matching closing brace by counting braces
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = firstBrace; i < cleaned.length; i++) {
          const char = cleaned[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"') {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                // Found complete JSON object
                const jsonStr = cleaned.substring(firstBrace, i + 1);
                return JSON.parse(jsonStr);
              }
            }
          }
        }
      }

      // Fallback to direct parse
      return JSON.parse(cleaned);
    } catch (error) {
      logger.warn('JSON parsing failed, trying fallback', { response: response.slice(0, 100) });
      // Try one more time with just the response
      return JSON.parse(response);
    }
  }

  /**
   * Check if string is valid UUID format
   */
  private isValidUUID(value: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  }

  /**
   * Fallback canonical form extraction (simple title case)
   */
  private fallbackCanonicalForm(mention: string): string {
    return mention
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .replace(/\s+/g, ' ');
  }
}
