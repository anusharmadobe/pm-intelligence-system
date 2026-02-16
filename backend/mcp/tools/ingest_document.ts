import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { NormalizerService } from '../../ingestion/normalizer_service';
import { DocumentAdapter } from '../../ingestion/document_adapter';
import { IngestionPipelineService } from '../../services/ingestion_pipeline_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'ingest_document',
  description: 'Ingest a document (PDF, DOCX, PPTX, XLSX, CSV, TXT)',
  inputSchema: {
    filename: z.string(),
    content_base64: z.string().optional(),
    content: z.string().optional()
  },
  handler: async ({
    filename,
    content_base64,
    content
  }: {
    filename: string;
    content_base64?: string;
    content?: string;
  }) => {
    try {
      if (!content_base64 && !content) {
        return textResponse('Missing document content');
      }

      const buffer = content_base64
        ? Buffer.from(content_base64, 'base64')
        : Buffer.from(content || '', 'utf8');

      const normalizer = new NormalizerService();
      const adapter = new DocumentAdapter(normalizer);
      const pipeline = new IngestionPipelineService();
      const signals = await adapter.ingest({ filename, buffer });
      await pipeline.ingest(signals);
      return textResponse(`Ingested ${signals.length} document segments.`);
    } catch (error) {
      logger.error('ingest_document failed', { error, filename });
      throw error;
    }
  }
};
