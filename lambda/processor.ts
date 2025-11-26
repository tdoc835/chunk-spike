/**
 * Single document processing orchestration for Lambda
 *
 * Coordinates the full pipeline:
 * 1. Download file from S3
 * 2. Parse and chunk document
 * 3. Generate embeddings
 * 4. Upsert to Qdrant
 * 5. Cleanup temp files
 */

import * as fs from 'fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProcessingResult } from './types';
import { chunkDocument, isSupportedExtension } from './chunkerLogic';
import { generateChunkEmbeddings, estimateEmbeddingCost } from './embeddings';
import { createPoints, upsertPoints } from './qdrant';
import { getTempFilePath, logInfo, logError } from './utils';

// Create S3 client (reused across invocations)
const s3Client = new S3Client({});

/**
 * Processes a single document from S3
 *
 * @param bucket - S3 bucket name
 * @param key - S3 object key
 * @param tenantId - Tenant ID (also the Qdrant collection name)
 * @param qdrantClient - Qdrant client instance
 * @returns Processing result
 */
export async function processDocument(
  bucket: string,
  key: string,
  tenantId: string,
  qdrantClient: QdrantClient
): Promise<ProcessingResult> {
  const startTime = Date.now();
  let localFilePath: string | null = null;

  logInfo('Starting document processing', { bucket, key, tenantId });

  try {
    // Validate file extension
    if (!isSupportedExtension(key)) {
      const ext = key.split('.').pop() || 'unknown';
      return {
        success: false,
        bucket,
        key,
        tenantId,
        chunksCreated: 0,
        pointsUpserted: 0,
        error: `Unsupported file type: .${ext}`,
      };
    }

    // Step 1: Download file from S3 to /tmp
    logInfo('Downloading file from S3', { bucket, key });
    localFilePath = getTempFilePath(key);
    await downloadFromS3(bucket, key, localFilePath);
    logInfo('File downloaded successfully', { localFilePath, size: fs.statSync(localFilePath).size });

    // Step 2: Parse and chunk document
    logInfo('Parsing and chunking document', { key });
    const chunks = await chunkDocument(localFilePath, key, bucket);
    logInfo('Document chunked successfully', { chunkCount: chunks.length });

    if (chunks.length === 0) {
      return {
        success: true,
        bucket,
        key,
        tenantId,
        chunksCreated: 0,
        pointsUpserted: 0,
        error: 'Document produced no chunks (possibly empty)',
      };
    }

    // Log estimated cost
    const estimatedCost = estimateEmbeddingCost(chunks);
    logInfo('Estimated embedding cost', { cost: estimatedCost, chunks: chunks.length });

    // Step 3: Generate embeddings
    logInfo('Generating embeddings', { chunkCount: chunks.length });
    const embeddings = await generateChunkEmbeddings(chunks);
    logInfo('Embeddings generated successfully', { embeddingCount: embeddings.length });

    // Step 4: Create Qdrant points
    logInfo('Creating Qdrant points', { chunkCount: chunks.length });
    const points = createPoints(chunks, embeddings);
    logInfo('Points created successfully', { pointCount: points.length });

    // Step 5: Upsert to Qdrant (collection = tenant ID)
    logInfo('Upserting to Qdrant', { collection: tenantId, pointCount: points.length });
    await upsertPoints(qdrantClient, tenantId, points);
    logInfo('Upsert completed successfully', { collection: tenantId });

    const duration = Date.now() - startTime;
    logInfo('Document processing completed', {
      bucket,
      key,
      tenantId,
      chunksCreated: chunks.length,
      pointsUpserted: points.length,
      durationMs: duration,
    });

    return {
      success: true,
      bucket,
      key,
      tenantId,
      chunksCreated: chunks.length,
      pointsUpserted: points.length,
    };

  } catch (error) {
    const err = error as Error;
    logError('Document processing failed', err, { bucket, key, tenantId });

    return {
      success: false,
      bucket,
      key,
      tenantId,
      chunksCreated: 0,
      pointsUpserted: 0,
      error: err.message,
    };

  } finally {
    // Step 6: Cleanup temp file
    if (localFilePath && fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
        logInfo('Temp file cleaned up', { localFilePath });
      } catch (cleanupError) {
        logError('Failed to cleanup temp file', cleanupError as Error, { localFilePath });
      }
    }
  }
}

/**
 * Downloads a file from S3 to local filesystem
 *
 * @param bucket - S3 bucket name
 * @param key - S3 object key
 * @param localPath - Local file path to save to
 */
async function downloadFromS3(bucket: string, key: string, localPath: string): Promise<void> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`Empty response body from S3 for ${bucket}/${key}`);
  }

  // Stream the response body to a file
  const body = response.Body as Readable;
  const writeStream = fs.createWriteStream(localPath);

  return new Promise((resolve, reject) => {
    body.pipe(writeStream);
    body.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });
}

/**
 * Validates that the S3 object exists and is accessible
 *
 * @param bucket - S3 bucket name
 * @param key - S3 object key
 * @returns Object metadata if valid
 */
export async function validateS3Object(bucket: string, key: string): Promise<{
  contentLength: number;
  contentType?: string;
}> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3Client.send(command);

  return {
    contentLength: response.ContentLength || 0,
    contentType: response.ContentType,
  };
}
