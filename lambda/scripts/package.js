#!/usr/bin/env node

/**
 * Packaging script for Lambda deployment
 *
 * Creates a deployment-ready zip file containing:
 * - Bundled handler.js from esbuild
 * - Any native dependencies that couldn't be bundled
 *
 * The resulting zip can be uploaded directly to AWS Lambda.
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const ZIP_FILE = path.join(ROOT_DIR, 'lambda-deployment.zip');

// Files to include from dist/
const DIST_FILES = [
  'handler.js',
];

// Files/patterns to exclude
const EXCLUDE_PATTERNS = [
  /\.map$/,           // Source maps
  /\.d\.ts$/,         // Type definitions
  /metafile\.json$/,  // Build metadata
  /\.ts$/,            // TypeScript source
  /\.md$/,            // Markdown files
  /test/i,            // Test files
  /spec/i,            // Spec files
];

async function createZip() {
  console.log('📦 Creating Lambda deployment package...\n');

  const startTime = Date.now();

  // Verify dist exists
  if (!fs.existsSync(DIST_DIR)) {
    console.error('❌ Error: dist/ directory not found. Run "npm run build" first.');
    process.exit(1);
  }

  // Verify handler.js exists
  const handlerPath = path.join(DIST_DIR, 'handler.js');
  if (!fs.existsSync(handlerPath)) {
    console.error('❌ Error: dist/handler.js not found. Run "npm run build" first.');
    process.exit(1);
  }

  // Remove existing zip if present
  if (fs.existsSync(ZIP_FILE)) {
    fs.unlinkSync(ZIP_FILE);
  }

  // Create zip archive
  const output = fs.createWriteStream(ZIP_FILE);
  const archive = archiver('zip', {
    zlib: { level: 9 }, // Maximum compression
  });

  // Track progress
  let fileCount = 0;

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const duration = Date.now() - startTime;
      const sizeBytes = archive.pointer();
      const sizeKB = (sizeBytes / 1024).toFixed(2);
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);

      console.log('\n✅ Package created successfully!\n');
      console.log('📦 Output:');
      console.log(`   File: lambda-deployment.zip`);
      console.log(`   Size: ${sizeKB} KB (${sizeMB} MB)`);
      console.log(`   Files: ${fileCount}`);
      console.log(`   Time: ${duration}ms`);

      // Lambda size limits
      const MB_50 = 50 * 1024 * 1024;
      const MB_250 = 250 * 1024 * 1024;

      if (sizeBytes > MB_250) {
        console.log('\n⚠️  WARNING: Package exceeds 250MB Lambda limit (unzipped)!');
      } else if (sizeBytes > MB_50) {
        console.log('\n⚠️  WARNING: Package exceeds 50MB (direct upload limit).');
        console.log('   Use S3 to deploy: aws lambda update-function-code --s3-bucket <bucket> --s3-key <key>');
      } else {
        console.log('\n✅ Package is within Lambda direct upload limit (50MB)');
      }

      resolve();
    });

    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('Warning:', err.message);
      } else {
        reject(err);
      }
    });

    archive.pipe(output);

    // Add handler.js from dist/
    console.log('Adding files to archive:');
    for (const file of DIST_FILES) {
      const filePath = path.join(DIST_DIR, file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`   + ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
        archive.file(filePath, { name: file });
        fileCount++;
      } else {
        console.warn(`   ! ${file} not found, skipping`);
      }
    }

    // Finalize the archive
    archive.finalize();
  });
}

// Verify archiver is installed
try {
  require.resolve('archiver');
} catch (e) {
  console.error('❌ Error: archiver package not found.');
  console.error('   Run: npm install archiver --save-dev');
  process.exit(1);
}

// Run packaging
createZip()
  .then(() => {
    console.log('\n🚀 Ready to deploy!');
    console.log('   Run: npm run deploy');
    console.log('   Or manually: aws lambda update-function-code --function-name <name> --zip-file fileb://lambda-deployment.zip\n');
  })
  .catch((error) => {
    console.error('\n❌ Packaging failed:', error.message);
    process.exit(1);
  });
