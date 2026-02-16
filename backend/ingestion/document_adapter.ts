import { fileTypeFromBuffer } from 'file-type';
import { extname } from 'path';
import { z } from 'zod';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { NormalizerService, RawSignal } from './normalizer_service';

export interface DocumentInput {
  filename: string;
  buffer: Buffer;
  metadata?: Record<string, unknown>;
}

interface ParsedSegment {
  text: string;
  metadata?: Record<string, unknown>;
}

export class DocumentAdapter {
  constructor(private normalizer: NormalizerService) {}

  private static readonly allowedExtensions = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt']);
  private static readonly mimeByExtension: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain'
  };
  private static readonly macroIndicators = [
    'vbaProject.bin',
    'vbaData',
    'macros/',
    'VBA/',
    '.exe',
    '.bat',
    '.sh'
  ];
  private static readonly pdfEncryptMarker = '/Encrypt';
  private static readonly maxPdfPages = 500;
  private static readonly maxPptSlides = 200;
  private static readonly maxXlsxRows = 100_000;

  private static readonly inputSchema = z.object({
    filename: z.string().min(1),
    buffer: z.instanceof(Buffer),
    metadata: z.record(z.string(), z.unknown()).optional()
  });

  private async validateFile(input: DocumentInput): Promise<string> {
    try {
      DocumentAdapter.inputSchema.parse(input);
      const sizeMb = input.buffer.length / (1024 * 1024);
      if (sizeMb > config.ingestion.maxFileSizeMb) {
        throw new Error(`File exceeds maximum size of ${config.ingestion.maxFileSizeMb}MB`);
      }

      const extension = extname(input.filename).replace('.', '').toLowerCase();
      if (!DocumentAdapter.allowedExtensions.has(extension)) {
        throw new Error(
          `Unsupported file type: ${extension || 'unknown'}. Allowed: pdf, docx, pptx, xlsx, csv, txt`
        );
      }

      const detected = await fileTypeFromBuffer(input.buffer);
      const fallbackMime = DocumentAdapter.mimeByExtension[extension] || 'application/octet-stream';
      const mime = detected?.mime || fallbackMime;
      const expectedMime = DocumentAdapter.mimeByExtension[extension];
      if (expectedMime && mime !== expectedMime) {
        throw new Error('File content does not match declared type');
      }

      if (extension === 'pdf') {
        if (input.buffer.includes(DocumentAdapter.pdfEncryptMarker)) {
          throw new Error('Password-protected files are not supported. Please provide an unencrypted version.');
        }
      }

      if (['docx', 'pptx', 'xlsx'].includes(extension)) {
        for (const indicator of DocumentAdapter.macroIndicators) {
          if (input.buffer.includes(indicator)) {
            throw new Error('File contains executable content');
          }
        }
      }

      return mime;
    } catch (error) {
      logger.error('Document validation failed', {
        error,
        filename: input.filename
      });
      throw error;
    }
  }

  private async parseWithPython(input: DocumentInput): Promise<ParsedSegment[]> {
    try {
      const parserUrl = process.env.DOCUMENT_PARSER_URL;
      if (!parserUrl) {
        throw new Error(
          'Document parser is not configured. Set DOCUMENT_PARSER_URL to enable document ingestion.'
        );
      }
      const form: any = new (global as any).FormData();
      const blob: any = new (global as any).Blob([input.buffer]);
      form.append('file', blob, input.filename);

      const response = await fetch(
        `${parserUrl.replace(/\/$/, '')}/parse`,
        {
          method: 'POST',
          body: form
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Document parser failed: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as { segments?: ParsedSegment[] };
      return data.segments || [];
    } catch (error) {
      logger.error('Document parser request failed', { error, filename: input.filename });
      throw error;
    }
  }

  async ingest(input: DocumentInput): Promise<RawSignal[]> {
    try {
      await this.validateFile(input);
      let segments = await this.parseWithPython(input);
      const extension = extname(input.filename).replace('.', '').toLowerCase();
      segments = this.applyLimits(segments, extension);

      if (!segments.length || segments.every((segment) => !segment.text || !segment.text.trim())) {
        throw new Error('File contains no extractable text content');
      }

      return segments.map((segment) =>
        this.normalizer.normalize({
          source: 'document',
          content: segment.text,
          metadata: { ...input.metadata, ...segment.metadata, filename: input.filename }
        })
      );
    } catch (error) {
      logger.error('Document ingestion failed', { error, filename: input.filename });
      throw error;
    }
  }

  private applyLimits(segments: ParsedSegment[], extension: string): ParsedSegment[] {
    if (!segments.length) return segments;

    const getPageNumber = (segment: ParsedSegment) => {
      const metadata = segment.metadata || {};
      const raw =
        metadata.page_number ??
        metadata.pageNumber ??
        metadata.page ??
        metadata.page_num ??
        metadata.slide_number ??
        metadata.slideNumber ??
        metadata.slide ??
        metadata.row_number ??
        metadata.rowNumber ??
        null;
      return typeof raw === 'number' ? raw : null;
    };

    if (extension === 'pdf') {
      const pages = segments
        .map(getPageNumber)
        .filter((value): value is number => value !== null);
      const maxPage = pages.length ? Math.max(...pages) : 0;
      if (maxPage > DocumentAdapter.maxPdfPages) {
        logger.warn('PDF exceeds max pages, truncating', { maxPage });
        return segments.filter((segment) => {
          const page = getPageNumber(segment);
          return page === null || page <= DocumentAdapter.maxPdfPages;
        });
      }
    }

    if (extension === 'pptx') {
      const slides = segments
        .map(getPageNumber)
        .filter((value): value is number => value !== null);
      const maxSlide = slides.length ? Math.max(...slides) : 0;
      if (maxSlide > DocumentAdapter.maxPptSlides) {
        logger.warn('PPTX exceeds max slides, truncating', { maxSlide });
        return segments.filter((segment) => {
          const slide = getPageNumber(segment);
          return slide === null || slide <= DocumentAdapter.maxPptSlides;
        });
      }
    }

    if (extension === 'xlsx') {
      const rows = segments
        .map(getPageNumber)
        .filter((value): value is number => value !== null);
      const maxRow = rows.length ? Math.max(...rows) : 0;
      if (maxRow > DocumentAdapter.maxXlsxRows) {
        logger.warn('XLSX exceeds max rows, truncating', { maxRow });
        return segments.filter((segment) => {
          const row = getPageNumber(segment);
          return row === null || row <= DocumentAdapter.maxXlsxRows;
        });
      }
    }

    return segments;
  }
}
