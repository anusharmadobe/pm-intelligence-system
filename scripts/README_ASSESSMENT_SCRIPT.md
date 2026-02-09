# Weekly Update Assessment Script

## Overview

This script analyzes weekly status updates to determine if they qualify as customer wins and provides constructive feedback with clarifying questions. Designed for integration with a Slack bot to help team members improve their weekly updates.

## Features

- ✅ **Win Qualification Assessment**: Determines if an update qualifies as a win (high/medium/low confidence)
- ✅ **Customer Name Detection**: Identifies customer names in updates
- ✅ **Quantifiable Metrics Extraction**: Finds numbers, percentages, counts, etc.
- ✅ **Completion Language Detection**: Distinguishes between activity ("working on") and completion ("delivered")
- ✅ **Business Impact Analysis**: Evaluates if the update demonstrates business impact
- ✅ **Clarifying Questions**: Generates specific questions to improve the update
- ✅ **Actionable Suggestions**: Provides concrete recommendations

## Usage

### Command Line

```bash
npx ts-node scripts/assess_weekly_update.ts "<update text>" [--user <name>] [--date <date>]
```

### Examples

**Example 1: Weak Update (Doesn't Qualify)**
```bash
npx ts-node scripts/assess_weekly_update.ts "Worked on migrating content from EXL to AEM Live for EDS documents" --user "Ruchita" --date "2026-01-24"
```

**Example 2: Good Update (Qualifies)**
```bash
npx ts-node scripts/assess_weekly_update.ts "Unblocked Adobe Consulting and UBS by authoring critical Rich Text documentation for Document of Record" --user "Khushwant" --date "2025-09-19"
```

**Example 3: Update with Metrics**
```bash
npx ts-node scripts/assess_weekly_update.ts "Authored 3 Setup Guide articles and 2 Troubleshooting articles for AEM Forms 6.5 LTS SP1" --user "Bhumika" --date "2026-01-16"
```

### Programmatic Usage

```typescript
import { assessWeeklyUpdate, formatAssessmentForSlack } from './scripts/assess_weekly_update';

const update = {
  text: "Delivered 5 articles to NFCU customer",
  user: "John Doe",
  date: "2026-01-24"
};

const result = assessWeeklyUpdate(update);
const formatted = formatAssessmentForSlack(result, update);

console.log(formatted);
```

## Assessment Criteria

### Scoring System (0-100 points)

- **Customer Name**: 30 points (if present)
- **Quantifiable Metrics**: Up to 40 points (20 points per metric)
- **Completion Language**: 20 points (if uses completion verbs)
- **Business Impact**: 20 points (if demonstrates impact)

### Win Qualification

- **High Confidence**: Customer name + Quantifiable metrics + Completion + Impact
- **Medium Confidence**: (Customer name OR Quantifiable metrics) + Completion + Impact
- **Low Confidence**: Completion + Impact + Score >= 40, but missing customer/metrics

### Categories

- **customer**: Update mentions a specific customer
- **productivity**: Update shows productivity improvements
- **business**: Update demonstrates business impact
- **other**: Update qualifies but doesn't fit above categories
- **none**: Update doesn't qualify as a win

## Output Format

The script outputs:
1. **Human-readable assessment** (formatted for Slack)
2. **JSON output** (for programmatic use)

### JSON Structure

```json
{
  "qualifiesAsWin": true,
  "confidence": "medium",
  "category": "customer",
  "score": 70,
  "strengths": ["✅ Mentions customer: UBS", "✅ Uses completion language"],
  "weaknesses": ["❌ No quantifiable metrics"],
  "clarifyingQuestions": ["❓ Question 1", "❓ Question 2"],
  "suggestions": ["💡 Suggestion 1", "💡 Suggestion 2"],
  "customerName": "UBS",
  "quantifiableMetrics": "2 new enrollments",
  "businessImpact": "Impact identified"
}
```

## Slack Bot Integration

### Example Slack Bot Handler

```typescript
import { assessWeeklyUpdate, formatAssessmentForSlack } from './scripts/assess_weekly_update';

// Slack event handler
app.message(async ({ message, say }) => {
  // Check if message is in weekly status thread
  if (message.thread_ts && message.text) {
    const update = {
      text: message.text,
      user: message.user,
      date: new Date().toISOString().split('T')[0]
    };
    
    const result = assessWeeklyUpdate(update);
    const formatted = formatAssessmentForSlack(result, update);
    
    // Reply in thread with assessment
    await say({
      text: formatted,
      thread_ts: message.thread_ts
    });
  }
});
```

### Slack Bot Features to Implement

1. **Automatic Assessment**: When someone posts in weekly status thread, automatically assess
2. **Interactive Feedback**: Ask clarifying questions and wait for responses
3. **Score Tracking**: Track improvement over time
4. **Win Leaderboard**: Show who has the most high-confidence wins
5. **Reminders**: Remind team to include customer names and metrics

## Improving Updates

### What Makes a Strong Win?

✅ **Includes:**
- Customer name (e.g., "Delivered X to Customer Y")
- Quantifiable metrics (e.g., "5 articles", "20% improvement", "2 customers")
- Completion language (e.g., "delivered", "shipped", "completed")
- Business impact (e.g., "unblocked customer", "enabled renewal")

❌ **Avoids:**
- Activity language ("working on", "preparing", "discussing")
- Vague descriptions without specifics
- Work-in-progress items (unless clearly marked)

### Example Transformations

**Before:**
> "Worked on migrating content from EXL to AEM Live for EDS documents"

**After:**
> "Completed migration of 15 documents from EXL to AEM Live for EDS customer, enabling faster content updates"

**Before:**
> "Preparing proposal for Travel Port"

**After:**
> "Delivered modernization proposal to Travel Port for migration from 6.3 JEE to CS, estimated to reduce maintenance costs by 30%"

## Known Limitations

1. **Customer Name Detection**: May miss new customers not in the known list
2. **Context Missing**: Doesn't understand project context or relationships
3. **False Positives**: May flag routine work as wins if it uses completion language
4. **Metrics Extraction**: May miss complex metric descriptions

## Future Enhancements

- [ ] Machine learning model for better win detection
- [ ] Integration with Jira to pull ticket completion data
- [ ] Customer database integration for better name detection
- [ ] Historical comparison (compare this week vs last week)
- [ ] Team-specific criteria customization
- [ ] Multi-language support
