/**
 * Qdrant client wrapper and utilities
 *
 * Handles collection creation, BM25 configuration, and batch upserting.
 * Configures the collection for hybrid search (dense vectors + BM25).
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import * as crypto from 'crypto';
import type { Chunk } from './types';
import type { ChunkEmbeddings } from './embeddings';
import { chunk as batchArray } from './utils';

/**
 * Payload structure for Qdrant points
 * Maps chunk data to Qdrant's expected format
 */
export interface QdrantPayload {
  // BM25 field - CRITICAL for keyword search
  text: string;

  // Original chunk ID for reference
  chunk_id: string;

  // Document metadata
  doc_id: string;
  chunk_index: number;
  doc_type: string;
  source_path: string;

  // Content structure
  heading_path: string[];
  section_title: string | null;
  title_text: string;
  summary_text: string;

  // Content flags
  is_table: boolean;
  is_code: boolean;

  // Location references
  page_number?: number;
  slide_number?: number;
  sheet_name?: string;

  // Timestamps
  created_at: string;
  updated_at: string;

  // Additional metadata
  metadata: Record<string, unknown>;

  // Index signature for Qdrant compatibility
  [key: string]: unknown;
}

/**
 * Qdrant point structure with named vectors
 */
export interface QdrantPoint {
  id: string;
  vector: {
    full_vector: number[];
    summary_vector: number[];
  };
  payload: QdrantPayload;
}

/**
 * Ensures the collection exists with the correct schema
 * Creates it if it doesn't exist, configures vectors and BM25
 *
 * @param client - Qdrant client instance
 * @param collectionName - Name of the collection
 * @param vectorSize - Dimension of the embedding vectors (default: 3072)
 */
export async function ensureCollection(
  client: QdrantClient,
  collectionName: string,
  vectorSize: number = 3072
): Promise<void> {
  // Check if collection exists
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === collectionName);

  if (!exists) {
    console.log(`Creating collection: ${collectionName}`);

    // Create collection with named vectors for multi-vector support
    await client.createCollection(collectionName, {
      vectors: {
        full_vector: {
          size: vectorSize,
          distance: 'Cosine'
        },
        summary_vector: {
          size: vectorSize,
          distance: 'Cosine'
        }
      },
      // Enable on-disk payload for better memory efficiency
      on_disk_payload: true
    });

    // Create text index for BM25/full-text search on the 'text' field
    // This enables hybrid search combining dense vectors with keyword search
    console.log(`  Configuring BM25 text index on 'text' field...`);

    await client.createPayloadIndex(collectionName, {
      field_name: 'text',
      field_schema: 'text',  // Full-text index type
      wait: true
    });

    // Create additional indexes for common filter fields
    console.log(`  Creating payload indexes for filtering...`);

    await client.createPayloadIndex(collectionName, {
      field_name: 'doc_id',
      field_schema: 'keyword',
      wait: true
    });

    await client.createPayloadIndex(collectionName, {
      field_name: 'doc_type',
      field_schema: 'keyword',
      wait: true
    });

    await client.createPayloadIndex(collectionName, {
      field_name: 'is_table',
      field_schema: 'bool',
      wait: true
    });

    await client.createPayloadIndex(collectionName, {
      field_name: 'is_code',
      field_schema: 'bool',
      wait: true
    });

    console.log(`  ✓ Collection created with BM25 and filter indexes\n`);
  } else {
    console.log(`Collection exists: ${collectionName}`);

    // Get collection info
    const info = await client.getCollection(collectionName);
    console.log(`  - Points count: ${info.points_count || 0}`);
    console.log('');
  }
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
        summary_vector: embedding.summaryVector
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
        metadata: chunk.metadata || {}
      }
    };
  });
}

/**
 * Upserts points to Qdrant in batches
 *
 * @param client - Qdrant client instance
 * @param collectionName - Target collection name
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

  console.log(`\nUpserting ${points.length} points to Qdrant...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;

    process.stdout.write(`  [${batchNum}/${totalBatches}] Upserting batch (${batch.length} points)...`);

    try {
      await client.upsert(collectionName, {
        wait: true,
        points: batch.map(p => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload
        }))
      });
      console.log(' ✓');
    } catch (error) {
      console.log(' ✗');
      throw new Error(`Failed to upsert batch ${batchNum}: ${(error as Error).message}`);
    }
  }
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
