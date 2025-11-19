#!/usr/bin/env node

/**
 * Document Chunker CLI
 *
 * A production-ready CLI tool for parsing documents into structured chunks.
 *
 * Usage:
 *   ts-node src/chunker.ts file1.pdf file2.docx --out output.json --pretty
 *
 * Supports: .txt, .md, .html, .pdf, .docx, .xlsx, .ppt, .pptx, .eml, .msg
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { Chunk } from './types';
import { chunkDocument } from './chunkerLogic';

// CLI program setup
const program = new Command();

program
  .name('chunker')
  .description('Parse documents into structured chunks for processing')
  .version('1.0.0')
  .argument('<files...>', 'Input files to process')
  .option('-o, --out <file>', 'Output file path (default: stdout)')
  .option('-p, --pretty', 'Pretty-print JSON output', false)
  .option('-q, --quiet', 'Suppress progress output', false)
  .action(async (files: string[], options) => {
    await processFiles(files, options);
  });

program.parse();

/**
 * Main processing function
 */
async function processFiles(
  files: string[],
  options: { out?: string; pretty?: boolean; quiet?: boolean }
): Promise<void> {
  const allChunks: Chunk[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  let processed = 0;

  const log = options.quiet ? () => {} : console.error.bind(console);

  log(`\nDocument Chunker v1.0.0`);
  log(`Processing ${files.length} file(s)...\n`);

  for (const file of files) {
    const filePath = path.resolve(file);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      errors.push({ file, error: 'File not found' });
      log(`✗ ${file}: File not found`);
      continue;
    }

    // Check if it's a file (not directory)
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      errors.push({ file, error: 'Not a file' });
      log(`✗ ${file}: Not a file`);
      continue;
    }

    try {
      // Show progress
      log(`Processing: ${file}`);

      const startTime = Date.now();
      const chunks = await chunkDocument(filePath);
      const elapsed = Date.now() - startTime;

      allChunks.push(...chunks);
      processed++;

      log(`  ✓ ${chunks.length} chunk(s) in ${elapsed}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ file, error: message });
      log(`  ✗ Error: ${message}`);
    }
  }

  // Output results
  const output = options.pretty
    ? JSON.stringify(allChunks, null, 2)
    : JSON.stringify(allChunks);

  if (options.out) {
    const outPath = path.resolve(options.out);
    fs.writeFileSync(outPath, output, 'utf-8');
    log(`\nOutput written to: ${outPath}`);
  } else {
    console.log(output);
  }

  // Summary
  log('\n--- Summary ---');
  log(`Files processed: ${processed}/${files.length}`);
  log(`Total chunks: ${allChunks.length}`);

  if (errors.length > 0) {
    log(`Errors: ${errors.length}`);
    for (const err of errors) {
      log(`  - ${err.file}: ${err.error}`);
    }
  }

  log('');

  // Exit with error code if any failures
  if (errors.length > 0) {
    process.exit(1);
  }
}
