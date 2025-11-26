import * as crypto from 'crypto';

/**
 * Generates a deterministic document ID from an S3 key
 * Uses SHA-256 hash truncated to 16 characters for uniqueness while keeping IDs manageable
 *
 * @param s3Key - The S3 object key (e.g., "documents/report.pdf")
 * @returns A deterministic hash string
 */
export function generateDocId(s3Key: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(s3Key);
  return hash.digest('hex').substring(0, 16);
}

/**
 * Generates a stable chunk ID from document ID and chunk index
 * Format: docId::chunkIndex
 *
 * @param docId - The document ID
 * @param chunkIndex - The 0-based chunk index
 * @returns A stable chunk ID string
 */
export function generateChunkId(docId: string, chunkIndex: number): string {
  return `${docId}::${chunkIndex}`;
}
