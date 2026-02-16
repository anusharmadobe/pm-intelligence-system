import { getDbPool } from '../db/connection';
import { FeedbackService } from './feedback_service';

export class AliasManagementService {
  private feedbackService = new FeedbackService();

  async addAlias(entityId: string, alias: string, source = 'manual'): Promise<void> {
    await this.feedbackService.addAlias(entityId, alias, source);
  }

  async deactivateAlias(aliasId: string): Promise<void> {
    const pool = getDbPool();
    await pool.query(
      `UPDATE entity_aliases
       SET is_active = false
       WHERE id = $1`,
      [aliasId]
    );
  }
}
