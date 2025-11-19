# Sample Markdown Document

This is a sample markdown document for testing the chunker.

## Introduction

The document chunker is a TypeScript CLI tool for parsing documents into structured chunks.

### Features

- **Multi-format support**: TXT, MD, HTML, PDF, DOCX, XLSX, PPT/PPTX, EML/MSG
- **Structure-aware chunking**: Chunks based on logical units
- **Heading hierarchy**: Maintains document structure

## Technical Details

### Architecture

The chunker consists of several components:

1. Parser modules for each format
2. Chunking logic
3. CLI interface

### Code Example

Here's how to use the chunker:

```typescript
import { chunkDocument } from './chunkerLogic';

const chunks = await chunkDocument('./document.pdf');
console.log(JSON.stringify(chunks, null, 2));
```

## Data Tables

| Format | Extension | Library |
|--------|-----------|---------|
| PDF    | .pdf      | pdf-parse |
| Word   | .docx     | mammoth |
| Excel  | .xlsx     | xlsx |
| PowerPoint | .pptx | xml2js |

## Conclusion

The document chunker provides a flexible solution for document processing pipelines.

> Note: This tool is designed for chunking only. It does not include embedding or retrieval functionality.
