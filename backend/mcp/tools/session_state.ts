import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import fs from 'fs';
import path from 'path';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('session_state', 'LOG_LEVEL_MCP');

const STATE_FILE = path.join(process.cwd(), '.claude', 'session_state.json');

export const tool = {
  name: 'save_session_state',
  description: 'Save current work context for resuming in the next Claude Code session',
  inputSchema: {
    current_task: z.string().describe('Brief description of what you are currently working on'),
    completed_steps: z.array(z.string()).describe('List of completed steps in this session'),
    next_steps: z.array(z.string()).describe('Planned next steps to continue work'),
    important_notes: z.string().optional().describe('Any critical context, decisions, or blockers'),
    files_modified: z.array(z.string()).optional().describe('List of files that were modified'),
    active_plan_file: z.string().optional().describe('Path to active plan file if in plan mode')
  },
  handler: async ({
    current_task,
    completed_steps,
    next_steps,
    important_notes,
    files_modified,
    active_plan_file
  }: {
    current_task: string;
    completed_steps: string[];
    next_steps: string[];
    important_notes?: string;
    files_modified?: string[];
    active_plan_file?: string;
  }) => {
    const startTime = Date.now();

    logger.info('Saving session state', {
      stage: 'session_state',
      status: 'start',
      current_task
    });

    try {
      // Ensure .claude directory exists
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const state = {
        current_task,
        completed_steps,
        next_steps,
        important_notes: important_notes || '',
        files_modified: files_modified || [],
        active_plan_file: active_plan_file || '',
        saved_at: new Date().toISOString(),
        session_duration_ms: Date.now() - (global as any).__session_start_time || 0
      };

      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

      logger.info('Session state saved successfully', {
        stage: 'session_state',
        status: 'success',
        file: STATE_FILE,
        completed_count: completed_steps.length,
        next_count: next_steps.length,
        duration_ms: Date.now() - startTime
      });

      return textResponse(
        `✅ Session state saved to ${STATE_FILE}\n\n` +
        `Current Task: ${current_task}\n` +
        `Completed: ${completed_steps.length} steps\n` +
        `Next: ${next_steps.length} steps\n` +
        `Saved at: ${state.saved_at}`
      );
    } catch (error: any) {
      logger.error('Failed to save session state', {
        stage: 'session_state',
        status: 'error',
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw new Error(`Failed to save session state: ${error.message}`);
    }
  }
};

export const loadTool = {
  name: 'load_session_state',
  description: 'Load the saved session state from the previous Claude Code session',
  inputSchema: {},
  handler: async () => {
    const startTime = Date.now();

    logger.info('Loading session state', {
      stage: 'session_state',
      status: 'load_start'
    });

    try {
      if (!fs.existsSync(STATE_FILE)) {
        logger.info('No session state found', {
          stage: 'session_state',
          status: 'not_found',
          file: STATE_FILE
        });
        return textResponse('No previous session state found.');
      }

      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      const state = JSON.parse(content);

      logger.info('Session state loaded successfully', {
        stage: 'session_state',
        status: 'success',
        saved_at: state.saved_at,
        duration_ms: Date.now() - startTime
      });

      return textResponse(
        `📋 Previous Session State (saved ${state.saved_at}):\n\n` +
        `**Current Task:** ${state.current_task}\n\n` +
        `**Completed Steps:**\n${state.completed_steps.map((s: string) => `  ✅ ${s}`).join('\n')}\n\n` +
        `**Next Steps:**\n${state.next_steps.map((s: string) => `  🔄 ${s}`).join('\n')}\n\n` +
        (state.important_notes ? `**Important Notes:**\n${state.important_notes}\n\n` : '') +
        (state.files_modified && state.files_modified.length > 0
          ? `**Files Modified:**\n${state.files_modified.map((f: string) => `  📝 ${f}`).join('\n')}\n\n`
          : '') +
        (state.active_plan_file ? `**Active Plan:** ${state.active_plan_file}\n\n` : '') +
        `**Session Duration:** ${Math.round(state.session_duration_ms / 1000 / 60)} minutes`
      );
    } catch (error: any) {
      logger.error('Failed to load session state', {
        stage: 'session_state',
        status: 'error',
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw new Error(`Failed to load session state: ${error.message}`);
    }
  }
};
