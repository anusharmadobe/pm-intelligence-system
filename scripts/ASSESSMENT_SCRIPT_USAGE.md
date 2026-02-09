# Weekly Update Assessment Script - Usage Guide

## Quick Start

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

### 2. Run Assessment

```bash
npx ts-node scripts/assess_weekly_update.ts "Your update text here"
```

### 3. With Options

```bash
npx ts-node scripts/assess_weekly_update.ts "Your update text here" --user "John Doe" --date "2026-01-24"
```

## Examples

### Example 1: Weak Update

**Input:**
```bash
npx ts-node scripts/assess_weekly_update.ts "Worked on migrating content from EXL to AEM Live for EDS documents"
```

**Output:**
- ❌ Does NOT qualify as win
- Score: 30/100
- Missing: Quantifiable metrics, completion language, business impact
- Questions: Asks about completion status, metrics, impact

### Example 2: Good Update

**Input:**
```bash
npx ts-node scripts/assess_weekly_update.ts "Unblocked Adobe Consulting and UBS by authoring critical Rich Text documentation for Document of Record"
```

**Output:**
- ✅ Qualifies as win
- Confidence: Medium
- Score: 70/100
- Strengths: Customer name, completion language, business impact
- Suggestion: Add quantifiable metrics

### Example 3: Strong Update

**Input:**
```bash
npx ts-node scripts/assess_weekly_update.ts "Delivered 2 new customer enrollments for Exp Builder EA: Lumen and Brunswick, plus Micron interested in evaluation"
```

**Output:**
- ✅ Qualifies as win
- Confidence: High
- Score: 90/100
- Strengths: Customer names, quantifiable metrics, completion language, business impact

## Integration with Slack Bot

### Step 1: Set Up Slack Bot

1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode
3. Add Bot Token Scopes:
   - `chat:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
   - `commands`

### Step 2: Configure Environment Variables

```bash
export SLACK_BOT_TOKEN=xoxb-your-bot-token
export SLACK_SIGNING_SECRET=your-signing-secret
export SLACK_APP_TOKEN=xapp-your-app-token
```

### Step 3: Run Bot

```bash
npx ts-node scripts/slack_bot_example.ts
```

### Step 4: Use in Slack

1. **Automatic Assessment**: Post updates in weekly status thread → Bot automatically assesses
2. **Manual Command**: Use `/assess-update Your update text` anywhere
3. **Interactive**: Click "Get Assessment" button on any message

## Assessment Criteria Explained

### What Qualifies as a Win?

A win must have:
1. **Completion Language** (required)
   - ✅ "delivered", "shipped", "completed", "launched"
   - ❌ "working on", "preparing", "discussing"

2. **Business Impact** (required)
   - ✅ "unblocked customer", "enabled renewal", "drove adoption"
   - ❌ Just describing work without impact

3. **Customer Name OR Quantifiable Metrics** (at least one)
   - ✅ Customer: "Delivered X to Customer Y"
   - ✅ Metrics: "5 articles", "20% improvement", "2 customers"

### Confidence Levels

- **High**: Customer + Metrics + Completion + Impact
- **Medium**: (Customer OR Metrics) + Completion + Impact
- **Low**: Completion + Impact, but missing customer/metrics

### Scoring

- Customer Name: 30 points
- Quantifiable Metrics: Up to 40 points (20 per metric)
- Completion Language: 20 points
- Business Impact: 20 points
- **Total: 0-100 points**

## Common Issues & Solutions

### Issue: Update doesn't qualify but seems like a win

**Solution:** Check if it has:
- Completion language? (not "working on")
- Business impact? (not just describing work)
- Customer name OR metrics?

### Issue: Customer name not detected

**Solution:** 
- Make sure customer name is capitalized
- Use format: "Delivered X to Customer Y"
- Add customer to known customers list in script

### Issue: Metrics not detected

**Solution:**
- Use format: "Completed 5 articles" or "5 articles completed"
- Include units: "20% improvement", "2 hours saved"
- Be explicit: "Authored 3 Setup Guide articles"

## Tips for Writing Strong Updates

### ✅ DO:

- Use past tense completion verbs: "delivered", "shipped", "completed"
- Include customer names when relevant
- Add specific numbers: "5 articles", "20% improvement", "2 customers"
- Explain impact: "unblocked customer", "enabled renewal", "drove adoption"
- Be specific: "Delivered X to Customer Y" not "Worked on X"

### ❌ DON'T:

- Use activity language: "working on", "preparing", "discussing"
- Be vague: "Did some work" → "Completed 5 articles"
- Skip customer names: "Delivered documentation" → "Delivered documentation to UBS"
- Forget metrics: "Published articles" → "Published 5 articles"
- Describe work without impact: "Created feature" → "Created feature that unblocked Customer X"

## Advanced Usage

### Batch Assessment

```typescript
import { assessWeeklyUpdate } from './scripts/assess_weekly_update';

const updates = [
  { text: "Update 1", user: "User 1", date: "2026-01-24" },
  { text: "Update 2", user: "User 2", date: "2026-01-24" },
];

const results = updates.map(update => ({
  update,
  assessment: assessWeeklyUpdate(update)
}));

// Filter high-confidence wins
const wins = results.filter(r => r.assessment.qualifiesAsWin && r.assessment.confidence === 'high');
```

### Custom Scoring

```typescript
const result = assessWeeklyUpdate(update);

// Adjust score based on custom criteria
if (result.customerName === 'Important Customer') {
  result.score += 10;
}

if (result.score >= 80) {
  result.qualifiesAsWin = true;
  result.confidence = 'high';
}
```

## Troubleshooting

### Script doesn't run

```bash
# Check TypeScript is installed
npm install -g typescript ts-node

# Check Node version (requires Node 14+)
node --version
```

### Import errors

```bash
# Make sure you're in the project root
cd /Users/anusharm/learn/PM_cursor_system

# Check tsconfig.json exists
ls tsconfig.json
```

### Slack bot not responding

1. Check bot token is valid
2. Check bot is invited to channel
3. Check Socket Mode is enabled
4. Check app token is set
5. Check bot has required scopes

## Support

For issues or questions:
1. Check this documentation
2. Review example outputs
3. Test with known good/bad examples
4. Check script logs for errors
