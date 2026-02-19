import fs from 'fs/promises';
import { createModuleLogger } from '../utils/logger';
import path from 'path';

const logger = createModuleLogger('file_validation', 'LOG_LEVEL_FILE_VALIDATION');

/**
 * File Validation Service
 * Validates uploaded files for security (MIME type, magic bytes, size)
 */

// Allowed MIME types for document uploads
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/msword', // .doc
  'application/vnd.ms-excel', // .xls
  'application/vnd.ms-powerpoint', // .ppt
  'text/plain', // .txt
  'text/csv', // .csv
  'text/markdown', // .md
  'application/json' // .json
];

// Allowed file extensions
export const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.doc',
  '.xls',
  '.ppt',
  '.txt',
  '.csv',
  '.md',
  '.json'
];

// Magic bytes (file signatures) for validation
// First few bytes of files to detect actual file type
const FILE_SIGNATURES: Record<string, { signature: Buffer; mimeType: string }> = {
  pdf: { signature: Buffer.from([0x25, 0x50, 0x44, 0x46]), mimeType: 'application/pdf' }, // %PDF
  zip: { signature: Buffer.from([0x50, 0x4B, 0x03, 0x04]), mimeType: 'application/zip' }, // PK.. (used by docx, xlsx, pptx)
  doc: { signature: Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), mimeType: 'application/msword' } // Old Office format
};

export interface FileValidationResult {
  valid: boolean;
  reason?: string;
  detectedMimeType?: string;
  fileSize?: number;
}

/**
 * Read first N bytes of file for magic byte detection
 */
async function readFileSignature(filePath: string, bytesToRead: number = 16): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

/**
 * Detect file type using magic bytes
 */
async function detectFileType(filePath: string): Promise<string | null> {
  try {
    const signature = await readFileSignature(filePath);

    // Check PDF
    if (signature.subarray(0, 4).equals(FILE_SIGNATURES.pdf.signature)) {
      return FILE_SIGNATURES.pdf.mimeType;
    }

    // Check ZIP-based formats (docx, xlsx, pptx)
    if (signature.subarray(0, 4).equals(FILE_SIGNATURES.zip.signature)) {
      // These are ZIP files, which includes Office Open XML formats
      // We'll accept them if they have the right extension
      return 'application/zip';
    }

    // Check old Office formats
    if (signature.subarray(0, 4).equals(FILE_SIGNATURES.doc.signature)) {
      return FILE_SIGNATURES.doc.mimeType;
    }

    // Text files (no specific signature, check if mostly text)
    const textCheck = signature.toString('utf8', 0, Math.min(signature.length, 512));
    const printableRatio = textCheck.split('').filter(c => {
      const code = c.charCodeAt(0);
      return (code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13;
    }).length / textCheck.length;

    if (printableRatio > 0.9) {
      return 'text/plain';
    }

    return null;
  } catch (error: any) {
    logger.error('File type detection failed', {
      error: error.message,
      filePath
    });
    return null;
  }
}

/**
 * Validate file extension
 */
function validateExtension(filename: string): { valid: boolean; reason?: string } {
  const ext = path.extname(filename).toLowerCase();

  if (!ext) {
    return {
      valid: false,
      reason: 'File has no extension'
    };
  }

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      reason: `File extension '${ext}' not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * Validate MIME type
 */
function validateMimeType(mimeType: string): { valid: boolean; reason?: string } {
  // Normalize MIME type (remove charset, etc.)
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();

  if (!ALLOWED_MIME_TYPES.includes(normalizedMime)) {
    return {
      valid: false,
      reason: `MIME type '${mimeType}' not allowed`
    };
  }

  return { valid: true };
}

/**
 * Validate file size
 */
function validateFileSize(fileSize: number, maxSizeMb: number = 50): { valid: boolean; reason?: string } {
  const maxBytes = maxSizeMb * 1024 * 1024;

  if (fileSize === 0) {
    return {
      valid: false,
      reason: 'File is empty (0 bytes)'
    };
  }

  if (fileSize > maxBytes) {
    return {
      valid: false,
      reason: `File size ${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds maximum ${maxSizeMb}MB`
    };
  }

  // Check for suspiciously small files (likely corrupted or test files)
  if (fileSize < 10) {
    return {
      valid: false,
      reason: 'File too small (< 10 bytes), possibly corrupted'
    };
  }

  return { valid: true };
}

/**
 * Check for path traversal attempts in filename
 */
function validateFilename(filename: string): { valid: boolean; reason?: string } {
  // Check for path traversal patterns
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return {
      valid: false,
      reason: 'Filename contains path traversal characters'
    };
  }

  // Check for special characters that could cause issues
  const dangerousChars = ['<', '>', ':', '"', '|', '?', '*', '\0'];
  for (const char of dangerousChars) {
    if (filename.includes(char)) {
      return {
        valid: false,
        reason: `Filename contains invalid character: ${char}`
      };
    }
  }

  // Check filename length
  if (filename.length > 255) {
    return {
      valid: false,
      reason: 'Filename too long (max 255 characters)'
    };
  }

  if (filename.length === 0) {
    return {
      valid: false,
      reason: 'Filename is empty'
    };
  }

  return { valid: true };
}

/**
 * Comprehensive file upload validation
 *
 * @param filePath - Path to uploaded file
 * @param originalFilename - Original filename from upload
 * @param declaredMimeType - MIME type declared by client
 * @param maxSizeMb - Maximum file size in MB
 * @returns Validation result
 */
export async function validateFileUpload(
  filePath: string,
  originalFilename: string,
  declaredMimeType: string,
  maxSizeMb: number = 50
): Promise<FileValidationResult> {
  try {
    // 1. Validate filename
    const sanitized = sanitizeFilename(originalFilename);
    const filenameCheck = validateFilename(originalFilename);

    logger.debug('Filename validation', {
      filename: originalFilename,
      sanitized: sanitized,
      valid: filenameCheck.valid
    });

    if (!filenameCheck.valid) {
      return {
        valid: false,
        reason: filenameCheck.reason
      };
    }

    // 2. Validate extension
    const ext = path.extname(originalFilename).toLowerCase();
    const extensionCheck = validateExtension(originalFilename);

    logger.debug('Extension validation', {
      extension: ext,
      allowed_extensions: ALLOWED_EXTENSIONS,
      valid: extensionCheck.valid
    });

    if (!extensionCheck.valid) {
      return {
        valid: false,
        reason: extensionCheck.reason
      };
    }

    // 3. Validate declared MIME type
    const mimeCheck = validateMimeType(declaredMimeType);

    logger.debug('MIME type validation', {
      declared_mime: declaredMimeType,
      allowed_types: ALLOWED_MIME_TYPES.length + ' types',
      valid: mimeCheck.valid
    });

    if (!mimeCheck.valid) {
      return {
        valid: false,
        reason: mimeCheck.reason
      };
    }

    // 4. Check file exists and get size
    const stats = await fs.stat(filePath);
    const sizeCheck = validateFileSize(stats.size, maxSizeMb);

    logger.debug('Size validation', {
      file_size_bytes: stats.size,
      file_size_mb: (stats.size / 1024 / 1024).toFixed(2),
      max_size_mb: maxSizeMb,
      valid: sizeCheck.valid
    });

    if (!sizeCheck.valid) {
      return {
        valid: false,
        reason: sizeCheck.reason,
        fileSize: stats.size
      };
    }

    // 5. Detect actual file type using magic bytes
    const detectedMimeType = await detectFileType(filePath);

    if (!detectedMimeType) {
      logger.debug('Magic bytes validation failed', {
        detected_mime: null,
        valid: false
      });

      return {
        valid: false,
        reason: 'Could not determine file type from content',
        fileSize: stats.size
      };
    }

    // 6. Verify detected type is compatible with declared type
    // For Office Open XML formats (docx, xlsx, pptx), detected type will be 'application/zip'
    const fileExt = path.extname(originalFilename).toLowerCase();
    const officeExtensions = ['.docx', '.xlsx', '.pptx'];

    const compatible =
      (officeExtensions.includes(fileExt) && detectedMimeType === 'application/zip') ||
      detectedMimeType === 'text/plain' ||
      declaredMimeType.split('/')[0] === detectedMimeType.split('/')[0] ||
      detectedMimeType === 'application/zip';

    logger.debug('Magic bytes validation', {
      declared_mime: declaredMimeType,
      detected_mime: detectedMimeType,
      compatible: compatible,
      valid: compatible || officeExtensions.includes(fileExt)
    });

    if (officeExtensions.includes(fileExt) && detectedMimeType === 'application/zip') {
      // This is OK - Office Open XML formats are ZIP files
      logger.debug('Office Open XML format detected', {
        filename: originalFilename,
        declaredMimeType,
        detectedMimeType: 'ZIP (Office format)'
      });
    } else if (detectedMimeType !== 'text/plain') {
      // For non-text files, detected type should match general category
      const declaredCategory = declaredMimeType.split('/')[0];
      const detectedCategory = detectedMimeType.split('/')[0];

      // Relaxed check: same category or explicitly allowed mismatch
      if (declaredCategory !== detectedCategory && detectedMimeType !== 'application/zip') {
        return {
          valid: false,
          reason: `File type mismatch: declared as '${declaredMimeType}', detected as '${detectedMimeType}'`,
          detectedMimeType,
          fileSize: stats.size
        };
      }
    }

    // All checks passed
    logger.info('File upload validation successful', {
      filename: originalFilename,
      declaredMimeType,
      detectedMimeType,
      fileSize: stats.size
    });

    return {
      valid: true,
      detectedMimeType,
      fileSize: stats.size
    };
  } catch (error: any) {
    logger.error('File validation error', {
      error: error.message,
      stack: error.stack,
      filePath,
      filename: originalFilename
    });
    return {
      valid: false,
      reason: `Validation error: ${error.message}`
    };
  }
}

/**
 * Sanitize filename for safe storage
 * Removes potentially dangerous characters
 */
export function sanitizeFilename(filename: string): string {
  // Replace spaces with underscores
  let sanitized = filename.replace(/\s+/g, '_');

  // Remove or replace special characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '');

  // Remove multiple consecutive dots
  sanitized = sanitized.replace(/\.{2,}/g, '.');

  // Ensure it doesn't start with a dot
  sanitized = sanitized.replace(/^\.+/, '');

  // Limit length
  if (sanitized.length > 200) {
    const ext = path.extname(sanitized);
    const basename = path.basename(sanitized, ext);
    sanitized = basename.substring(0, 200 - ext.length) + ext;
  }

  const finalSanitized = sanitized || 'unnamed_file';

  if (filename !== finalSanitized) {
    logger.debug('Filename sanitized', {
      original: filename,
      sanitized: finalSanitized,
      changes_made: true
    });
  }

  return finalSanitized;
}
