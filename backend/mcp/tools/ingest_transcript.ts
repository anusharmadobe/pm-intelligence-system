import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { NormalizerService } from '../../ingestion/normalizer_service';
import { TranscriptAdapter } from '../../ingestion/transcript_adapter';
import { IngestionPipelineService } from '../../services/ingestion_pipeline_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'ingest_transcript',
  description: 'Ingest a meeting transcript',
  inputSchema: {
    title: z.string(),
    content: z.string(),
    meeting_type: z.string().optional(),
    customer: z.string().optional(),
    date: z.string().optional()
  },
  handler: async ({
    title,
    content,
    meeting_type,
    customer,
    date
  }: {
    title: string;
    content: string;
    meeting_type?: string;
    customer?: string;
    date?: string;
  }) => {
    try {
      const normalizer = new NormalizerService();
      const adapter = new TranscriptAdapter(normalizer);
      const pipeline = new IngestionPipelineService();
      const signals = adapter.ingest({ title, content, meeting_type, customer, date });
      await pipeline.ingest(signals);
      return textResponse(`Ingested ${signals.length} transcript segments.`);
    } catch (error) {
      logger.error('ingest_transcript failed', { error, title });
      throw error;
    }
  }
};
