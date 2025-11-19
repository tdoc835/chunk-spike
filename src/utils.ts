/**
 * Utility functions for file discovery, batching, and retry logic
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Supported file extensions for document processing
 */
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.ppt', '.txt', '.md', '.html', '.eml', '.msg'];

/**
 * Recursively finds all supported documents in a directory
 *
 * @param dir - Root directory to search
 * @returns Array of absolute file paths
 */
export async function findAllDocuments(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      console.warn(`Warning: Cannot read directory ${currentDir}: ${(error as Error).message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  const absoluteDir = path.resolve(dir);
  await walk(absoluteDir);
  return files.sort();
}

/**
 * Splits an array into batches of a specified size
 *
 * @param array - Array to split
 * @param batchSize - Maximum size of each batch
 * @returns Array of batches
 */
export function chunk<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes a function with exponential backoff retry logic
 * Particularly useful for handling API rate limits
 *
 * @param fn - Async function to execute
 * @param maxRetries - Maximum number of retry attempts
 * @param initialDelay - Initial delay in milliseconds (doubles each retry)
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error (HTTP 429)
      const isRateLimit = error?.status === 429 ||
                          error?.response?.status === 429 ||
                          error?.code === 'rate_limit_exceeded';

      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`  Rate limited. Retrying in ${delay}ms... (attempt ${attempt + 2}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      // For non-rate-limit errors or last attempt, throw immediately
      if (!isRateLimit) {
        throw error;
      }
    }
  }

  throw lastError;
}

/**
 * Formats a number with thousands separators
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Calculates estimated embedding cost
 *
 * @param totalChunks - Number of chunks
 * @param avgTokensPerChunk - Average tokens per chunk
 * @returns Formatted cost string
 */
export function estimateEmbeddingCost(totalChunks: number, avgTokensPerChunk: number = 500): string {
  // text-embedding-3-large: ~$0.00013 per 1K tokens
  const costPer1kTokens = 0.00013;
  const totalEmbeddings = totalChunks * 2; // full + summary
  const totalTokens = totalEmbeddings * avgTokensPerChunk;
  const estimatedCost = (totalTokens / 1000) * costPer1kTokens;
  return `$${estimatedCost.toFixed(2)}`;
}
