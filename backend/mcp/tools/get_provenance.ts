import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { logger } from '../../utils/logger';
import { ProvenanceService } from '../../services/provenance_service';

export const tool = {
  name: 'get_provenance',
  description: 'Get provenance details for a signal',
  inputSchema: {
    signal_id: z.string()
  },
  handler: async ({ signal_id }: { signal_id: string }) => {
    try {
      const provenanceService = new ProvenanceService();
      const provenance = await provenanceService.getSignalProvenance(signal_id);
      return textResponse(
        JSON.stringify(
          provenance,
          null,
          2
        )
      );
    } catch (error) {
      logger.error('get_provenance failed', { error, signal_id });
      throw error;
    }
  }
};
