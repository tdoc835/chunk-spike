/**
 * Simplified Qdrant client wrapper for Lambda
 *
 * Handles batch upserting only - no collection management.
 * Assumes collection already exists with proper schema.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import * as crypto from 'crypto';
import type { Chunk, ChunkEmbeddings, QdrantPayload, QdrantPoint } from './types';
import { chunk as batchArray } from './utils';

/**
 * Creates a Qdrant client instance
 *
 * @param url - Qdrant server URL
 * @param apiKey - Optional API key for authentication
 * @returns QdrantClient instance
 */
export function createQdrantClient(url: string, apiKey?: string): QdrantClient {
  return new QdrantClient({
    url,
    apiKey,
  });
}

/**
 * Generates a valid UUID from a chunk ID string
 * Uses SHA-256 hash and formats as UUID v4 format
 *
 * @param chunkId - The original chunk ID (e.g., "a1b2c3d4::0")
 * @returns A valid UUID string
 */
function chunkIdToUuid(chunkId: string): string {
  const hash = crypto.createHash('sha256').update(chunkId).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Converts chunks and embeddings to Qdrant points
 * Includes S3 bucket and key in the payload
 *
 * @param chunks - Array of document chunks
 * @param embeddings - Array of chunk embeddings
 * @returns Array of Qdrant points ready for upserting
 */
export function createPoints(
  chunks: Chunk[],
  embeddings: ChunkEmbeddings[]
): QdrantPoint[] {
  const now = new Date().toISOString();

  // Create a map for quick embedding lookup
  const embeddingMap = new Map<string, ChunkEmbeddings>();
  for (const emb of embeddings) {
    embeddingMap.set(emb.chunkId, emb);
  }

  return chunks.map(chunk => {
    const embedding = embeddingMap.get(chunk.id);
    if (!embedding) {
      throw new Error(`Missing embedding for chunk: ${chunk.id}`);
    }

    // Generate a valid UUID from the chunk ID
    const pointId = chunkIdToUuid(chunk.id);

    return {
      id: pointId,
      vector: {
        full_vector: embedding.fullVector,
        summary_vector: embedding.summaryVector,
      },
      payload: {
        // BM25 field - uses fullText for keyword search
        text: chunk.fullText,

        // Original chunk ID for reference
        chunk_id: chunk.id,

        // Document metadata
        doc_id: chunk.docId,
        chunk_index: chunk.chunkIndex,
        doc_type: chunk.docType,
        source_path: chunk.sourcePath,

        // S3 location - CRITICAL for traceability
        s3_key: chunk.s3Key,
        s3_bucket: chunk.s3Bucket,

        // Content structure
        heading_path: chunk.headingPath,
        section_title: chunk.sectionTitle,
        title_text: chunk.titleText,
        summary_text: chunk.summaryText,

        // Content flags
        is_table: chunk.isTable,
        is_code: chunk.isCode,

        // Location references
        page_number: chunk.pageNumber,
        slide_number: chunk.slideNumber,
        sheet_name: chunk.sheetName,

        // Timestamps
        created_at: now,
        updated_at: now,

        // Additional metadata (from chunk.metadata)
        metadata: chunk.metadata || {},
      },
    };
  });
}

/**
 * Upserts points to Qdrant in batches
 * No collection creation - assumes collection exists
 *
 * @param client - Qdrant client instance
 * @param collectionName - Target collection name (tenant ID)
 * @param points - Array of points to upsert
 * @param batchSize - Points per upsert operation (default: 50)
 */
export async function upsertPoints(
  client: QdrantClient,
  collectionName: string,
  points: QdrantPoint[],
  batchSize: number = 50
): Promise<void> {
  if (points.length === 0) {
    console.log('No points to upsert');
    return;
  }

  const batches = batchArray(points, batchSize);
  const totalBatches = batches.length;

  console.log(`\nUpserting ${points.length} points to Qdrant collection: ${collectionName}`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;

    console.log(`  [${batchNum}/${totalBatches}] Upserting batch (${batch.length} points)...`);

    try {
      await client.upsert(collectionName, {
        wait: true,
        points: batch.map(p => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      });
      console.log(`  [${batchNum}/${totalBatches}] Success!`);
    } catch (error) {
      console.error(`  [${batchNum}/${totalBatches}] Failed!`);
      throw new Error(`Failed to upsert batch ${batchNum}: ${(error as Error).message}`);
    }
  }

  console.log(`Successfully upserted ${points.length} points to collection: ${collectionName}`);
}

/**
 * Gets the current point count in a collection
 */
export async function getPointCount(
  client: QdrantClient,
  collectionName: string
): Promise<number> {
  try {
    const info = await client.getCollection(collectionName);
    return info.points_count || 0;
  } catch {
    return 0;
  }
}
