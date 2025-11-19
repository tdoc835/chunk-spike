/**
 * OpenAI embedding generation module
 *
 * Generates embeddings for document chunks using text-embedding-3-large model.
 * Uses batching for efficient API calls and includes retry logic for rate limits.
 */

import OpenAI from 'openai';
import type { Chunk } from './types';
import { chunk as batchArray, withRetry } from './utils';

/**
 * Embedding results for a single chunk
 */
export interface ChunkEmbeddings {
  chunkId: string;
  fullVector: number[];
  summaryVector: number[];
}

/**
 * Generates embeddings for an array of chunks
 * Creates both full_vector (from fullText) and summary_vector (from summaryText)
 *
 * @param chunks - Array of document chunks
 * @param openai - OpenAI client instance
 * @param batchSize - Number of texts to embed per API call (default: 100)
 * @param maxRetries - Maximum retry attempts for rate limits
 * @returns Array of chunk embeddings
 */
export async function generateChunkEmbeddings(
  chunks: Chunk[],
  openai: OpenAI,
  batchSize: number = 100,
  maxRetries: number = 3
): Promise<ChunkEmbeddings[]> {
  if (chunks.length === 0) {
    return [];
  }

  // Extract texts for embedding
  const fullTexts = chunks.map(c => c.fullText || ' ');  // Ensure non-empty
  const summaryTexts = chunks.map(c => c.summaryText || ' ');

  console.log(`\nGenerating embeddings for ${chunks.length} chunks...`);
  console.log(`  - Full text embeddings: ${fullTexts.length}`);
  console.log(`  - Summary text embeddings: ${summaryTexts.length}`);

  // Generate embeddings for full texts
  console.log('\n  Embedding full texts...');
  const fullVectors = await batchEmbed(
    openai,
    fullTexts,
    batchSize,
    maxRetries,
    'full'
  );

  // Generate embeddings for summary texts
  console.log('\n  Embedding summary texts...');
  const summaryVectors = await batchEmbed(
    openai,
    summaryTexts,
    batchSize,
    maxRetries,
    'summary'
  );

  // Combine results
  return chunks.map((chunk, i) => ({
    chunkId: chunk.id,
    fullVector: fullVectors[i],
    summaryVector: summaryVectors[i]
  }));
}

/**
 * Batch embeds an array of texts using OpenAI API
 *
 * @param openai - OpenAI client
 * @param texts - Array of texts to embed
 * @param batchSize - Texts per API call
 * @param maxRetries - Retry attempts for rate limits
 * @param label - Label for progress logging
 * @returns Array of embedding vectors
 */
async function batchEmbed(
  openai: OpenAI,
  texts: string[],
  batchSize: number,
  maxRetries: number,
  label: string
): Promise<number[][]> {
  const batches = batchArray(texts, batchSize);
  const allEmbeddings: number[][] = [];
  const totalBatches = batches.length;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;

    process.stdout.write(`    [${batchNum}/${totalBatches}] Embedding ${label} batch (${batch.length} texts)...`);

    try {
      const embeddings = await withRetry(
        async () => {
          const response = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: batch,
            encoding_format: 'float'
          });
          return response.data.map(d => d.embedding);
        },
        maxRetries
      );

      allEmbeddings.push(...embeddings);
      console.log(' ✓');
    } catch (error) {
      console.log(' ✗');
      throw new Error(`Failed to embed ${label} batch ${batchNum}: ${(error as Error).message}`);
    }
  }

  return allEmbeddings;
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
