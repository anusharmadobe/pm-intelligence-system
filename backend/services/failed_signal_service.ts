import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';

export type FailedSignalStatus = 'pending' | 'recovered' | 'permanent_fail';

export async function recordFailedSignalAttempt(params: {
  signalId: string;
  sourceRef: string | null;
  runId: string;
  errorType: string;
  errorMessage: string;
  status?: FailedSignalStatus;
}): Promise<void> {
  logger.warn('Recording failed signal attempt', {
    stage: 'failed_signal_tracking',
    status: params.status || 'pending',
    signal_id: params.signalId,
    source_ref: params.sourceRef,
    run_id: params.runId,
    error_type: params.errorType,
    error_message_preview: params.errorMessage.substring(0, 200)
  });

  try {
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO failed_signal_attempts
        (signal_id, source_ref, run_id, error_type, error_message, status, attempt_count, failed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
       ON CONFLICT (signal_id) DO UPDATE SET
         source_ref = EXCLUDED.source_ref,
         run_id = EXCLUDED.run_id,
         error_type = EXCLUDED.error_type,
         error_message = EXCLUDED.error_message,
         status = EXCLUDED.status,
         attempt_count = failed_signal_attempts.attempt_count + 1,
         updated_at = NOW()`,
      [
        params.signalId,
        params.sourceRef,
        params.runId,
        params.errorType,
        params.errorMessage.slice(0, 2000),
        params.status || 'pending'
      ]
    );

    logger.info('Failed signal attempt recorded', {
      stage: 'failed_signal_tracking',
      signal_id: params.signalId,
      status: params.status || 'pending'
    });
  } catch (error: any) {
    logger.error('Failed to record failed signal attempt', {
      stage: 'failed_signal_tracking',
      signal_id: params.signalId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export async function markFailedSignalRecovered(signalId: string): Promise<void> {
  logger.info('Marking signal as recovered', {
    stage: 'failed_signal_tracking',
    status: 'recovered',
    signal_id: signalId
  });

  try {
    const pool = getDbPool();
    await pool.query(
      `UPDATE failed_signal_attempts
       SET status = 'recovered', replayed_at = NOW(), updated_at = NOW()
       WHERE signal_id = $1`,
      [signalId]
    );

    logger.info('Signal marked as recovered', {
      stage: 'failed_signal_tracking',
      status: 'success',
      signal_id: signalId
    });
  } catch (error: any) {
    logger.error('Failed to mark signal as recovered', {
      stage: 'failed_signal_tracking',
      signal_id: signalId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}
