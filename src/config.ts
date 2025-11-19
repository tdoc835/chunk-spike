/**
 * Configuration loading and validation
 * Loads settings from environment variables with defaults
 */

export interface Config {
  // OpenAI
  openaiApiKey: string;

  // Qdrant
  qdrantUrl: string;
  qdrantApiKey: string | undefined;
  collection: string;

  // Processing
  samplesDir: string;
  batchSize: number;
  embeddingBatchSize: number;
  maxRetries: number;

  // Embedding
  embeddingModel: string;
  embeddingDimensions: number;
}

export function loadConfig(): Config {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  return {
    // OpenAI
    openaiApiKey,

    // Qdrant
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY || undefined,
    collection: process.env.QDRANT_COLLECTION || 'dev_docs',

    // Processing
    samplesDir: process.env.SAMPLES_DIR || './samples',
    batchSize: parseInt(process.env.BATCH_SIZE || '50', 10),
    embeddingBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '100', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),

    // Embedding model configuration
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
  };
}

export function printConfig(config: Config): void {
  console.log('Configuration:');
  console.log(`  - Samples directory: ${config.samplesDir}`);
  console.log(`  - Qdrant URL: ${config.qdrantUrl}`);
  console.log(`  - Collection: ${config.collection}`);
  console.log(`  - Batch size: ${config.batchSize}`);
  console.log(`  - Embedding batch size: ${config.embeddingBatchSize}`);
  console.log(`  - Max retries: ${config.maxRetries}`);
  console.log(`  - Embedding model: ${config.embeddingModel}`);
  console.log(`  - Embedding dimensions: ${config.embeddingDimensions}`);
  console.log('');
}
