#!/usr/bin/env node

/**
 * Build script for Lambda deployment using esbuild
 *
 * Uses esbuild to bundle TypeScript directly into a single JavaScript file.
 * This results in:
 * - Smaller deployment packages
 * - Faster Lambda cold starts
 * - Tree-shaking of unused code
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Packages that should NOT be bundled (externals)
// @aws-sdk/* is provided by Lambda runtime
const EXTERNAL_PACKAGES = [
  '@aws-sdk/*',
];

// Some packages have native bindings or need special handling
// These will be included in node_modules in the final zip
const NATIVE_PACKAGES = [
  // pdf-parse uses test files that cause issues with bundling
  // but the core functionality bundles fine
];

async function build() {
  console.log('🔨 Building Lambda function with esbuild...\n');

  const startTime = Date.now();

  // Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  try {
    const result = await esbuild.build({
      entryPoints: [path.join(ROOT_DIR, 'handler.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: path.join(DIST_DIR, 'handler.js'),
      external: EXTERNAL_PACKAGES,
      sourcemap: false, // Disable for smaller size in production
      minify: true,     // Minify for smaller size
      treeShaking: true,
      metafile: true,   // Generate metadata for analysis

      // Handle Node.js built-in modules
      define: {
        'process.env.NODE_ENV': '"production"',
      },

      // Log level
      logLevel: 'info',

      // Banner to identify the build
      banner: {
        js: '// Document Pipeline Lambda - Built with esbuild',
      },
    });

    const duration = Date.now() - startTime;

    // Analyze the build
    const outputs = result.metafile.outputs;
    const outputFile = path.join(DIST_DIR, 'handler.js');
    const stats = fs.statSync(outputFile);
    const sizeKB = (stats.size / 1024).toFixed(2);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log('\n✅ Build completed successfully!\n');
    console.log('📦 Output:');
    console.log(`   File: dist/handler.js`);
    console.log(`   Size: ${sizeKB} KB (${sizeMB} MB)`);
    console.log(`   Time: ${duration}ms`);

    // Write metafile for debugging if needed
    fs.writeFileSync(
      path.join(DIST_DIR, 'metafile.json'),
      JSON.stringify(result.metafile, null, 2)
    );
    console.log(`   Metafile: dist/metafile.json`);

    // Count bundled modules
    const inputs = Object.keys(result.metafile.inputs);
    const nodeModules = inputs.filter(i => i.includes('node_modules')).length;
    const sourceFiles = inputs.filter(i => !i.includes('node_modules')).length;

    console.log('\n📊 Bundle analysis:');
    console.log(`   Source files: ${sourceFiles}`);
    console.log(`   Dependencies: ${nodeModules}`);
    console.log(`   Externals: ${EXTERNAL_PACKAGES.join(', ')}`);

    return true;
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Run build
build().then(() => {
  console.log('\n🎉 Build complete! Run "npm run package" to create deployment zip.\n');
});
