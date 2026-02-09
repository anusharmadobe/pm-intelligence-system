# How to Use "PM Intelligence: Create Judgment" Command

## Quick Steps

### Step 1: Open Command Palette
- **Mac:** Press `Cmd+Shift+P`
- **Windows/Linux:** Press `Ctrl+Shift+P`

### Step 2: Search for Command
Type: `PM Intelligence: Create Judgment`

### Step 3: Select Opportunity
- A dropdown list will appear showing all detected opportunities
- Select the opportunity you want to create a judgment for
- Each opportunity shows:
  - Title (e.g., "NFCU & IRS - Feature Request - nfcu (118 signals)")
  - Description preview

### Step 4: Enter User ID
- When prompted, enter your user ID (required for human-in-the-loop)
- Example: `user@example.com` or `your-name`
- This ensures judgments are traceable to a human reviewer

### Step 5: Wait for LLM Processing
- Cursor's built-in LLM will analyze the opportunity
- It will:
  - Review all signals in the opportunity
  - Generate a summary
  - Identify assumptions
  - List missing evidence
  - Assess confidence level

### Step 6: Review Results
- You'll see a success message: `Judgment created: [id] (confidence: [level])`
- The judgment is now stored in the database

---

## What Happens Behind the Scenes

1. **Fetches Opportunity Data**
   - Retrieves the selected opportunity
   - Gets all signals associated with that opportunity

2. **LLM Analysis**
   - Uses Cursor's built-in LLM (via `vscode.lm` API)
   - Analyzes signal patterns and content
   - Generates structured analysis

3. **Creates Judgment**
   - Summary: Overview of the opportunity
   - Assumptions: What assumptions were made
   - Missing Evidence: What additional data would help
   - Confidence Level: High, Medium, or Low

4. **Stores in Database**
   - Judgment is saved (append-only, never overwritten)
   - Linked to the opportunity
   - Available for artifact generation

---

## Troubleshooting

### Command Not Found?

**Issue:** "PM Intelligence: Create Judgment" doesn't appear in Command Palette

**Solution 1: Check Extension Installation**
The extension needs to be built and loaded. Check if it's active:
1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Type: `Developer: Show Running Extensions`
3. Look for "PM Intelligence" extension

**Solution 2: Build Extension**
```bash
cd backup/cursor_extension/cursor_extension
npm install
npm run compile  # or: npx tsc
```

**Solution 3: Reload Cursor**
- Press `Cmd+Shift+P` / `Ctrl+Shift+P`
- Run: `Developer: Reload Window`

**Solution 4: Use Alternative Method**
If extension isn't available, you can create judgments programmatically (see below)

---

## Alternative: Create Judgment Programmatically

If the extension command isn't available, you can create a script:

```typescript
// scripts/create_judgment.ts
import { createJudgment } from '../backend/services/judgment_service';
import { getAllOpportunities } from '../backend/services/opportunity_service';
import { createCursorLLMProvider } from './llm_helper'; // You'd need to create this

async function createJudgmentForOpportunity(opportunityId: string, userId: string) {
  const llmProvider = createCursorLLMProvider(); // Requires Cursor's LLM API
  const judgment = await createJudgment(opportunityId, userId, llmProvider);
  console.log('Judgment created:', judgment);
}
```

**Note:** This still requires Cursor's LLM API (`vscode.lm`), which is only available within Cursor IDE's extension context.

---

## Prerequisites

1. **API Server Running**
   ```bash
   npm start
   # Or: npm run dev
   ```

2. **Opportunities Detected**
   - Run opportunity detection first:
   ```bash
   curl -X POST http://localhost:3000/api/opportunities/detect/incremental
   ```

3. **Cursor IDE**
   - Must be running Cursor IDE (not VS Code)
   - Extension must be loaded
   - LLM API must be available

---

## Example Workflow

```bash
# 1. Ensure API server is running
npm start

# 2. Detect opportunities (if not done already)
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# 3. List opportunities to find ID
curl http://localhost:3000/api/opportunities | jq '.opportunities[0].id'

# 4. In Cursor IDE:
#    - Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)
#    - Type: "PM Intelligence: Create Judgment"
#    - Select opportunity
#    - Enter user ID
#    - Review judgment
```

---

## Viewing Created Judgments

After creating a judgment, view it:

**Via API:**
```bash
curl http://localhost:3000/api/judgments/{opportunity_id}
```

**Via Extension:**
- Use command: `PM Intelligence: View Opportunities`
- Select an opportunity
- View associated judgments

---

## What Judgments Include

Each judgment contains:

1. **Summary**
   - LLM-generated overview of the opportunity
   - Context from all signals
   - Key themes and patterns

2. **Assumptions**
   - What assumptions were made in the analysis
   - Helps identify potential biases

3. **Missing Evidence**
   - What additional data would strengthen the analysis
   - Gaps in current information

4. **Confidence Level**
   - **High:** Strong signal patterns, clear evidence
   - **Medium:** Some patterns, but gaps exist
   - **Low:** Weak patterns, significant uncertainty

---

## Next Steps After Creating Judgment

1. **Review Judgment**
   - Check assumptions
   - Identify evidence gaps
   - Assess confidence level

2. **Create Artifact**
   - Use command: `PM Intelligence: Create Artifact`
   - Select the judgment
   - Choose PRD or RFC type
   - Generate document

3. **Update Opportunity Status**
   - Mark as "in_progress" if acting on it
   - Mark as "resolved" if addressed
   - Mark as "archived" if not pursuing

---

## Tips

- **Select High-Signal Opportunities:** Focus on opportunities with 50+ signals for more comprehensive judgments
- **Review Multiple Judgments:** Create judgments for different opportunities to compare patterns
- **Check Missing Evidence:** Use missing evidence lists to guide further data collection
- **Track Confidence:** Lower confidence judgments may need more investigation

---

## Need Help?

If the command doesn't work:
1. Check extension is installed: `Developer: Show Running Extensions`
2. Check API server is running: `curl http://localhost:3000/health`
3. Check opportunities exist: `curl http://localhost:3000/api/opportunities`
4. Try reloading Cursor: `Developer: Reload Window`
