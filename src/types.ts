/**
 * Core Chunk interface - represents a structured unit of document content
 */
export interface Chunk {
  id: string;                    // stable ID: docId + "::" + chunkIndex
  docId: string;                 // deterministic hash from absolute file path
  chunkIndex: number;            // 0-based index
  fullText: string;              // heading path + structured content
  summaryText: string;           // short summary (first sentence or first 200 chars)
  titleText: string;             // heading path joined with " > "
  headingPath: string[];         // section hierarchy (e.g., ["Chapter 1", "Introduction"])
  sectionTitle: string | null;   // immediate section/heading title
  isTable: boolean;              // true if chunk contains table data
  isCode: boolean;               // true if chunk contains code/preformatted content
  docType: string;               // pdf, docx, xlsx, pptx, txt, md, html, eml, msg
  sourcePath: string;            // original input file path
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
 * File metadata extracted from filesystem
 */
export interface FileMetadata {
  fileName: string;
  fileSize: number;
  createdAt: Date;
  modifiedAt: Date;
  absolutePath: string;
}
