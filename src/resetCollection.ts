#!/usr/bin/env node

/**
 * Collection Reset Utility
 *
 * This script recreates the Qdrant collection with the correct sparse vector
 * configuration for BM25 support. Use this when you need to fix the collection
 * schema without losing the ability to re-ingest documents.
 *
 * Usage:
 *   npx ts-node src/resetCollection.ts
 *
 * Or via npm script:
 *   npm run reset-collection
 *
 * IMPORTANT: This will DELETE all existing points in the collection.
 * You will need to re-run the document processor to re-ingest documents.
 */

// Load environment variables
import 'dotenv/config';

import { QdrantClient } from '@qdrant/js-client-rest';
import * as readline from 'readline';
import { loadConfig } from './config';

async function resetCollection(): Promise<void> {
  const config = loadConfig();

  const qdrantOptions: { url: string; apiKey?: string } = { url: config.qdrantUrl };
  if (config.qdrantApiKey) {
    qdrantOptions.apiKey = config.qdrantApiKey;
  }
  const client = new QdrantClient(qdrantOptions);

  console.log('Collection Reset Utility');
  console.log('========================\n');
  console.log(`Target: ${config.collection}`);
  console.log(`Qdrant: ${config.qdrantUrl}\n`);

  // Check if collection exists
  let exists = false;
  let pointCount = 0;

  try {
    const info = await client.getCollection(config.collection);
    exists = true;
    pointCount = info.points_count || 0;

    // Check if sparse vectors are already configured
    const collectionConfig = info.config as { params?: { sparse_vectors?: { text?: unknown } } } | undefined;
    const hasSparseVectors = collectionConfig?.params?.sparse_vectors?.text;

    console.log(`Collection exists with ${pointCount} points`);
    if (hasSparseVectors) {
      console.log('  - BM25 sparse vectors: configured');
    } else {
      console.log('  - BM25 sparse vectors: NOT configured (this is the problem!)');
    }
  } catch {
    console.log('Collection does not exist yet');
  }

  // Confirm deletion if collection exists
  if (exists && pointCount > 0) {
    console.log('\n⚠️  WARNING: This will DELETE all existing points!');
    console.log(`⚠️  You will need to re-run the document processor to re-ingest ${pointCount} points.\n`);

    const answer = await prompt('Are you sure you want to continue? (yes/no): ');

    if (answer.toLowerCase() !== 'yes') {
      console.log('\nAborted. No changes made.');
      process.exit(0);
    }
  }

  // Delete existing collection if it exists
  if (exists) {
    console.log('\nDeleting existing collection...');
    await client.deleteCollection(config.collection);
    console.log('✓ Collection deleted');
  }

  // Create collection with correct configuration
  console.log('\nCreating collection with sparse vector support...');
  await client.createCollection(config.collection, {
    vectors: {
      full_vector: {
        size: config.embeddingDimensions,
        distance: 'Cosine'
      },
      summary_vector: {
        size: config.embeddingDimensions,
        distance: 'Cosine'
      }
    },
    sparse_vectors: {
      text: {
        index: {}
      }
    },
    on_disk_payload: true
  });

  console.log('✓ Collection created with BM25 support\n');

  // Create payload indexes
  console.log('Creating payload indexes...');

  await client.createPayloadIndex(config.collection, {
    field_name: 'text',
    field_schema: 'text',
    wait: true
  });

  await client.createPayloadIndex(config.collection, {
    field_name: 'doc_id',
    field_schema: 'keyword',
    wait: true
  });

  await client.createPayloadIndex(config.collection, {
    field_name: 'doc_type',
    field_schema: 'keyword',
    wait: true
  });

  await client.createPayloadIndex(config.collection, {
    field_name: 'is_table',
    field_schema: 'bool',
    wait: true
  });

  await client.createPayloadIndex(config.collection, {
    field_name: 'is_code',
    field_schema: 'bool',
    wait: true
  });

  console.log('✓ Payload indexes created\n');

  // Verify configuration
  console.log('Verifying configuration...');
  const info = await client.getCollection(config.collection);

  const verifyConfig = info.config as { params?: { sparse_vectors?: { text?: unknown } } } | undefined;
  if (verifyConfig?.params?.sparse_vectors?.text) {
    console.log('✓ Sparse vectors configured correctly');
    console.log('✓ BM25 keyword search will now work\n');
  } else {
    console.log('✗ WARNING: Sparse vectors not detected in config');
    console.log('  Please check Qdrant version compatibility\n');
  }

  console.log('Next steps:');
  console.log('1. Run the document processor to re-ingest documents:');
  console.log('   npm run process');
  console.log('2. Test hybrid search:');
  console.log('   npm run search');
  console.log('3. Verify BM25 results appear in hybrid mode\n');
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

// Run the reset utility
resetCollection().catch(error => {
  console.error('\n✗ Error:', error.message);
  process.exit(1);
});
