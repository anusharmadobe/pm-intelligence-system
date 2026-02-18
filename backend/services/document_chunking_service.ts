import { logger } from '../utils/logger';

export interface ChunkedSegment {
  text: string;
  index: number;
}

export class DocumentChunkingService {
  chunkText(text: string, maxChars = 2000): ChunkedSegment[] {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    const paragraphs = normalized.split(/\n{2,}/);
    const chunks: ChunkedSegment[] = [];
    let buffer = '';
    let index = 0;

    for (const para of paragraphs) {
      if ((buffer + '\n\n' + para).length > maxChars && buffer) {
        chunks.push({ text: buffer.trim(), index });
        index += 1;
        buffer = para;
        continue;
      }
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }

    if (buffer.trim()) {
      chunks.push({ text: buffer.trim(), index });
    }

    return chunks;
  }
}
