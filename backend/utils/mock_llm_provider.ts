/**
 * Mock LLM provider for testing purposes.
 * Simulates Cursor's LLM API without requiring actual LLM access.
 */

import { LLMProvider } from '../services/llm_service';

/**
 * Creates a mock LLM provider that returns predictable responses.
 * Useful for testing without requiring actual LLM API access.
 */
export function createMockLLMProvider(): LLMProvider {
  return async (prompt: string): Promise<string> => {
    // Simulate LLM processing delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check what type of prompt this is
    if (prompt.includes('OPPORTUNITY_SYNTHESIS') || prompt.includes('synthesize')) {
      // Return structured judgment response
      return JSON.stringify({
        content: `This is a synthesized opportunity analysis based on the provided signals. The opportunity shows strong customer interest and aligns with strategic priorities.`,
        assumptions: [
          'Customer needs align with product roadmap',
          'Technical feasibility is high based on existing capabilities',
          'Market timing is favorable'
        ],
        missing_evidence: [
          'Quantitative customer impact data',
          'Competitive analysis',
          'Resource availability confirmation'
        ]
      });
    }
    
    if (prompt.includes('ARTIFACT_DRAFT') || prompt.includes('PRD') || prompt.includes('RFC')) {
      // Return artifact draft
      const artifactType = prompt.includes('PRD') ? 'PRD' : 'RFC';
      return `# ${artifactType}: [Title]

## Overview
This ${artifactType} addresses the opportunity identified through signal analysis.

## Background
Based on the judgment analysis, this opportunity represents a significant customer need.

## Requirements
1. [Requirement 1]
2. [Requirement 2]
3. [Requirement 3]

## Assumptions
- Assumption 1: [Details]
- Assumption 2: [Details]

## Missing Evidence
- [Evidence item 1]
- [Evidence item 2]

## Success Metrics
- Metric 1
- Metric 2

## Timeline
- Phase 1: [Timeline]
- Phase 2: [Timeline]
`;
    }
    
    // Default response
    return `Mock LLM response for prompt: ${prompt.substring(0, 100)}...`;
  };
}

/**
 * Creates a mock LLM provider that simulates errors.
 */
export function createMockLLMProviderWithError(errorMessage: string = 'Mock LLM error'): LLMProvider {
  return async (prompt: string): Promise<string> => {
    await new Promise(resolve => setTimeout(resolve, 50));
    throw new Error(errorMessage);
  };
}
