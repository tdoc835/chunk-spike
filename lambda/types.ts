/**
 * Core type definitions for document processing Lambda
 */

/**
 * Core Chunk interface - represents a structured unit of document content
 * Extended with S3 fields for Lambda processing
 */
export interface Chunk {
  id: string;                    // stable ID: docId + "::" + chunkIndex
  docId: string;                 // deterministic hash from S3 key
  chunkIndex: number;            // 0-based index
  fullText: string;              // heading path + structured content
  summaryText: string;           // short summary (first sentence or first 200 chars)
  titleText: string;             // heading path joined with " > "
  headingPath: string[];         // section hierarchy (e.g., ["Chapter 1", "Introduction"])
  sectionTitle: string | null;   // immediate section/heading title
  isTable: boolean;              // true if chunk contains table data
  isCode: boolean;               // true if chunk contains code/preformatted content
  docType: string;               // pdf, docx, xlsx, pptx, txt, md, html, eml, msg
  sourcePath: string;            // S3 key (original object key)
  s3Key: string;                 // Full S3 object key
  s3Bucket: string;              // S3 bucket name
  pageNumber?: number;           // from PDF/DOCX, if known
  slideNumber?: number;          // from PPT/PPTX
  sheetName?: string;            // from XLSX
  metadata?: Record<string, any>; // extensible metadata (timestamps, authors, etc.)
}

/**
 * Parsed content block - intermediate representation from parsers
 */
export interface ParsedBlock {
  type: 'heading' | 'paragraph' | 'table' | 'code' | 'list' | 'email-header' | 'attachment-list';
  content: string;
  level?: number;           // heading level (1-6)
  isTable?: boolean;
  isCode?: boolean;
  pageNumber?: number;
  slideNumber?: number;
  sheetName?: string;
  metadata?: Record<string, any>;
}

/**
 * Document type enumeration
 */
export type DocType = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'ppt' | 'txt' | 'md' | 'html' | 'eml' | 'msg';

/**
 * Parser result - what each parser returns
 */
export interface ParseResult {
  blocks: ParsedBlock[];
  metadata: Record<string, any>;
}

/**
 * File metadata extracted from S3 object
 */
export interface FileMetadata {
  fileName: string;
  fileSize: number;
  s3Key: string;
  s3Bucket: string;
  localPath: string;
}

/**
 * S3 Event record structure
 */
export interface S3EventRecord {
  eventVersion: string;
  eventSource: string;
  awsRegion: string;
  eventTime: string;
  eventName: string;
  s3: {
    bucket: {
      name: string;
      arn: string;
    };
    object: {
      key: string;
      size: number;
      eTag: string;
    };
  };
}

/**
 * S3 Event structure
 */
export interface S3Event {
  Records: S3EventRecord[];
}

/**
 * Lambda response structure
 */
export interface LambdaResponse {
  statusCode: number;
  body: string;
}

/**
 * Processing result for a single document
 */
export interface ProcessingResult {
  success: boolean;
  bucket: string;
  key: string;
  tenantId: string;
  chunksCreated: number;
  pointsUpserted: number;
  error?: string;
}

/**
 * Embedding results for a single chunk
 */
export interface ChunkEmbeddings {
  chunkId: string;
  fullVector: number[];
  summaryVector: number[];
}

/**
 * Qdrant payload structure - extended with S3 fields
 */
export interface QdrantPayload {
  // BM25 field - CRITICAL for keyword search
  text: string;

  // Original chunk ID for reference
  chunk_id: string;

  // Document metadata
  doc_id: string;
  chunk_index: number;
  doc_type: string;
  source_path: string;

  // S3 location - NEW FIELDS
  s3_key: string;
  s3_bucket: string;

  // Content structure
  heading_path: string[];
  section_title: string | null;
  title_text: string;
  summary_text: string;

  // Content flags
  is_table: boolean;
  is_code: boolean;

  // Location references
  page_number?: number;
  slide_number?: number;
  sheet_name?: string;

  // Timestamps
  created_at: string;
  updated_at: string;

  // Additional metadata
  metadata: Record<string, unknown>;

  // Index signature for Qdrant compatibility
  [key: string]: unknown;
}

/**
 * Qdrant point structure with named vectors
 */
export interface QdrantPoint {
  id: string;
  vector: {
    full_vector: number[];
    summary_vector: number[];
  };
  payload: QdrantPayload;
}
