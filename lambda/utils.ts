/**
 * Utility functions for Lambda document processing
 */

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
 * Extracts tenant ID from S3 bucket name
 * Bucket name format: {tenant-name}.{tenant-id-guid}
 * Example: acme-corp.7be1388f-6430-4ba1-9e26-2fb1aaa42edf
 *
 * @param bucketName - S3 bucket name
 * @returns Tenant ID (GUID)
 * @throws Error if bucket name format is invalid
 */
export function extractTenantId(bucketName: string): string {
  const lastDotIndex = bucketName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    throw new Error(`Invalid bucket name format: ${bucketName}. Expected format: {tenant-name}.{tenant-id-guid}`);
  }

  const tenantId = bucketName.substring(lastDotIndex + 1);

  // Basic UUID validation (8-4-4-4-12 format)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    throw new Error(`Invalid tenant ID format: ${tenantId}. Expected a GUID.`);
  }

  return tenantId;
}

/**
 * Generates a temporary file path in /tmp
 *
 * @param s3Key - S3 object key
 * @returns Path to temporary file
 */
export function getTempFilePath(s3Key: string): string {
  // Extract filename from S3 key
  const fileName = s3Key.split('/').pop() || 'document';
  // Add timestamp to avoid collisions
  const timestamp = Date.now();
  return `/tmp/${timestamp}-${fileName}`;
}

/**
 * Decodes URL-encoded S3 key
 * S3 events URL-encode the object key
 *
 * @param encodedKey - URL-encoded S3 key
 * @returns Decoded S3 key
 */
export function decodeS3Key(encodedKey: string): string {
  return decodeURIComponent(encodedKey.replace(/\+/g, ' '));
}

/**
 * Validates environment variables and returns configuration
 */
export interface LambdaConfig {
  aiGatewayApiKey: string;
  qdrantUrl: string;
  qdrantApiKey?: string;
}

export function getConfig(): LambdaConfig {
  const aiGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  if (!aiGatewayApiKey) {
    throw new Error('AI_GATEWAY_API_KEY environment variable is required');
  }

  const qdrantUrl = process.env.QDRANT_URL;
  if (!qdrantUrl) {
    throw new Error('QDRANT_URL environment variable is required');
  }

  return {
    aiGatewayApiKey,
    qdrantUrl,
    qdrantApiKey: process.env.QDRANT_API_KEY,
  };
}

/**
 * Creates a structured log message
 */
export function logInfo(message: string, context?: Record<string, any>): void {
  console.log(JSON.stringify({
    level: 'INFO',
    message,
    timestamp: new Date().toISOString(),
    ...context,
  }));
}

/**
 * Creates a structured error log message
 */
export function logError(message: string, error: Error, context?: Record<string, any>): void {
  console.error(JSON.stringify({
    level: 'ERROR',
    message,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    timestamp: new Date().toISOString(),
    ...context,
  }));
}
