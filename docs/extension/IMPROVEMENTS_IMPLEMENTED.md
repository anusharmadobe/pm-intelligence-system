# Improvements to Signal Processing and Opportunity Detection

## Overview

This document outlines the improvements made to the deterministic signal processing and opportunity detection logic.

---

## 🎯 Key Improvements

### 1. Enhanced Text Processing Utilities (`backend/utils/text_processing.ts`)

**New utility functions for better text analysis:**

- **`normalizeTextForSimilarity()`**: Improved normalization that removes punctuation and stop words
- **`extractMeaningfulWords()`**: Extracts words while filtering stop words and short words
- **`calculateJaccardSimilarity()`**: Standardized Jaccard similarity calculation
- **`extractCustomerNames()`**: Multi-pattern customer name extraction
- **`extractDates()`**: Date extraction (ISO format and relative dates)
- **`extractAssignees()`**: Assignee extraction from parentheses
- **`extractTopics()`**: Topic extraction using keyword matching
- **`calculateWeightedSimilarity()`**: Multi-factor similarity calculation

**Benefits:**
- ✅ Better normalization for similarity matching
- ✅ Entity extraction (customers, dates, assignees, topics)
- ✅ More accurate similarity calculations

---

### 2. Improved Opportunity Detection (`backend/services/opportunity_service.ts`)

#### A. Weighted Similarity Calculation

**Before:**
- Only used Jaccard similarity (word overlap)
- Fixed 20% threshold
- Missed semantically related signals

**After:**
- **Multi-factor similarity**:
  - Word overlap: 40% weight
  - Customer name overlap: 35% weight (higher priority)
  - Topic overlap: 20% weight
  - Time proximity: 5% weight
- Configurable threshold (default: 15%, lowered from 20%)
- Better clustering of customer-related signals

**Example:**
```typescript
// Signals about NFCU will now cluster even if wording differs
// because customer name matching has high weight
```

#### B. Improved Title Generation

**Before:**
- Just top 3 words: `"word1 word2 word3 (3 signals)"`
- Not meaningful or descriptive

**After:**
- **Prioritized title parts**:
  1. Customer names (up to 2)
  2. Topics (up to 2)
  3. Most common meaningful words
- **Example**: `"NFCU - IC Editor - adoption (3 signals)"` instead of `"talked about expanding adoption (3 signals)"`

#### C. Better Description Generation

**Before:**
- Simple: `"Cluster of 3 related signals from slack. Types: message."`

**After:**
- Includes customer names, topics, sources, and types
- **Example**: `"Cluster of 3 related signals. Customers: NFCU. Topics: IC Editor, Adoption/Expansion. Sources: slack. Types: message."`

#### D. Configurable Detection

**New configuration options:**
```typescript
interface OpportunityDetectionConfig {
  similarityThreshold: number;      // Default: 0.15 (lowered from 0.2)
  minClusterSize: number;            // Default: 2
  requireSameSource: boolean;        // Default: true
  requireSameType: boolean;           // Default: false (allows different types)
  timeWindowHours: number;            // Default: 168 (7 days)
}
```

**Benefits:**
- ✅ More flexible clustering
- ✅ Can cluster across signal types
- ✅ Configurable thresholds
- ✅ Time-aware clustering

---

### 3. Enhanced Signal Extraction (`backend/processing/signal_extractor.ts`)

**Before:**
```typescript
normalized_content: raw.text.toLowerCase().trim()
```

**After:**
```typescript
normalized_content: normalizeTextForSimilarity(raw.text)
```

**Benefits:**
- ✅ Removes punctuation
- ✅ Filters stop words
- ✅ Better normalization for similarity matching

---

## 📊 Expected Impact

### Before Improvements

**Example: Customer Meeting Signals**
- NFCU meeting: "NFCU talked about expanding IC Editor adoption"
- IRS meeting: "IRS demoed Automated Forms Conversion Service"
- LPL meeting: "LPL discussed form pre-filling use cases"

**Result:** ❌ No clustering (different wording, different customers)

### After Improvements

**Same Signals:**
- NFCU meeting: Extracts customer="NFCU", topics=["IC Editor", "Adoption/Expansion"]
- IRS meeting: Extracts customer="IRS", topics=["Automated Forms Conversion"]
- LPL meeting: Extracts customer="LPL Financial", topics=["Data Binding"]

**Result:** ✅ Better clustering potential:
- Signals with same customer will cluster (customer weight: 35%)
- Signals with same topics will cluster (topic weight: 20%)
- Lower threshold (15% vs 20%) catches more related signals

---

## 🔧 Configuration Examples

### Example 1: Stricter Clustering
```typescript
const opportunities = detectOpportunities(signals, {
  similarityThreshold: 0.25,  // Higher threshold
  requireSameType: true,        // Same signal type required
  minClusterSize: 3            // Need at least 3 signals
});
```

### Example 2: More Aggressive Clustering
```typescript
const opportunities = detectOpportunities(signals, {
  similarityThreshold: 0.10,   // Lower threshold
  requireSameSource: false,    // Allow cross-source clustering
  requireSameType: false,      // Allow different types
  timeWindowHours: 24 * 14     // 2 week window
});
```

### Example 3: Customer-Focused Clustering
```typescript
// Custom weights emphasizing customer matching
const similarity = calculateWeightedSimilarity(signal1, signal2, {
  wordSimilarityWeight: 0.2,
  customerWeight: 0.6,        // Very high weight on customer
  topicWeight: 0.15,
  timeWeight: 0.05
});
```

---

## 🧪 Testing Recommendations

### Test 1: Customer Signal Clustering
```typescript
// Test that customer meeting notes cluster together
const customerSignals = [
  { content: "Customer Name: NFCU\n...", ... },
  { content: "NFCU meeting notes...", ... },
  { content: "Customer: NFCU\n...", ... }
];
// Should cluster into 1 opportunity
```

### Test 2: Topic-Based Clustering
```typescript
// Test that signals about same topic cluster
const topicSignals = [
  { content: "IC Editor adoption discussion...", ... },
  { content: "IC Editor expansion plans...", ... }
];
// Should cluster even if different customers
```

### Test 3: Time-Based Clustering
```typescript
// Test that recent signals cluster together
const recentSignals = [
  { content: "...", created_at: new Date('2025-01-20') },
  { content: "...", created_at: new Date('2025-01-21') }
];
// Should have higher similarity due to time proximity
```

---

## 📈 Performance Considerations

### Computational Complexity
- **Before**: O(n²) for clustering (unchanged)
- **After**: O(n²) but with more computation per pair
  - Customer extraction: O(m) where m = text length
  - Topic extraction: O(m)
  - Weighted similarity: O(m + k) where k = number of topics/customers

### Optimization Opportunities
1. **Cache extracted entities**: Store customer names, topics in signal metadata
2. **Early termination**: Skip similarity calculation if source/type requirements fail
3. **Indexing**: Pre-extract entities during signal ingestion

---

## 🚀 Next Steps

### Short Term
1. ✅ Test with real Slack signals
2. ✅ Verify customer clustering works
3. ✅ Tune similarity thresholds based on results

### Medium Term
1. Cache extracted entities in signal metadata
2. Add signal enrichment during ingestion
3. Create admin UI for threshold configuration

### Long Term
1. Add LLM-based semantic similarity (hybrid approach)
2. Machine learning for optimal threshold tuning
3. Real-time opportunity detection

---

## 📝 Migration Notes

### Breaking Changes
- None - all changes are backward compatible
- Existing signals will use improved normalization on next processing
- Existing opportunities remain unchanged

### Database Changes
- None required
- New fields can be added to metadata if needed

---

## ✅ Summary

**Key Improvements:**
1. ✅ Better text normalization
2. ✅ Multi-factor similarity calculation
3. ✅ Customer and topic extraction
4. ✅ Improved opportunity titles and descriptions
5. ✅ Configurable detection parameters
6. ✅ Time-aware clustering

**Expected Results:**
- Better clustering of customer-related signals
- More meaningful opportunity titles
- More accurate similarity matching
- Configurable detection behavior
