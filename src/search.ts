#!/usr/bin/env node

/**
 * Interactive Hybrid Search CLI
 *
 * Performs hybrid search combining dense vector similarity with BM25 keyword search
 * using Reciprocal Rank Fusion (RRF) for result combination.
 *
 * USAGE:
 *   npm run search
 *   # or
 *   npx ts-node src/search.ts
 *
 * The script will interactively prompt for:
 *   - Search query
 *   - Number of results to return
 *   - Search mode (vector/text/hybrid)
 */

// Load environment variables
import 'dotenv/config';

import * as readline from 'readline';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { loadConfig } from './config';

/**
 * Search result structure
 */
interface SearchResult {
  id: string;
  score: number;
  payload: {
    chunk_id: string;
    text: string;
    doc_id: string;
    doc_type: string;
    source_path: string;
    title_text: string;
    summary_text: string;
    heading_path: string[];
    section_title: string | null;
    is_table: boolean;
    is_code: boolean;
    page_number?: number;
    slide_number?: number;
    sheet_name?: string;
    [key: string]: unknown;
  };
}

/**
 * Hybrid search result with source tracking
 */
interface HybridResult extends SearchResult {
  vectorRank?: number;
  textRank?: number;
  rrfScore: number;
}

/**
 * Main search function
 */
async function main(): Promise<void> {
  console.log('Hybrid Search CLI');
  console.log('=================\n');

  // Load configuration
  const config = loadConfig();

  // Initialize clients
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const qdrantOptions: { url: string; apiKey?: string } = { url: config.qdrantUrl };
  if (config.qdrantApiKey) {
    qdrantOptions.apiKey = config.qdrantApiKey;
  }
  const qdrant = new QdrantClient(qdrantOptions);

  // Check collection exists
  try {
    const info = await qdrant.getCollection(config.collection);
    console.log(`Connected to collection: ${config.collection}`);
    console.log(`  - Points: ${info.points_count || 0}`);
    console.log('');
  } catch (error) {
    console.error(`Error: Collection '${config.collection}' not found.`);
    console.error('Run "npm run process" first to create and populate the collection.');
    process.exit(1);
  }

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve);
    });
  };

  // Interactive search loop
  console.log('Search modes:');
  console.log('  - vector: Dense vector similarity only');
  console.log('  - text: BM25 keyword search only');
  console.log('  - hybrid: Combined with RRF (default)');
  console.log('\nEnter your search queries (type "exit" to quit)\n');

  while (true) {
    try {
      // Get search query
      const query = await question('Search query: ');
      if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
        break;
      }

      if (!query.trim()) {
        console.log('Please enter a query.\n');
        continue;
      }

      // Get number of results
      const limitStr = await question('Number of results (default: 5): ');
      const limit = parseInt(limitStr) || 5;

      // Get search mode
      const modeInput = await question('Search mode [vector/text/hybrid] (default: hybrid): ');
      const mode = modeInput.toLowerCase() || 'hybrid';

      console.log('\nSearching...\n');

      let results: SearchResult[];

      if (mode === 'vector') {
        // Pure vector search
        const queryVector = await embedQuery(openai, query, config.embeddingModel);
        results = await vectorSearch(qdrant, config.collection, queryVector, limit);
        displayResults(results, query, mode);
      } else if (mode === 'text') {
        // Pure text/BM25 search
        results = await textSearch(qdrant, config.collection, query, limit);
        displayResults(results, query, mode);
      } else {
        // Hybrid search with RRF - show detailed breakdown
        const queryVector = await embedQuery(openai, query, config.embeddingModel);
        await hybridSearchWithDetails(qdrant, config.collection, query, queryVector, limit);
      }

    } catch (error) {
      console.error('Search error:', (error as Error).message);
      console.log('');
    }
  }

  rl.close();
  console.log('\nGoodbye!');
}

/**
 * Generates embedding for a query
 */
async function embedQuery(
  openai: OpenAI,
  query: string,
  model: string
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model,
    input: query,
    encoding_format: 'float'
  });
  return response.data[0].embedding;
}

/**
 * Pure vector similarity search
 */
async function vectorSearch(
  client: QdrantClient,
  collection: string,
  queryVector: number[],
  limit: number
): Promise<SearchResult[]> {
  const response = await client.search(collection, {
    vector: {
      name: 'full_vector',
      vector: queryVector
    },
    limit,
    with_payload: true
  });

  return response.map(point => ({
    id: String(point.id),
    score: point.score,
    payload: point.payload as SearchResult['payload']
  }));
}

/**
 * Pure text/BM25 search using scroll with text match filter
 */
async function textSearch(
  client: QdrantClient,
  collection: string,
  query: string,
  limit: number
): Promise<SearchResult[]> {
  // Use scroll with text match filter for BM25-style search
  const response = await client.scroll(collection, {
    filter: {
      must: [
        {
          key: 'text',
          match: {
            text: query
          }
        }
      ]
    },
    limit,
    with_payload: true,
    with_vector: false
  });

  // Text search doesn't return scores, so we assign based on position
  return (response.points || []).map((point, index) => ({
    id: String(point.id),
    score: 1 / (index + 1), // Simple position-based scoring
    payload: point.payload as SearchResult['payload']
  }));
}

/**
 * Hybrid search with detailed breakdown showing vector, text, and RRF results
 */
async function hybridSearchWithDetails(
  client: QdrantClient,
  collection: string,
  query: string,
  queryVector: number[],
  limit: number
): Promise<void> {
  // Fetch 10x results from each method for better fusion
  const fetchLimit = limit * 10;

  console.log(`Fetching top ${fetchLimit} from each search method...\n`);

  // Run vector and text searches in parallel
  const [vectorResults, textResults] = await Promise.all([
    vectorSearch(client, collection, queryVector, fetchLimit),
    textSearch(client, collection, query, fetchLimit)
  ]);

  // Display vector results
  console.log('═'.repeat(80));
  console.log(`VECTOR SEARCH RESULTS (${vectorResults.length} results)`);
  console.log('═'.repeat(80));

  const topVectorResults = vectorResults.slice(0, Math.min(10, vectorResults.length));
  for (let i = 0; i < topVectorResults.length; i++) {
    const r = topVectorResults[i];
    console.log(`  [${i + 1}] Score: ${r.score.toFixed(4)} | ${getFilename(r.payload.source_path)} | ${truncateText(r.payload.title_text || r.payload.summary_text, 50)}`);
  }
  if (vectorResults.length > 10) {
    console.log(`  ... and ${vectorResults.length - 10} more`);
  }
  console.log('');

  // Display text results
  console.log('═'.repeat(80));
  console.log(`TEXT/BM25 SEARCH RESULTS (${textResults.length} results)`);
  console.log('═'.repeat(80));

  const topTextResults = textResults.slice(0, Math.min(10, textResults.length));
  for (let i = 0; i < topTextResults.length; i++) {
    const r = topTextResults[i];
    console.log(`  [${i + 1}] ${getFilename(r.payload.source_path)} | ${truncateText(r.payload.title_text || r.payload.summary_text, 50)}`);
  }
  if (textResults.length > 10) {
    console.log(`  ... and ${textResults.length - 10} more`);
  }
  if (textResults.length === 0) {
    console.log('  No keyword matches found');
  }
  console.log('');

  // Apply Reciprocal Rank Fusion (RRF)
  // RRF score = sum of 1 / (k + rank) across all result lists
  // where k is a constant (typically 60)
  const k = 60;
  const scores = new Map<string, HybridResult>();

  // Process vector results
  vectorResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScore = 1 / (k + rank);

    if (scores.has(result.id)) {
      const existing = scores.get(result.id)!;
      existing.rrfScore += rrfScore;
      existing.vectorRank = rank;
    } else {
      scores.set(result.id, {
        ...result,
        vectorRank: rank,
        textRank: undefined,
        rrfScore
      });
    }
  });

  // Process text results
  textResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScore = 1 / (k + rank);

    if (scores.has(result.id)) {
      const existing = scores.get(result.id)!;
      existing.rrfScore += rrfScore;
      existing.textRank = rank;
    } else {
      scores.set(result.id, {
        ...result,
        vectorRank: undefined,
        textRank: rank,
        rrfScore
      });
    }
  });

  // Sort by combined RRF score and get top results
  const combinedResults = Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);

  // Display RRF combined results with breakdown
  console.log('═'.repeat(80));
  console.log(`HYBRID RESULTS WITH RRF (top ${limit}, k=${k})`);
  console.log('═'.repeat(80));
  console.log('');

  for (let i = 0; i < combinedResults.length; i++) {
    const result = combinedResults[i];
    const payload = result.payload;

    // Show rank sources
    const vectorInfo = result.vectorRank ? `Vector: #${result.vectorRank}` : 'Vector: -';
    const textInfo = result.textRank ? `Text: #${result.textRank}` : 'Text: -';

    console.log(`[${i + 1}] RRF Score: ${result.rrfScore.toFixed(6)}`);
    console.log(`    Sources: ${vectorInfo} | ${textInfo}`);
    console.log(`    File: ${getFilename(payload.source_path)} (${payload.doc_type.toUpperCase()})`);

    if (payload.title_text) {
      console.log(`    Title: ${payload.title_text}`);
    }

    if (payload.page_number) {
      console.log(`    Page: ${payload.page_number}`);
    } else if (payload.slide_number) {
      console.log(`    Slide: ${payload.slide_number}`);
    } else if (payload.sheet_name) {
      console.log(`    Sheet: ${payload.sheet_name}`);
    }

    // Show preview
    const preview = payload.summary_text || truncateText(payload.text, 150);
    console.log(`    Preview: ${preview}`);
    console.log('─'.repeat(80));
  }

  // Show RRF impact analysis
  console.log('\nRRF IMPACT ANALYSIS:');

  const bothSources = combinedResults.filter(r => r.vectorRank && r.textRank).length;
  const vectorOnly = combinedResults.filter(r => r.vectorRank && !r.textRank).length;
  const textOnly = combinedResults.filter(r => !r.vectorRank && r.textRank).length;

  console.log(`  - Results appearing in BOTH: ${bothSources} (boosted by RRF)`);
  console.log(`  - Results from VECTOR only: ${vectorOnly}`);
  console.log(`  - Results from TEXT only: ${textOnly}`);

  if (bothSources > 0) {
    const boostedResults = combinedResults.filter(r => r.vectorRank && r.textRank);
    console.log('\n  Boosted results (appeared in both):');
    boostedResults.forEach(r => {
      console.log(`    - ${getFilename(r.payload.source_path)}: Vector #${r.vectorRank} + Text #${r.textRank} → RRF ${r.rrfScore.toFixed(6)}`);
    });
  }

  console.log('');
}

/**
 * Displays search results in a formatted way
 */
function displayResults(results: SearchResult[], query: string, mode: string): void {
  if (results.length === 0) {
    console.log('No results found.\n');
    return;
  }

  console.log(`Found ${results.length} results for: "${query}" (mode: ${mode})\n`);
  console.log('─'.repeat(80));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const payload = result.payload;

    console.log(`\n[${i + 1}] Score: ${result.score.toFixed(4)}`);
    console.log(`    Source: ${getFilename(payload.source_path)}`);
    console.log(`    Type: ${payload.doc_type.toUpperCase()}`);

    if (payload.title_text) {
      console.log(`    Title: ${payload.title_text}`);
    }

    if (payload.page_number) {
      console.log(`    Page: ${payload.page_number}`);
    } else if (payload.slide_number) {
      console.log(`    Slide: ${payload.slide_number}`);
    } else if (payload.sheet_name) {
      console.log(`    Sheet: ${payload.sheet_name}`);
    }

    if (payload.is_table) {
      console.log(`    [Contains Table]`);
    }
    if (payload.is_code) {
      console.log(`    [Contains Code]`);
    }

    // Show summary or truncated text
    const preview = payload.summary_text || truncateText(payload.text, 200);
    console.log(`    Preview: ${preview}`);

    console.log('─'.repeat(80));
  }

  console.log('');
}

/**
 * Extracts filename from path
 */
function getFilename(filepath: string): string {
  return filepath.split('/').pop() || filepath;
}

/**
 * Truncates text to a maximum length
 */
function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength - 50) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

// Run the search CLI
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
