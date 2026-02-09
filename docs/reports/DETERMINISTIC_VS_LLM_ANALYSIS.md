# Deterministic vs LLM Analysis - How the System Works

## Overview

This document clarifies what parts of the PM Intelligence system use **deterministic processing** vs **LLM-based processing** for analyzing Slack messages.

---

## 🎯 Current System Architecture

### Layer 1: Signal Extraction (DETERMINISTIC) ✅

**Location**: `backend/processing/signal_extractor.ts`

**What it does**:
- Extracts raw text from Slack messages
- Normalizes content (lowercase, trim)
- Stores signals with metadata
- **NO inference, NO summarization, NO insights**

**Code**:
```typescript
export function extractSignal(raw: RawSignal): Signal {
  return {
    id: randomUUID(),
    source: raw.source,
    source_ref: raw.id || '',
    signal_type: raw.type || 'unknown',
    content: raw.text,  // Raw text, unchanged
    normalized_content: raw.text.toLowerCase().trim(),  // Simple normalization
    metadata: raw.metadata || null,
    created_at: new Date()
  };
}
```

**Key Point**: Signals are **immutable** and contain **only raw data**, no summaries or insights.

---

### Layer 2: Opportunity Detection (DETERMINISTIC) ✅

**Location**: `backend/services/opportunity_service.ts`

**What it does**:
- Clusters signals based on **keyword similarity**
- Uses **Jaccard similarity** (word overlap)
- **NO LLM** - pure deterministic clustering

**Clustering Algorithm**:
```typescript
function areSignalsRelated(signal1: Signal, signal2: Signal): boolean {
  // Same source and signal type
  if (signal1.source === signal2.source && signal1.signal_type === signal2.signal_type) {
    // Check for keyword overlap in normalized content
    const words1 = new Set(signal1.normalized_content.split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(signal2.normalized_content.split(/\s+/).filter(w => w.length > 3));
    
    const intersection = [...words1].filter(w => words2.has(w));
    const union = new Set([...words1, ...words2]);
    
    // Jaccard similarity threshold
    const similarity = intersection.length / union.size;
    return similarity > 0.2; // 20% word overlap
  }
  return false;
}
```

**How it works**:
1. Splits signals into words (length > 3)
2. Calculates word overlap (intersection / union)
3. If similarity > 20%, signals are clustered
4. Creates opportunity from cluster using **most common words**

**Limitations**:
- Only clusters signals with similar wording
- Misses semantically related but differently worded signals
- Example: "NFCU meeting" and "IRS meeting" won't cluster (different customer names)

---

### Layer 3: Opportunity Synthesis (LLM) 🤖

**Location**: `backend/services/llm_service.ts`

**What it does**:
- Uses LLM to synthesize insights from opportunity clusters
- Extracts patterns, themes, assumptions
- **Only used when creating judgments** (human-in-the-loop)

**Code**:
```typescript
export async function synthesizeOpportunity(
  signals: any[],
  opportunity: any,
  llmProvider: LLMProvider
): Promise<LLMResponse> {
  const prompt = buildOpportunitySynthesisPrompt(signals, opportunity);
  const llmResponse = await llmProvider(prompt);
  // Returns structured reasoning, assumptions, missing evidence
}
```

**When it's used**:
- Only in `judgment_service.ts` when creating judgments
- Requires human user ID (human-in-the-loop)
- NOT used automatically for opportunity detection

---

### Layer 4: Artifact Generation (LLM) 🤖

**Location**: `backend/services/llm_service.ts`

**What it does**:
- Uses LLM to draft PRDs/RFCs from judgments
- **Only used when creating artifacts** (human-in-the-loop)

---

## 🔍 What I Did (Manual Analysis)

### The Analysis I Performed

**Method**: **Deterministic Pattern Matching** (Regex/Text Processing)

**Script**: `scripts/analyze_customer_insights.ts`

**How it works**:

1. **Customer Name Extraction**:
   ```typescript
   const customerMatch = content.match(/(?:Customer Name|customer)[\s:]*([A-Z][A-Za-z\s]+)/i);
   ```
   - Uses regex to find "Customer Name: X" pattern
   - **Deterministic** - no LLM

2. **Actionable Item Extraction**:
   ```typescript
   const nextActionMatch = content.match(/:todo_done:\s*\*Next Action\*(.*?)(?=\n\n|\n:|\n\*|$)/is);
   ```
   - Looks for Slack formatting patterns (`:todo_done:`, `*Next Action*`)
   - Extracts bullet points (`•`, `-`, numbered lists)
   - Extracts assignees from parentheses: `(Adobe)`, `(LPL)`
   - Extracts dates: `next week`, `mid June`, `2025-05-22`
   - **Deterministic** - pattern matching only

3. **Insight Categorization**:
   ```typescript
   if (content.match(/adoption|expanding|adopt/i)) {
     // Categorize as "Adoption/Expansion"
   }
   if (content.match(/requirement|need|want|request/i)) {
     // Categorize as "Feature Request"
   }
   ```
   - Uses keyword matching
   - **Deterministic** - simple keyword search

**Limitations of This Approach**:
- ✅ Works well for structured Slack messages (with emojis, formatting)
- ❌ Misses unstructured actionable items
- ❌ May misclassify insights
- ❌ Doesn't understand context/semantics

---

## 📊 Comparison: Deterministic vs LLM

### What Deterministic Layer CAN Do ✅

1. **Signal Clustering**:
   - ✅ Cluster signals with similar wording
   - ✅ Find exact keyword matches
   - ✅ Simple word overlap similarity

2. **Pattern Extraction**:
   - ✅ Extract structured data (dates, assignees, customer names)
   - ✅ Find formatted sections (`*Next Action*`, `:todo_done:`)
   - ✅ Extract bullet points and lists

3. **Simple Categorization**:
   - ✅ Keyword-based categorization
   - ✅ Pattern-based extraction

### What Deterministic Layer CANNOT Do ❌

1. **Semantic Understanding**:
   - ❌ Doesn't understand that "NFCU meeting" and "NFCU expansion" are related
   - ❌ Doesn't understand context or intent
   - ❌ Misses implicit actionable items

2. **Intelligent Clustering**:
   - ❌ Can't cluster semantically similar but differently worded signals
   - ❌ Example: "Core component issue" and "Template conversion failing" won't cluster

3. **Insight Extraction**:
   - ❌ Can't identify insights that aren't explicitly stated
   - ❌ Can't understand business implications
   - ❌ Can't connect related concepts across different signals

### What LLM Layer CAN Do 🤖

1. **Semantic Clustering**:
   - ✅ Understand that "NFCU expansion" and "NFCU IC Editor adoption" are related
   - ✅ Cluster signals by meaning, not just keywords

2. **Intelligent Insight Extraction**:
   - ✅ Identify implicit insights
   - ✅ Understand business context
   - ✅ Connect related concepts

3. **Structured Analysis**:
   - ✅ Extract assumptions
   - ✅ Identify missing evidence
   - ✅ Provide reasoning

---

## 🎯 Current System Behavior

### For Opportunity Detection

**What Actually Happened**:
1. ✅ Signals ingested (deterministic)
2. ✅ Signals clustered (deterministic - keyword overlap)
3. ✅ 1 opportunity created from 3 test signals (they had similar wording)
4. ❌ Customer meeting notes DIDN'T cluster (different wording, different customers)

**Why Customer Signals Didn't Cluster**:
- NFCU, IRS, LPL Financial messages have different wording
- Different customer names = different keywords
- Jaccard similarity < 20% threshold
- **Deterministic clustering can't see semantic similarity**

### For My Analysis

**What I Did**:
1. ✅ Used regex to extract customer names
2. ✅ Used pattern matching to find "Next Action" sections
3. ✅ Used keyword matching to categorize insights
4. ✅ Manually reviewed content for context

**This is Deterministic** - no LLM was used in my analysis script.

---

## 💡 How to Improve: Hybrid Approach

### Option 1: Enhance Deterministic Layer

**Improvements**:
1. **Customer Name Extraction**:
   ```typescript
   // Extract from metadata or content
   const customerNames = ['NFCU', 'IRS', 'LPL Financial', 'Clark County'];
   // Match against known customer names
   ```

2. **Lower Similarity Threshold**:
   ```typescript
   return similarity > 0.1; // Lower from 0.2 to 0.1
   ```

3. **Customer-Based Clustering**:
   ```typescript
   // Cluster by customer name first
   const customer1 = extractCustomer(signal1);
   const customer2 = extractCustomer(signal2);
   if (customer1 === customer2) {
     // Then check similarity
   }
   ```

### Option 2: Add LLM-Based Clustering

**How it would work**:
1. Use LLM to extract customer names, topics, themes
2. Use LLM to determine semantic similarity
3. Cluster signals based on LLM-extracted features

**Example**:
```typescript
async function areSignalsRelatedLLM(signal1: Signal, signal2: Signal, llmProvider: LLMProvider): Promise<boolean> {
  const prompt = `Are these two signals related?
  
Signal 1: ${signal1.content}
Signal 2: ${signal2.content}

Respond with YES or NO only.`;
  
  const response = await llmProvider(prompt);
  return response.trim().toUpperCase().includes('YES');
}
```

### Option 3: Hybrid Approach (Recommended)

1. **Deterministic First**:
   - Extract structured data (dates, customer names, assignees)
   - Use pattern matching for formatted sections
   - Cluster obvious matches

2. **LLM Second**:
   - Use LLM for semantic clustering
   - Extract insights from clusters
   - Identify implicit actionable items

---

## 📝 Summary

### Current State

| Layer | Method | Used For |
|-------|--------|----------|
| Signal Extraction | Deterministic | Storing raw messages |
| Opportunity Detection | Deterministic | Clustering similar signals |
| Opportunity Synthesis | LLM | Creating judgments (human-in-the-loop) |
| Artifact Generation | LLM | Drafting PRDs/RFCs (human-in-the-loop) |

### My Analysis

| Task | Method | How |
|------|--------|-----|
| Extract Customer Names | Deterministic | Regex pattern matching |
| Extract Actionable Items | Deterministic | Pattern matching (`*Next Action*`, `:todo_done:`) |
| Categorize Insights | Deterministic | Keyword matching |
| Cluster Signals | Deterministic | Jaccard similarity (20% threshold) |

### Key Insight

**The system uses deterministic methods for signal processing and opportunity detection. LLM is only used later in the pipeline for synthesis and artifact generation, requiring human-in-the-loop.**

The deterministic clustering works well for signals with similar wording but misses semantically related signals with different wording. This is why the customer meeting notes didn't cluster together - they mention different customers and use different terminology, even though they're all customer meetings.
