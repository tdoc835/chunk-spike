/**
 * Embedding generation module using Vercel AI SDK v5 with AI Gateway
 *
 * Generates embeddings for document chunks using text-embedding-3-large model.
 * The AI Gateway handles provider routing automatically based on the model string prefix.
 */

import { embedMany } from 'ai';
import type { Chunk, ChunkEmbeddings } from './types';
import { sleep } from './utils';

/**
 * Generates embeddings for an array of chunks using Vercel AI SDK v5
 * Creates both full_vector (from fullText) and summary_vector (from summaryText)
 *
 * The AI Gateway routes requests based on the model string prefix (e.g., 'openai/')
 * No need to import provider-specific packages.
 *
 * @param chunks - Array of document chunks
 * @param maxRetries - Maximum retry attempts for rate limits (default: 3)
 * @returns Array of chunk embeddings
 */
export async function generateChunkEmbeddings(
  chunks: Chunk[],
  maxRetries: number = 3
): Promise<ChunkEmbeddings[]> {
  if (chunks.length === 0) {
    return [];
  }

  // Extract texts for embedding, ensuring non-empty strings
  const fullTexts = chunks.map(c => c.fullText || ' ');
  const summaryTexts = chunks.map(c => c.summaryText || ' ');

  console.log(`Generating embeddings for ${chunks.length} chunks...`);
  console.log(`  - Full text embeddings: ${fullTexts.length}`);
  console.log(`  - Summary text embeddings: ${summaryTexts.length}`);

  // Generate embeddings in parallel using Vercel AI SDK v5
  // The SDK handles batching internally
  console.log('\n  Generating embeddings...');

  const [fullResults, summaryResults] = await Promise.all([
    embedWithRetry(fullTexts, 'full', maxRetries),
    embedWithRetry(summaryTexts, 'summary', maxRetries),
  ]);

  console.log('  Embeddings generated successfully!');

  // Combine results
  return chunks.map((chunk, i) => ({
    chunkId: chunk.id,
    fullVector: fullResults[i],
    summaryVector: summaryResults[i],
  }));
}

/**
 * Generates embeddings with retry logic for rate limits
 *
 * @param texts - Array of texts to embed
 * @param label - Label for logging
 * @param maxRetries - Maximum retry attempts
 * @returns Array of embedding vectors
 */
async function embedWithRetry(
  texts: string[],
  label: string,
  maxRetries: number
): Promise<number[][]> {
  let lastError: Error | undefined;
  const initialDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`    [${label}] Generating embeddings (attempt ${attempt + 1}/${maxRetries})...`);

      const { embeddings } = await embedMany({
        model: 'openai/text-embedding-3-large',
        values: texts,
      });

      console.log(`    [${label}] Success! Generated ${embeddings.length} embeddings`);
      return embeddings;
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error
      const isRateLimit =
        error?.status === 429 ||
        error?.response?.status === 429 ||
        error?.code === 'rate_limit_exceeded' ||
        error?.message?.includes('rate limit') ||
        error?.message?.includes('Rate limit');

      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`    [${label}] Rate limited. Retrying in ${delay}ms... (attempt ${attempt + 2}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      // For non-rate-limit errors or last attempt, throw immediately
      if (!isRateLimit) {
        console.error(`    [${label}] Non-rate-limit error:`, error.message);
        throw error;
      }
    }
  }

  throw lastError || new Error(`Failed to generate ${label} embeddings after ${maxRetries} attempts`);
}

/**
 * Estimates the total token count for embedding
 * Used for cost estimation
 *
 * @param chunks - Array of chunks
 * @returns Estimated total tokens
 */
export function estimateTotalTokens(chunks: Chunk[]): number {
  // Rough estimate: ~4 characters per token
  let totalChars = 0;

  for (const chunk of chunks) {
    totalChars += (chunk.fullText || '').length;
    totalChars += (chunk.summaryText || '').length;
  }

  return Math.ceil(totalChars / 4);
}

/**
 * Calculates estimated embedding cost
 *
 * @param chunks - Array of chunks
 * @returns Formatted cost string
 */
export function estimateEmbeddingCost(chunks: Chunk[]): string {
  // text-embedding-3-large: ~$0.00013 per 1K tokens
  const costPer1kTokens = 0.00013;
  const totalTokens = estimateTotalTokens(chunks);
  const estimatedCost = (totalTokens / 1000) * costPer1kTokens;
  return `$${estimatedCost.toFixed(4)}`;
}
