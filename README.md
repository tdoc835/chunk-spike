# Document Chunker

A production-ready TypeScript CLI tool for parsing documents into structured chunks with headings, context, and metadata. Designed for use in document processing pipelines, RAG systems, and content analysis.

## Features

- **Multi-format support**: TXT, MD, HTML, PDF, DOCX, XLSX, PPT/PPTX, EML/MSG
- **Structure-aware chunking**: Chunks based on logical units (sections, paragraphs, tables), not fixed character length
- **Heading hierarchy preservation**: Maintains document structure in each chunk
- **Table and code detection**: Identifies and marks special content types
- **Stable IDs**: Deterministic chunk IDs for reproducible processing
- **Rich metadata**: File info, page numbers, sheet names, email headers

## Installation

```bash
# Install dependencies
npm install

# Run directly with ts-node
npx ts-node src/chunker.ts <files...>

# Or build and run
npm run build
node dist/chunker.js <files...>
```

## Usage

### Basic Usage

```bash
# Process a single file
ts-node src/chunker.ts document.pdf

# Process multiple files
ts-node src/chunker.ts report.pdf data.xlsx email.eml

# Pretty-print output
ts-node src/chunker.ts document.pdf --pretty

# Save to file
ts-node src/chunker.ts document.pdf --out chunks.json --pretty

# Quiet mode (only JSON output)
ts-node src/chunker.ts document.pdf --quiet
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-o, --out <file>` | Write output to file instead of stdout |
| `-p, --pretty` | Pretty-print JSON output |
| `-q, --quiet` | Suppress progress messages |
| `-h, --help` | Display help |
| `-V, --version` | Display version |

## Chunk Schema

Each chunk includes:

```typescript
interface Chunk {
  id: string;                    // Stable ID: docId + "::" + chunkIndex
  docId: string;                 // SHA-256 hash of absolute file path
  chunkIndex: number;            // 0-based index within document
  fullText: string;              // Heading path + content
  summaryText: string;           // First sentence or first 200 chars
  titleText: string;             // Heading path joined with " > "
  headingPath: string[];         // Section hierarchy array
  sectionTitle: string | null;   // Immediate section title
  isTable: boolean;              // True if contains table data
  isCode: boolean;               // True if contains code/preformatted
  docType: string;               // pdf, docx, xlsx, etc.
  sourcePath: string;            // Original input file path
  pageNumber?: number;           // PDF/DOCX page number
  slideNumber?: number;          // PPT/PPTX slide number
  sheetName?: string;            // XLSX sheet name
  metadata?: Record<string, any>; // Additional metadata
}
```

## Sample Output

```json
[
  {
    "id": "a1b2c3d4e5f6g7h8::0",
    "docId": "a1b2c3d4e5f6g7h8",
    "chunkIndex": 0,
    "fullText": "Chapter 1 > Introduction\n\nThis document describes the system architecture...",
    "summaryText": "This document describes the system architecture.",
    "titleText": "Chapter 1 > Introduction",
    "headingPath": ["Chapter 1", "Introduction"],
    "sectionTitle": "Introduction",
    "isTable": false,
    "isCode": false,
    "docType": "pdf",
    "sourcePath": "./report.pdf",
    "pageNumber": 1,
    "metadata": {
      "fileName": "report.pdf",
      "fileSize": 245780,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "modifiedAt": "2024-01-20T14:22:00.000Z"
    }
  }
]
```

## Format-Specific Notes

### TXT

Heading detection uses heuristics:
- ALL CAPS lines surrounded by blank lines
- Lines ending with ":"
- Underlined text (===, ---)
- Numbered patterns (1., 1.1, Chapter 1)

Tables detected by consistent spacing, tabs, or pipe delimiters.

### Markdown

Uses the `marked` library for accurate parsing:
- Headings from # syntax (h1-h6)
- Fenced code blocks (```)
- Markdown table syntax
- Lists (bulleted and numbered)

### HTML

Uses `cheerio` for DOM parsing:
- Heading tags (h1-h6)
- Table elements
- Code blocks (<pre>, <code>)
- Strips scripts, styles, navigation

### PDF

Uses `pdf-parse` for text extraction:
- Page numbers preserved
- Heading inference from ALL CAPS, numbered patterns
- Basic table detection (aligned columns)

**Limitations**: Complex layouts may not parse perfectly. Font-based heading detection is limited.

### DOCX

Uses `mammoth` for parsing:
- Recognizes Word heading styles (Heading 1-6)
- Extracts tables with structure
- Handles lists
- Falls back to heuristics for unstyled headings

### XLSX

Uses `xlsx` library:
- Each sheet becomes a top-level section
- Detects header rows automatically
- Data regions become table chunks
- Handles merged cells

### PPT/PPTX

Uses XML parsing for PPTX:
- Slide titles are top-level headings
- Text boxes parsed as paragraphs
- Tables extracted
- Speaker notes included in metadata

**Limitations**: Binary .ppt format has limited support.

### EML/MSG

Uses `mailparser` for EML, `msgreader` for MSG:
- Subject line is top-level heading
- Email headers (From, To, Date) in metadata
- Quoted reply detection
- Attachment listing (filenames, sizes)

## Chunking Strategy

1. **Structure-based boundaries**: Chunks follow document structure (sections, paragraphs), not arbitrary character limits

2. **Size management**: Large sections (>1000 tokens) are split at paragraph or sentence boundaries into 200-500 token chunks

3. **Context preservation**: Each chunk includes its heading path for context

4. **Special content handling**: Tables and code blocks kept intact when possible

## Project Structure

```
src/
  chunker.ts           # CLI entry point
  types.ts             # TypeScript interfaces
  chunkerLogic.ts      # Core chunking logic
  parsers/
    txtParser.ts       # Plain text
    mdParser.ts        # Markdown
    htmlParser.ts      # HTML
    pdfParser.ts       # PDF
    docxParser.ts      # Word documents
    xlsxParser.ts      # Excel spreadsheets
    pptParser.ts       # PowerPoint
    emlParser.ts       # Email files
  utils/
    idGenerator.ts     # Stable ID generation
    textUtils.ts       # Text processing utilities
```

## Dependencies

- **cheerio**: HTML parsing
- **commander**: CLI argument parsing
- **mailparser**: EML email parsing
- **mammoth**: DOCX parsing
- **marked**: Markdown parsing
- **msgreader**: MSG (Outlook) parsing
- **pdf-parse**: PDF text extraction
- **unzipper**: ZIP file handling (for PPTX)
- **xlsx**: Excel parsing
- **xml2js**: XML parsing (for PPTX)

## Error Handling

- Graceful handling of parse errors per file
- Continues processing remaining files on error
- Summary shows success/failure counts
- Exit code 1 if any errors occurred

## Limitations

1. **PDF tables**: Detection is heuristic-based, complex tables may not parse correctly
2. **Binary PPT**: Old .ppt format has limited support
3. **Scanned PDFs**: No OCR support - only text-based PDFs
4. **Complex layouts**: Multi-column or unusual layouts may chunk incorrectly
5. **Large files**: Memory usage scales with file size

## Document Processor Pipeline

The project includes a complete document processing pipeline that wraps the chunker and adds:
- OpenAI embedding generation (multi-vector per chunk)
- Qdrant ingestion with hybrid search support (BM25 + dense vectors)
- Batch processing with error handling

### Quick Start

```bash
# 1. Start Qdrant locally
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant

# 2. Configure environment
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

# 3. Run the processor
npm run process
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | Your OpenAI API key |
| `QDRANT_URL` | No | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | No | - | Required for Qdrant Cloud |
| `QDRANT_COLLECTION` | No | `dev_docs` | Collection name |
| `SAMPLES_DIR` | No | `./samples` | Document directory |
| `BATCH_SIZE` | No | `50` | Points per upsert |
| `EMBEDDING_BATCH_SIZE` | No | `100` | Texts per embedding call |
| `MAX_RETRIES` | No | `3` | API retry attempts |

### How It Works

1. **Document Discovery**: Recursively finds all supported documents in the samples directory
2. **Chunking**: Uses the existing chunker to parse documents into structured chunks
3. **Embedding Generation**: Creates two vectors per chunk using `text-embedding-3-large`:
   - `full_vector`: Embedding of complete chunk content
   - `summary_vector`: Embedding of summary text
4. **Qdrant Ingestion**: Upserts points with:
   - Named vectors for multi-vector search
   - BM25-indexed `text` field for keyword search
   - Rich payload with all chunk metadata

### Qdrant Schema

The processor creates a collection with:

**Vectors:**
- `full_vector`: 3072-dim, Cosine distance
- `summary_vector`: 3072-dim, Cosine distance

**Payload Fields:**
- `text`: Full chunk text (BM25 indexed)
- `doc_id`, `chunk_index`, `doc_type`, `source_path`
- `heading_path`, `section_title`, `title_text`, `summary_text`
- `is_table`, `is_code`
- `page_number`, `slide_number`, `sheet_name`
- `created_at`, `updated_at`, `metadata`

### Cost Estimation

Using `text-embedding-3-large` (~$0.00013 per 1K tokens):
- 5,000 chunks × 2 embeddings × ~500 tokens = 5M tokens
- Estimated cost: **~$0.65**

### Example Output

```
Document Processor
==================

Configuration:
  - Samples directory: ./samples
  - Qdrant URL: http://localhost:6333
  - Collection: dev_docs

Found 250 documents to process

[1/250] Processing: report.pdf ✓ (45 chunks)
[2/250] Processing: presentation.pptx ✓ (28 chunks)
...

Total chunks: 5,432
Estimated embedding cost: $0.65 (2,716,000 tokens)

Generating embeddings for 5432 chunks...
  - Full text embeddings: 5432
  - Summary text embeddings: 5432

  Embedding full texts...
    [1/55] Embedding full batch (100 texts)... ✓
    ...

Upserting 5432 points to Qdrant...
  [1/109] Upserting batch (50 points)... ✓
  ...

✓ Processing complete!
  - Documents processed: 250/250
  - Chunks created: 5,432
  - Points upserted: 5,432
```

## License

MIT
