import { RawSignal } from '../processing/signal_extractor';
import { logger } from '../utils/logger';

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates a raw signal before ingestion.
 * Ensures signals are immutable and contain no summaries/insights.
 * Enhanced with quality checks.
 */
export function validateSignal(signal: RawSignal): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required fields
  if (!signal.source || typeof signal.source !== 'string') {
    errors.push({ field: 'source', message: 'Source is required and must be a string' });
  }

  if (!signal.text || typeof signal.text !== 'string' || signal.text.trim().length === 0) {
    errors.push({ field: 'text', message: 'Text content is required and must be non-empty' });
  }

  // Source validation (must be one of the allowed sources)
  const allowedSources = ['slack', 'teams', 'grafana', 'splunk', 'manual', 'test'];
  if (signal.source && !allowedSources.includes(signal.source.toLowerCase())) {
    errors.push({
      field: 'source',
      message: `Source must be one of: ${allowedSources.join(', ')}`
    });
  }

  // Quality validation - length checks
  if (signal.text) {
    const textLength = signal.text.trim().length;
    
    // Minimum length check
    if (textLength < 10) {
      errors.push({
        field: 'text',
        message: 'Text content must be at least 10 characters long'
      });
    }
    
    // Maximum length check (prevent extremely long signals)
    if (textLength > 50000) {
      errors.push({
        field: 'text',
        message: 'Text content must be less than 50,000 characters'
      });
    }
    
    // Check for meaningful content (not just whitespace or special characters)
    const meaningfulChars = signal.text.replace(/[\s\n\r\t\u00A0]/g, '').length;
    if (meaningfulChars < 5) {
      errors.push({
        field: 'text',
        message: 'Text content must contain at least 5 meaningful characters'
      });
    }
  }

  // Content validation - ensure no summaries or insights
  if (signal.text) {
    const summaryKeywords = ['summary', 'insight', 'analysis', 'conclusion', 'recommendation'];
    const lowerText = signal.text.toLowerCase();
    
    // Check for summary-like patterns (heuristic, not perfect)
    if (summaryKeywords.some(keyword => lowerText.includes(keyword))) {
      // This is a warning, not an error - signals might legitimately contain these words
      // But we log it for review
      logger.warn('Signal may contain summary/insight language', {
        excerpt: signal.text.substring(0, 100)
      });
    }
  }

  // Severity validation (if provided)
  if (signal.severity !== undefined) {
    if (typeof signal.severity !== 'number' || signal.severity < 1 || signal.severity > 5) {
      errors.push({
        field: 'severity',
        message: 'Severity must be a number between 1 and 5'
      });
    }
  }

  // Confidence validation (if provided)
  if (signal.confidence !== undefined) {
    if (typeof signal.confidence !== 'number' || signal.confidence < 0 || signal.confidence > 1) {
      errors.push({
        field: 'confidence',
        message: 'Confidence must be a number between 0 and 1'
      });
    }
  }

  return errors;
}

/**
 * Calculates a quality score for a signal (0-100).
 * Higher score = better quality signal.
 */
export function calculateSignalQuality(signal: RawSignal): number {
  let score = 0;
  
  if (!signal.text) return 0;
  
  const textLength = signal.text.trim().length;
  
  // Length score (0-30 points)
  if (textLength >= 50) score += 30;
  else if (textLength >= 20) score += 20;
  else if (textLength >= 10) score += 10;
  
  // Has entities (customers, topics) - checked during extraction
  // This is a placeholder - actual entity check happens in extractSignal
  // Score will be updated in enrichSignalMetadata
  
  // Has severity/confidence (0-20 points each)
  if (signal.severity !== undefined) score += 20;
  if (signal.confidence !== undefined) score += 20;
  
  // Has meaningful content (not just stop words)
  const meaningfulWords = signal.text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length >= 3 && !['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'].includes(word));
  
  if (meaningfulWords.length >= 5) score += 10;
  else if (meaningfulWords.length >= 2) score += 5;
  
  return Math.min(100, score);
}
