import { config } from '../config/env';
import { NormalizerService, RawSignal } from './normalizer_service';

export interface TranscriptInput {
  title: string;
  content: string;
  meeting_type?: string;
  customer?: string;
  date?: string;
  metadata?: Record<string, unknown>;
}

interface TranscriptSegment {
  speaker: string | null;
  text: string;
}

export class TranscriptAdapter {
  constructor(private normalizer: NormalizerService) {}

  private validateSize(content: string): void {
    const sizeMb = Buffer.byteLength(content, 'utf8') / (1024 * 1024);
    if (sizeMb > config.ingestion.maxFileSizeMb) {
      throw new Error(`Transcript exceeds maximum size of ${config.ingestion.maxFileSizeMb}MB`);
    }
  }

  private parseSegments(content: string): TranscriptSegment[] {
    const lines = content.split(/\r?\n/);
    const segments: TranscriptSegment[] = [];
    let current: TranscriptSegment | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE')) continue;
      // Skip VTT/SRT timecodes and numbering
      if (/^\d+$/.test(trimmed)) continue;
      if (/^\d{2}:\d{2}:\d{2}(\.\d+)?\s+-->\s+\d{2}:\d{2}:\d{2}/.test(trimmed)) continue;

      const speakerMatch = trimmed.match(/^([A-Za-z0-9 ._-]{2,40}):\s+(.*)$/);
      if (speakerMatch) {
        if (current) segments.push(current);
        current = { speaker: speakerMatch[1], text: speakerMatch[2] };
      } else if (current) {
        current.text += ` ${trimmed}`;
      } else {
        current = { speaker: null, text: trimmed };
      }
    }

    if (current) segments.push(current);
    return segments;
  }

  ingest(input: TranscriptInput): RawSignal[] {
    this.validateSize(input.content);
    const segments = this.parseSegments(input.content);

    return segments.map((segment) =>
      this.normalizer.normalize({
        source: 'transcript',
        content: segment.text,
        metadata: {
          title: input.title,
          meeting_type: input.meeting_type || 'unknown',
          customer: input.customer || null,
          speaker: segment.speaker,
          date: input.date || null,
          ...(input.metadata || {})
        },
        timestamp: input.date
      })
    );
  }
}
