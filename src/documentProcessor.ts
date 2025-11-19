#!/usr/bin/env node

/**
 * Document Processor CLI
 *
 * Processes documents through the chunker, generates embeddings, and stores in Qdrant.
 * Supports hybrid search with BM25 + dense vector retrieval.
 *
 * INSTALLATION:
 *   npm install
 *
 * LOCAL QDRANT SETUP:
 *   docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
 *
 * ENVIRONMENT SETUP:
 *   cp .env.example .env
 *   # Edit .env with your OPENAI_API_KEY
 *
 * USAGE:
 *   # Basic usage with defaults
 *   npm run process
 *
 *   # With ts-node directly
 *   npx ts-node src/documentProcessor.ts
 *
 *   # With environment overrides
 *   SAMPLES_DIR=./test-docs QDRANT_COLLECTION=prod_docs npm run process
 *
 * EXAMPLE OUTPUT:
 *   Document Processor
 *   ==================
 *
 *   Configuration:
 *     - Samples directory: ./samples
 *     - Qdrant URL: http://localhost:6333
 *     - Collection: dev_docs
 *
 *   Found 250 documents to process
 *
 *   [1/250] Processing: report.pdf
 *     - Generated 45 chunks
 *   ...
 *
 *   ✓ Processing complete!
 *     - Documents processed: 250
 *     - Chunks created: 5,432
 *     - Points upserted: 5,432
 *
 * EMBEDDING COST ESTIMATION:
 *   Model: text-embedding-3-large (~$0.00013 per 1K tokens)
 *   Example: 5,000 chunks × 2 embeddings × ~500 tokens = 5M tokens = ~$0.65
 */

// Load environment variables from .env file FIRST
import 'dotenv/config';

import * as path from 'path';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';

// Import configuration and utilities
import { loadConfig, printConfig } from './config';
import { findAllDocuments, formatNumber, estimateEmbeddingCost } from './utils';

// Import chunker (existing implementation)
import { chunkDocument } from './chunkerLogic';
import type { Chunk } from './types';

// Import embedding and Qdrant modules
import { generateChunkEmbeddings, estimateTotalTokens } from './embeddings';
import { ensureCollection, createPoints, upsertPoints } from './qdrant';

/**
 * Processing results tracking
 */
interface ProcessingResults {
  success: string[];
  failed: Array<{ file: string; error: string }>;
  totalChunks: number;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('Document Processor');
  console.log('==================\n');

  // Load and display configuration
  const config = loadConfig();
  printConfig(config);

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: config.openaiApiKey
  });

  // Initialize Qdrant client
  const qdrantOptions: { url: string; apiKey?: string } = {
    url: config.qdrantUrl
  };
  if (config.qdrantApiKey) {
    qdrantOptions.apiKey = config.qdrantApiKey;
  }
  const qdrant = new QdrantClient(qdrantOptions);

  // Ensure collection exists with correct schema
  await ensureCollection(qdrant, config.collection, config.embeddingDimensions);

  // Find all documents to process
  console.log(`Scanning for documents in: ${config.samplesDir}`);
  const files = await findAllDocuments(config.samplesDir);

  if (files.length === 0) {
    console.log('\n⚠ No documents found to process');
    console.log('  Supported formats: PDF, DOCX, XLSX, PPTX, TXT, MD, HTML, EML, MSG');
    return;
  }

  console.log(`Found ${formatNumber(files.length)} documents to process\n`);

  // Process documents and collect chunks
  const results = await processDocuments(files);

  if (results.totalChunks === 0) {
    console.log('\n⚠ No chunks generated from documents');
    return;
  }

  // Collect all chunks from successful files
  const allChunks: Chunk[] = [];
  for (const file of results.success) {
    try {
      const chunks = await chunkDocument(file);
      allChunks.push(...chunks);
    } catch {
      // Already logged in processDocuments
    }
  }

  console.log(`\nTotal chunks: ${formatNumber(allChunks.length)}`);

  // Estimate and display embedding cost
  const estimatedTokens = estimateTotalTokens(allChunks);
  const estimatedCost = estimateEmbeddingCost(allChunks.length);
  console.log(`Estimated embedding cost: ${estimatedCost} (${formatNumber(estimatedTokens)} tokens)`);

  // Generate embeddings
  const embeddings = await generateChunkEmbeddings(
    allChunks,
    openai,
    config.embeddingBatchSize,
    config.maxRetries
  );

  // Create Qdrant points
  console.log('\nCreating Qdrant points...');
  const points = createPoints(allChunks, embeddings);
  console.log(`  Created ${formatNumber(points.length)} points`);

  // Upsert to Qdrant
  await upsertPoints(qdrant, config.collection, points, config.batchSize);

  // Print summary
  printSummary(results, points.length);
}

/**
 * Processes all documents and collects results
 */
async function processDocuments(files: string[]): Promise<ProcessingResults> {
  const results: ProcessingResults = {
    success: [],
    failed: [],
    totalChunks: 0
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileNum = i + 1;
    const fileName = path.basename(file);

    process.stdout.write(`[${fileNum}/${files.length}] Processing: ${fileName}`);

    try {
      const chunks = await chunkDocument(file);
      results.success.push(file);
      results.totalChunks += chunks.length;
      console.log(` ✓ (${chunks.length} chunks)`);
    } catch (error) {
      const message = (error as Error).message;
      results.failed.push({ file, error: message });
      console.log(` ✗`);
      console.log(`    Error: ${message}`);
    }
  }

  return results;
}

/**
 * Prints the final processing summary
 */
function printSummary(results: ProcessingResults, pointsUpserted: number): void {
  console.log('\n✓ Processing complete!');
  console.log(`  - Documents processed: ${results.success.length}/${results.success.length + results.failed.length}`);
  console.log(`  - Chunks created: ${formatNumber(results.totalChunks)}`);
  console.log(`  - Points upserted: ${formatNumber(pointsUpserted)}`);

  if (results.failed.length > 0) {
    console.log(`\n⚠ Failed files (${results.failed.length}):`);
    for (const { file, error } of results.failed) {
      console.log(`  - ${path.basename(file)}: ${error}`);
    }
  }

  console.log('');
}

// Run the processor
main().catch(error => {
  console.error('\n✗ Fatal error:', error.message);
  process.exit(1);
});
