/**
 * Text processing utilities for signal normalization and entity extraction.
 * Deterministic processing only - no LLM inference.
 */

// Common stop words to filter out during similarity calculations
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'some', 'any', 'no', 'not', 'can', 'cannot', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just'
]);

/**
 * Normalizes text for similarity comparison.
 * - Converts to lowercase
 * - Removes punctuation
 * - Removes stop words
 * - Removes extra whitespace
 */
export function normalizeTextForSimilarity(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Extracts meaningful words from text (removes stop words, short words).
 */
export function extractMeaningfulWords(text: string, minLength: number = 3): string[] {
  const normalized = normalizeTextForSimilarity(text);
  return normalized
    .split(/\s+/)
    .filter(word => word.length >= minLength && !STOP_WORDS.has(word));
}

/**
 * Calculates Jaccard similarity between two sets of words.
 * Returns a value between 0 and 1.
 */
export function calculateJaccardSimilarity(words1: string[], words2: string[]): number {
  if (words1.length === 0 && words2.length === 0) return 1.0;
  if (words1.length === 0 || words2.length === 0) return 0.0;

  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  const intersection = [...set1].filter(w => set2.has(w));
  const union = new Set([...set1, ...set2]);
  
  return intersection.length / union.size;
}

import { KNOWN_CUSTOMERS, getAllCustomerNames } from '../config/entities';

function compareStringsDiceCoefficient(value1: string, value2: string): number {
  const first = value1.replace(/\s+/g, '');
  const second = value2.replace(/\s+/g, '');
  if (first === second) return 1;
  if (first.length < 2 || second.length < 2) return 0;

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2);
    const count = firstBigrams.get(bigram) || 0;
    firstBigrams.set(bigram, count + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.get(bigram) || 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (first.length + second.length - 2);
}

const INVALID_CUSTOMER_TERMS = new Set([
  'to go',
  'vip',
  'ppt',
  'aep',
  'fyi',
  'las',
  'rde',
  'said selectively worked',
  'rectified it',
  's live on eds',
  'eds',
  'full',
  'meeting',
  'summary',
  'fdm',
  'usc',
  'eol',
  'ajo',
  'aem',
  'poc',
  'fyu',
  'sql server',
  'ttv'
]);

const INVALID_ACRONYMS = new Set([
  'fyi',
  'poc',
  'ttv',
  'ppt',
  'aep',
  'las',
  'rde',
  'eds',
  'fdm',
  'usc',
  'eol',
  'ajo',
  'aem',
  'fyu'
]);

const COMMON_WORDS = new Set([
  'meeting',
  'summary',
  'live',
  'thanks',
  'thank',
  'sure',
  'check',
  'details',
  'invite',
  'extended',
  'email',
  'docs',
  'shared',
  'added',
  'administrator',
  'example',
  'word',
  'forms',
  'issue',
  'blocker',
  'answer',
  'queries',
  'customer',
  'demo',
  'test',
  'signal',
  'message',
  'clarification',
  'scheduled',
  'involved',
  'private',
  'release',
  'expected',
  'will',
  'share',
  'sample',
  'form',
  'forms',
  'customer',
  'customers',
  'is',
  'are',
  'was',
  'were',
  'been',
  'being',
  'has',
  'have',
  'had',
  'can',
  'could',
  'should',
  'would',
  'may',
  'might',
  'need',
  'needs',
  'using',
  'use',
  'used',
  'requested',
  'request',
  'investigate',
  'validate',
  'follow',
  'followup',
  'follow-up',
  'call',
  'confirmed',
  'feedback',
  'requirements',
  'requirement',
  'background',
  'perspective',
  'preference',
  'summary',
  'questions',
  'responses'
]);

function normalizeCustomerCandidate(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/[^\w\s&'.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const DEFAULT_FUZZY_CUSTOMER_THRESHOLD = (() => {
  const parsed = Number.parseFloat(process.env.FUZZY_CUSTOMER_THRESHOLD || '');
  return Number.isFinite(parsed) ? parsed : 0.75;
})();

function normalizeCustomerForFuzzyMatch(value: string): string {
  const normalized = normalizeCustomerCandidate(value);
  if (!normalized) return '';
  const withoutSuffix = normalized
    .replace(/\b(inc|corp|corporation|ltd|llc|co|company)\b\.?$/i, '')
    .trim();
  return withoutSuffix.replace(/[,.;:]+$/g, '').trim();
}

export function fuzzyCustomerMatch(
  name1: string,
  name2: string,
  threshold: number = DEFAULT_FUZZY_CUSTOMER_THRESHOLD
): boolean {
  const norm1 = normalizeCustomerForFuzzyMatch(name1);
  const norm2 = normalizeCustomerForFuzzyMatch(name2);
  if (!norm1 || !norm2) return false;
  if (norm1 === norm2) return true;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  const normalizedThreshold = Number.isFinite(threshold)
    ? Math.min(Math.max(threshold, 0), 1)
    : DEFAULT_FUZZY_CUSTOMER_THRESHOLD;
  return compareStringsDiceCoefficient(norm1, norm2) >= normalizedThreshold;
}

export function resolveToCanonicalName(name: string): string {
  const cleaned = name.replace(/\*+$/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const normalizedInput = normalizeCustomerCandidate(cleaned);
  if (!normalizedInput) return cleaned;

  for (const customer of KNOWN_CUSTOMERS) {
    const candidates = [customer.name, ...(customer.aliases || [])];
    for (const candidate of candidates) {
      if (customer.caseSensitive) {
        if (candidate === cleaned) return customer.name;
        continue;
      }
      if (normalizeCustomerCandidate(candidate) === normalizedInput) {
        return customer.name;
      }
    }
  }

  for (const customer of KNOWN_CUSTOMERS) {
    const candidates = [customer.name, ...(customer.aliases || [])];
    for (const candidate of candidates) {
      if (fuzzyCustomerMatch(candidate, cleaned)) {
        return customer.name;
      }
    }
  }

  return cleaned;
}

function isLikelyAcronym(value: string): boolean {
  return /^[A-Z0-9]{2,6}$/.test(value.trim());
}

function isInvalidCustomerName(value: string, knownNamesLower: Set<string>): boolean {
  const normalized = normalizeCustomerCandidate(value);
  if (!normalized) return true;

  if (INVALID_CUSTOMER_TERMS.has(normalized)) return true;
  if (STOP_WORDS.has(normalized) || COMMON_WORDS.has(normalized)) return true;

  if (/[<>{}@/\\]/.test(value)) return true;
  if (/[:?]/.test(value)) return true;
  if (/\b\w+'s\b/i.test(value)) return true;

  if (isLikelyAcronym(value)) {
    if (INVALID_ACRONYMS.has(normalized)) return true;
    if (value.length <= 4 && !knownNamesLower.has(normalized)) return true;
  }

  const words = normalized.split(' ');
  if (words.length > 1) {
    const allCommon = words.every(word => STOP_WORDS.has(word) || COMMON_WORDS.has(word));
    if (allCommon) return true;
    const hasStopWord = words.some(word => STOP_WORDS.has(word) || COMMON_WORDS.has(word));
    if (hasStopWord && !knownNamesLower.has(normalized)) return true;
  }

  if (!knownNamesLower.has(normalized)) {
    if (words.length > 4) return true;
    if (!/^[a-z0-9.&'\-\s]+$/i.test(value)) return true;
    const hasLowercaseWord = words.some(word => word.length > 2 && word === word.toLowerCase());
    if (hasLowercaseWord) return true;
  }

  return false;
}

/**
 * Extracts customer names from text using strict "Customer:" format.
 * - Main messages: only accept "Customer:" or "Customer Name:" format.
 * - Replies: handled via parent thread lookup in ingestion.
 * - All other heuristics are disabled to avoid false positives.
 */
export function extractCustomerNames(
  text: string,
  metadata?: Record<string, any> | null
): string[] {
  const customers: string[] = [];
  const seen = new Set<string>();
  const knownCustomerNames = getAllCustomerNames();
  const knownNamesLower = new Set(knownCustomerNames.map(name => name.toLowerCase()));

  const threadTs = metadata?.thread_ts;
  const messageTs = metadata?.timestamp || metadata?.ts;
  if (threadTs && messageTs && threadTs !== messageTs) {
    // Replies should inherit from parent thread only
    return [];
  }
  
  // Pattern 1: "Customer Name: X" or "Customer: X"
  const pattern1 = /(?:Customer Name|Customer|customer name|customer)[\s:]*([^\n\r,.]+)/gi;
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    const rawName = match[1].trim();
    const baseName = rawName.split(/[\|\-–—•*<>()\[\]{}]/)[0].trim();
    const name = baseName
      .split(/\s+(?:says|said|reports?|reported|asks?|asked|is|was|has|have|had|uses|using|relies|relying|needs?|wants?|mentioned|mentions|about|re)\b/i)[0]
      .trim();
    if (name.length > 2 && name.length < 100) {
      const normalized = name.toLowerCase();
      if (!seen.has(normalized) && !isInvalidCustomerName(name, knownNamesLower)) {
        customers.push(name);
        seen.add(normalized);
      }
    }
  }
  
  return customers; // Already deduplicated via Set
}

/**
 * Extracts dates from text.
 * Returns array of date strings found.
 */
export function extractDates(text: string): string[] {
  const dates: string[] = [];
  
  // ISO date format: YYYY-MM-DD
  const isoPattern = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let match;
  while ((match = isoPattern.exec(text)) !== null) {
    dates.push(match[1]);
  }
  
  // Relative dates: "next week", "mid June", etc.
  const relativePattern = /\b(next\s+(?:week|month|call|meeting)|mid\s+\w+|end\s+of\s+\w+)\b/gi;
  while ((match = relativePattern.exec(text)) !== null) {
    dates.push(match[1]);
  }
  
  return [...new Set(dates)];
}

/**
 * Extracts assignees from text (names in parentheses).
 */
export function extractAssignees(text: string): string[] {
  const assignees: string[] = [];
  const pattern = /\(([^)]+)\)/g;
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const assignee = match[1].trim();
    // Filter out dates, URLs, and other non-name patterns
    if (assignee.length > 1 && 
        assignee.length < 50 &&
        !assignee.match(/^\d{4}-\d{2}-\d{2}$/) && // Not a date
        !assignee.match(/^https?:\/\//) && // Not a URL
        !assignee.match(/^\d+$/) && // Not just numbers
        !assignee.match(/^[A-Z]{2,}$/)) { // Not an acronym (might be customer name)
      assignees.push(assignee);
    }
  }
  
  return [...new Set(assignees)];
}

import { TOPIC_DEFINITIONS } from '../config/entities';

/**
 * Extracts topics/themes from text using keyword matching.
 * Uses configurable topic definitions from entities config.
 * Returns array of topic strings, ordered by priority (most specific first).
 */
export function extractTopics(text: string): string[] {
  const topics: string[] = [];
  const normalized = text.toLowerCase();
  const seen = new Set<string>();
  
  // Check topics in priority order (most specific first)
  for (const topicDef of TOPIC_DEFINITIONS) {
    // Check if any keyword matches
    const matches = topicDef.keywords.some(keyword => normalized.includes(keyword));
    if (matches && !seen.has(topicDef.name)) {
      topics.push(topicDef.name);
      seen.add(topicDef.name);
    }
  }
  
  return topics; // Already deduplicated and ordered by priority
}

/**
 * Calculates weighted similarity between two signals.
 * Uses cached entities from metadata if available to avoid re-extraction.
 * Considers:
 * - Word overlap (Jaccard similarity)
 * - Customer name overlap (higher weight)
 * - Topic overlap (higher weight)
 * - Time proximity (signals from same time period)
 */
export function calculateWeightedSimilarity(
  signal1: { 
    normalized_content: string; 
    content: string; 
    created_at: Date;
    metadata?: Record<string, any> | null;
  },
  signal2: { 
    normalized_content: string; 
    content: string; 
    created_at: Date;
    metadata?: Record<string, any> | null;
  },
  options: {
    wordSimilarityWeight?: number;
    customerWeight?: number;
    topicWeight?: number;
    timeWeight?: number;
    timeWindowHours?: number;
  } = {}
): number {
  const {
    wordSimilarityWeight = 0.5,
    customerWeight = 0.3,
    topicWeight = 0.15,
    timeWeight = 0.05,
    timeWindowHours = 24 * 7 // 7 days default
  } = options;
  
  // Word similarity (Jaccard) - always calculate
  const words1 = extractMeaningfulWords(signal1.normalized_content);
  const words2 = extractMeaningfulWords(signal2.normalized_content);
  const wordSim = calculateJaccardSimilarity(words1, words2);
  
  // Early termination: if word similarity is very low and customer/topic weights are high,
  // we can skip expensive entity extraction
  if (wordSim < 0.05 && customerWeight + topicWeight > 0.4) {
    // Still need to check customers/topics, but can use cached if available
  }
  
  // Customer name overlap - use cached if available
  let customers1: string[], customers2: string[];
  if (signal1.metadata?.customers && Array.isArray(signal1.metadata.customers)) {
    customers1 = signal1.metadata.customers;
  } else {
    customers1 = extractCustomerNames(signal1.content);
  }
  
  if (signal2.metadata?.customers && Array.isArray(signal2.metadata.customers)) {
    customers2 = signal2.metadata.customers;
  } else {
    customers2 = extractCustomerNames(signal2.content);
  }
  
  const customerSim = customers1.length > 0 && customers2.length > 0
    ? customers1.some(c1 => customers2.some(c2 => fuzzyCustomerMatch(c1, c2))) ? 1.0 : 0.0
    : 0.0;
  
  // Topic overlap - use cached if available
  let topics1: string[], topics2: string[];
  if (signal1.metadata?.topics && Array.isArray(signal1.metadata.topics)) {
    topics1 = signal1.metadata.topics;
  } else {
    topics1 = extractTopics(signal1.content);
  }
  
  if (signal2.metadata?.topics && Array.isArray(signal2.metadata.topics)) {
    topics2 = signal2.metadata.topics;
  } else {
    topics2 = extractTopics(signal2.content);
  }
  
  const topicSim = topics1.length > 0 && topics2.length > 0
    ? calculateJaccardSimilarity(topics1, topics2)
    : 0.0;
  
  // Time proximity
  const timeDiff = Math.abs(signal1.created_at.getTime() - signal2.created_at.getTime());
  const timeWindowMs = timeWindowHours * 60 * 60 * 1000;
  const timeSim = timeDiff < timeWindowMs ? 1.0 - (timeDiff / timeWindowMs) : 0.0;
  
  // Weighted combination
  const totalWeight = wordSimilarityWeight + customerWeight + topicWeight + timeWeight;
  const weightedSim = (
    wordSim * wordSimilarityWeight +
    customerSim * customerWeight +
    topicSim * topicWeight +
    timeSim * timeWeight
  ) / totalWeight;
  
  return weightedSim;
}
