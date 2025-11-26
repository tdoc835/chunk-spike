# Document Processing Pipeline Lambda

AWS Lambda function that processes documents uploaded to S3, chunks them, generates embeddings using Vercel AI SDK v5, and stores them in Qdrant for vector search.

## Features

- **Multi-format support**: PDF, DOCX, XLSX, PPTX, TXT, MD, HTML, EML, MSG
- **S3 trigger**: Automatically processes documents on upload (s3:ObjectCreated:*)
- **Multi-tenant**: Extracts tenant ID from bucket name for collection routing
- **Dual embeddings**: Generates both full-text and summary embeddings
- **Hybrid search ready**: Stores text for BM25 keyword search alongside vectors

## Architecture

```
S3 Upload → Lambda → Parse → Chunk → Embed → Qdrant
                                        ↓
                              Vercel AI SDK v5
                              (AI Gateway routing)
```

## Quick Start

```bash
# Install dependencies
npm install

# Build and package for deployment
npm run package

# Deploy to AWS Lambda
npm run deploy
```

## Build & Packaging

The project uses **esbuild** for fast, optimized builds that produce small deployment packages.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Bundle TypeScript to single JS file using esbuild |
| `npm run build:dev` | Compile TypeScript with tsc (for debugging) |
| `npm run package` | Clean, build, and create deployment zip |
| `npm run package:quick` | Build and package without cleaning |
| `npm run deploy` | Package and deploy to AWS Lambda |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run verify-zip` | List contents of deployment zip |
| `npm run clean` | Remove build artifacts |

### Build Process

```bash
npm run package
```

This command:
1. **Cleans** previous build artifacts (`dist/`, `staging/`, `lambda-deployment.zip`)
2. **Bundles** TypeScript using esbuild with:
   - Tree-shaking to remove unused code
   - Minification for smaller size
   - Node.js 20 target
   - AWS SDK externalized (provided by Lambda runtime)
3. **Creates** `lambda-deployment.zip` containing the bundled `handler.js`

### Build Output

```
📦 Output:
   File: lambda-deployment.zip
   Size: ~2-5 MB (varies by dependencies)
   Files: 1 (handler.js)

✅ Package is within Lambda direct upload limit (50MB)
```

### Why esbuild?

| Feature | Benefit |
|---------|---------|
| **Single file bundle** | No node_modules in deployment |
| **Tree-shaking** | Only includes used code |
| **Minification** | Smaller file size |
| **Fast builds** | Sub-second build times |
| **Faster cold starts** | Less code to load at startup |

## Tenant ID Extraction

The tenant ID (Qdrant collection name) is extracted from the S3 bucket name:

```
Bucket format: {tenant-name}.{tenant-id-guid}
Example: acme-corp.7be1388f-6430-4ba1-9e26-2fb1aaa42edf
         └─────────┘ └──────────────────────────────────┘
          Tenant     Tenant ID (UUID) = Collection Name
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | Vercel AI Gateway API key |
| `QDRANT_URL` | Yes | Qdrant server endpoint |
| `QDRANT_API_KEY` | No | Qdrant authentication key |

## Payload Structure

Each chunk is stored in Qdrant with the following payload:

```typescript
{
  text: string;           // Full text for BM25 search
  chunk_id: string;       // Stable chunk identifier
  doc_id: string;         // Document identifier (hash of S3 key)
  chunk_index: number;    // Position in document
  doc_type: string;       // File type (pdf, docx, etc.)
  source_path: string;    // Original S3 key
  s3_key: string;         // Full S3 object key
  s3_bucket: string;      // S3 bucket name
  heading_path: string[]; // Section hierarchy
  section_title: string;  // Current section
  title_text: string;     // Heading path joined
  summary_text: string;   // First sentence/200 chars
  is_table: boolean;      // Table content flag
  is_code: boolean;       // Code content flag
  page_number?: number;   // PDF/DOCX page
  slide_number?: number;  // PPT slide
  sheet_name?: string;    // Excel sheet
  created_at: string;     // ISO timestamp
  updated_at: string;     // ISO timestamp
  metadata: object;       // Additional metadata
}
```

## Deployment

### Direct Upload (Recommended for <50MB)

```bash
# Build and package
npm run package

# Deploy
aws lambda update-function-code \
  --function-name document-pipeline \
  --zip-file fileb://lambda-deployment.zip
```

### Using npm deploy script

```bash
# One command to package and deploy
npm run deploy
```

### Using SAM

```bash
# Build
npm install
npm run build

# Deploy with SAM
sam build
sam deploy --guided \
  --parameter-overrides \
    AiGatewayApiKey=your-api-key \
    QdrantUrl=https://your-qdrant.cloud \
    QdrantApiKey=your-qdrant-key
```

### Using Serverless Framework

```bash
# Install dependencies
npm install

# Deploy
serverless deploy --stage prod
```

### S3 Upload (for packages >50MB)

```bash
# Upload to S3
aws s3 cp lambda-deployment.zip s3://my-deployment-bucket/lambda-deployment.zip

# Deploy from S3
aws lambda update-function-code \
  --function-name document-pipeline \
  --s3-bucket my-deployment-bucket \
  --s3-key lambda-deployment.zip
```

## Lambda Configuration

| Setting | Recommended | Description |
|---------|-------------|-------------|
| Memory | 1024 MB | Minimum for PDF processing |
| Timeout | 900s (15 min) | Large documents may take time |
| Ephemeral Storage | 1024 MB | For temp file storage |
| Handler | handler.handler | Entry point |
| Runtime | Node.js 20.x | Target runtime |

## Adding S3 Triggers

For each tenant bucket, add an S3 trigger:

```bash
aws lambda add-permission \
  --function-name document-pipeline \
  --statement-id s3-trigger-tenant1 \
  --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::tenant-name.tenant-guid \
  --source-account YOUR_ACCOUNT_ID

aws s3api put-bucket-notification-configuration \
  --bucket tenant-name.tenant-guid \
  --notification-configuration '{
    "LambdaFunctionConfigurations": [{
      "LambdaFunctionArn": "arn:aws:lambda:REGION:ACCOUNT:function:document-pipeline",
      "Events": ["s3:ObjectCreated:*"]
    }]
  }'
```

## Local Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build (development mode with tsc)
npm run build:dev

# Build (production mode with esbuild)
npm run build

# Test locally (requires SAM CLI)
sam local invoke DocumentPipelineFunction \
  -e events/s3-event.json \
  --env-vars env.json
```

## Error Handling

- **Unsupported file types**: Returns success with error message in result
- **Rate limits**: Automatic retry with exponential backoff
- **Failed processing**: Sends to Dead Letter Queue for manual review
- **Partial success**: Returns 200 with details of failed documents

## Logs

Structured JSON logs are written to CloudWatch:

```json
{
  "level": "INFO",
  "message": "Document processing completed",
  "bucket": "tenant.guid",
  "key": "documents/report.pdf",
  "tenantId": "guid",
  "chunksCreated": 15,
  "pointsUpserted": 15,
  "durationMs": 5234,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Prerequisites

- Qdrant collection must exist with proper schema (named vectors: full_vector, summary_vector; sparse vectors for BM25)
- AI Gateway must be configured with OpenAI provider
- Lambda must have network access to Qdrant (VPC configuration if in private subnet)

## File Structure

```
lambda/
├── handler.ts              # Main Lambda handler
├── processor.ts            # Document processing orchestration
├── chunkerLogic.ts         # Document parsing and chunking
├── embeddings.ts           # Vercel AI SDK v5 embeddings
├── qdrant.ts               # Qdrant client (upsert only)
├── types.ts                # TypeScript interfaces
├── utils.ts                # Utility functions
├── parsers/                # Format-specific parsers
│   ├── index.ts
│   ├── txtParser.ts
│   ├── mdParser.ts
│   ├── htmlParser.ts
│   ├── pdfParser.ts
│   ├── docxParser.ts
│   ├── xlsxParser.ts
│   ├── pptParser.ts
│   └── emlParser.ts
├── utils/
│   ├── idGenerator.ts
│   └── textUtils.ts
├── scripts/
│   ├── build.js            # esbuild bundling script
│   └── package.js          # Zip packaging script
├── package.json
├── tsconfig.json
├── template.yaml           # SAM template
└── serverless.yml          # Serverless Framework config
```

## Troubleshooting

### Build Fails

```bash
# Clear node_modules and reinstall
rm -rf node_modules
npm install

# Clear build artifacts
npm run clean
```

### Package Too Large

The esbuild bundler creates optimized packages. If still too large:
1. Check `dist/metafile.json` to see what's included
2. Add large, unused dependencies to externals in `scripts/build.js`
3. Use Lambda Layers for large native dependencies

### Cold Start Issues

- Increase Lambda memory (also increases CPU)
- Use Provisioned Concurrency for latency-sensitive workloads
- The esbuild bundle already optimizes for fast startup
