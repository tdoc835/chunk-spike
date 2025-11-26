/**
 * AWS Lambda Handler for Document Processing
 *
 * Triggered by S3 s3:ObjectCreated:* events (PUT and multipart uploads).
 * Processes one document per invocation, extracting tenant ID from bucket name.
 *
 * Environment Variables:
 * - AI_GATEWAY_API_KEY: Required - Vercel AI Gateway API key
 * - QDRANT_URL: Required - Qdrant server endpoint
 * - QDRANT_API_KEY: Optional - Qdrant authentication key
 */

import type { S3Event, LambdaResponse, ProcessingResult } from './types';
import { createQdrantClient } from './qdrant';
import { processDocument } from './processor';
import {
  extractTenantId,
  decodeS3Key,
  getConfig,
  logInfo,
  logError,
} from './utils';

// Initialize Qdrant client (reused across warm invocations)
let qdrantClient: ReturnType<typeof createQdrantClient> | null = null;

/**
 * Main Lambda handler function
 *
 * @param event - S3 event containing bucket and object information
 * @returns Lambda response with processing results
 */
export async function handler(event: S3Event): Promise<LambdaResponse> {
  const startTime = Date.now();

  logInfo('Lambda invocation started', {
    recordCount: event.Records?.length || 0,
  });

  try {
    // Validate and get configuration
    const config = getConfig();

    // Initialize Qdrant client if not already done (connection pooling)
    if (!qdrantClient) {
      logInfo('Initializing Qdrant client', { url: config.qdrantUrl });
      qdrantClient = createQdrantClient(config.qdrantUrl, config.qdrantApiKey);
    }

    // Process each S3 record (typically just one for S3 triggers)
    const results: ProcessingResult[] = [];

    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = decodeS3Key(record.s3.object.key);
      const eventName = record.eventName;

      logInfo('Processing S3 event', {
        bucket,
        key,
        eventName,
        objectSize: record.s3.object.size,
      });

      // Extract tenant ID from bucket name
      // Format: {tenant-name}.{tenant-id-guid}
      let tenantId: string;
      try {
        tenantId = extractTenantId(bucket);
        logInfo('Extracted tenant ID', { tenantId, bucket });
      } catch (error) {
        const err = error as Error;
        logError('Failed to extract tenant ID', err, { bucket });
        results.push({
          success: false,
          bucket,
          key,
          tenantId: 'unknown',
          chunksCreated: 0,
          pointsUpserted: 0,
          error: err.message,
        });
        continue;
      }

      // Process the document
      // The collection name is the tenant ID
      const result = await processDocument(bucket, key, tenantId, qdrantClient);
      results.push(result);
    }

    // Summarize results
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0);
    const totalPoints = results.reduce((sum, r) => sum + r.pointsUpserted, 0);
    const duration = Date.now() - startTime;

    logInfo('Lambda invocation completed', {
      successCount,
      failureCount,
      totalChunks,
      totalPoints,
      durationMs: duration,
    });

    // Return success even if some documents failed (partial success)
    // The failed documents will be visible in the logs
    if (failureCount > 0 && successCount === 0) {
      // All documents failed
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: 'All documents failed to process',
          results,
          summary: {
            successCount,
            failureCount,
            totalChunks,
            totalPoints,
            durationMs: duration,
          },
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: failureCount > 0 ? 'Partial success' : 'Success',
        results,
        summary: {
          successCount,
          failureCount,
          totalChunks,
          totalPoints,
          durationMs: duration,
        },
      }),
    };

  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;

    logError('Lambda invocation failed', err, { durationMs: duration });

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Lambda execution failed',
        error: err.message,
        durationMs: duration,
      }),
    };
  }
}

/**
 * Export the handler as default for compatibility with different bundlers
 */
export default handler;
