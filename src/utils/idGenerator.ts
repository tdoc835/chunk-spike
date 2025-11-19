import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Generates a deterministic document ID from an absolute file path
 * Uses SHA-256 hash truncated to 16 characters for uniqueness while keeping IDs manageable
 *
 * @param filePath - The file path (will be resolved to absolute)
 * @returns A deterministic hash string
 */
export function generateDocId(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(absolutePath);
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
