import * as fs from 'fs';
import * as path from 'path';
import { Chunk, ParsedBlock, ParseResult, DocType, FileMetadata } from './types';
import { generateDocId, generateChunkId } from './utils/idGenerator';
import {
  joinHeadingPath,
  generateSummary,
  splitTextIntoChunks,
  estimateTokens,
  cleanText
} from './utils/textUtils';

// Import all parsers
import { parseTxt } from './parsers/txtParser';
import { parseMd } from './parsers/mdParser';
import { parseHtml } from './parsers/htmlParser';
import { parsePdf } from './parsers/pdfParser';
import { parseDocx } from './parsers/docxParser';
import { parseXlsx } from './parsers/xlsxParser';
import { parsePpt } from './parsers/pptParser';
import { parseEml } from './parsers/emlParser';

/**
 * Main chunking function - processes a file and returns chunks
 *
 * Chunking strategy:
 * 1. Parse the document into structured blocks using format-specific parser
 * 2. Build heading hierarchy from parsed blocks
 * 3. Group content blocks under their headings
 * 4. Split large sections into smaller chunks (200-500 tokens)
 * 5. Generate fullText, summaryText, and titleText for each chunk
 * 6. Assign stable IDs and metadata
 */
export async function chunkDocument(filePath: string): Promise<Chunk[]> {
  const absolutePath = path.resolve(filePath);
  const docId = generateDocId(filePath);
  const docType = getDocType(filePath);
  const fileMetadata = getFileMetadata(absolutePath);

  // Parse the document
  const parseResult = await parseDocument(absolutePath, docType);

  // Convert parsed blocks to chunks
  const chunks = blocksToChunks(
    parseResult.blocks,
    docId,
    docType,
    filePath,
    fileMetadata,
    parseResult.metadata
  );

  return chunks;
}

/**
 * Routes to the appropriate parser based on document type
 */
async function parseDocument(filePath: string, docType: DocType): Promise<ParseResult> {
  switch (docType) {
    case 'txt':
      return parseTxt(filePath);
    case 'md':
      return parseMd(filePath);
    case 'html':
      return parseHtml(filePath);
    case 'pdf':
      return parsePdf(filePath);
    case 'docx':
      return parseDocx(filePath);
    case 'xlsx':
      return parseXlsx(filePath);
    case 'ppt':
    case 'pptx':
      return parsePpt(filePath);
    case 'eml':
    case 'msg':
      return parseEml(filePath);
    default:
      throw new Error(`Unsupported document type: ${docType}`);
  }
}

/**
 * Converts parsed blocks into final Chunk objects
 *
 * Algorithm:
 * 1. Track heading stack to maintain hierarchy
 * 2. Accumulate content under each heading
 * 3. When hitting a new heading or end, flush accumulated content as chunks
 * 4. Split oversized sections
 */
function blocksToChunks(
  blocks: ParsedBlock[],
  docId: string,
  docType: DocType,
  sourcePath: string,
  fileMetadata: FileMetadata,
  docMetadata: Record<string, any>
): Chunk[] {
  const chunks: Chunk[] = [];

  // Heading stack: array of {level, title}
  const headingStack: Array<{ level: number; title: string }> = [];

  // Accumulated content for current section
  let currentContent: ParsedBlock[] = [];
  let currentPageNumber: number | undefined;
  let currentSlideNumber: number | undefined;
  let currentSheetName: string | undefined;

  // Process each block
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === 'heading') {
      // Flush current content before new heading
      if (currentContent.length > 0) {
        const sectionChunks = createChunksFromContent(
          currentContent,
          headingStack,
          docId,
          docType,
          sourcePath,
          chunks.length,
          fileMetadata,
          docMetadata,
          currentPageNumber,
          currentSlideNumber,
          currentSheetName
        );
        chunks.push(...sectionChunks);
        currentContent = [];
      }

      // Update heading stack
      const level = block.level || 1;

      // Pop headings that are same level or lower
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      // Push new heading
      headingStack.push({ level, title: block.content });

      // Update location tracking
      if (block.pageNumber !== undefined) currentPageNumber = block.pageNumber;
      if (block.slideNumber !== undefined) currentSlideNumber = block.slideNumber;
      if (block.sheetName !== undefined) currentSheetName = block.sheetName;
    } else {
      // Content block - accumulate
      currentContent.push(block);

      // Track location
      if (block.pageNumber !== undefined) currentPageNumber = block.pageNumber;
      if (block.slideNumber !== undefined) currentSlideNumber = block.slideNumber;
      if (block.sheetName !== undefined) currentSheetName = block.sheetName;
    }
  }

  // Flush remaining content
  if (currentContent.length > 0) {
    const sectionChunks = createChunksFromContent(
      currentContent,
      headingStack,
      docId,
      docType,
      sourcePath,
      chunks.length,
      fileMetadata,
      docMetadata,
      currentPageNumber,
      currentSlideNumber,
      currentSheetName
    );
    chunks.push(...sectionChunks);
  }

  // Handle empty documents
  if (chunks.length === 0) {
    chunks.push(createEmptyChunk(
      docId,
      docType,
      sourcePath,
      fileMetadata,
      docMetadata
    ));
  }

  return chunks;
}

/**
 * Creates chunks from accumulated content blocks
 * Handles splitting large sections into multiple chunks
 */
function createChunksFromContent(
  content: ParsedBlock[],
  headingStack: Array<{ level: number; title: string }>,
  docId: string,
  docType: DocType,
  sourcePath: string,
  startIndex: number,
  fileMetadata: FileMetadata,
  docMetadata: Record<string, any>,
  pageNumber?: number,
  slideNumber?: number,
  sheetName?: string
): Chunk[] {
  const chunks: Chunk[] = [];

  // Build heading path
  const headingPath = headingStack.map(h => h.title);
  const titleText = joinHeadingPath(headingPath);
  const sectionTitle = headingPath.length > 0 ? headingPath[headingPath.length - 1] : null;

  // Combine content into text
  let combinedText = '';
  let isTable = false;
  let isCode = false;
  let blockMetadata: Record<string, any> = {};

  for (const block of content) {
    if (block.content) {
      combinedText += (combinedText ? '\n\n' : '') + block.content;
    }
    if (block.isTable) isTable = true;
    if (block.isCode) isCode = true;
    if (block.metadata) {
      blockMetadata = { ...blockMetadata, ...block.metadata };
    }
  }

  combinedText = cleanText(combinedText);

  if (!combinedText) {
    return chunks;
  }

  // Check if we need to split
  const tokens = estimateTokens(combinedText);

  if (tokens > 1000) {
    // Split into smaller chunks
    const textChunks = splitTextIntoChunks(combinedText, 500, 200);

    for (let i = 0; i < textChunks.length; i++) {
      const chunkIndex = startIndex + chunks.length;
      const chunkText = textChunks[i];

      // Build fullText with heading path
      const fullText = titleText
        ? `${titleText}\n\n${chunkText}`
        : chunkText;

      chunks.push({
        id: generateChunkId(docId, chunkIndex),
        docId,
        chunkIndex,
        fullText,
        summaryText: generateSummary(chunkText),
        titleText,
        headingPath: [...headingPath],
        sectionTitle,
        isTable,
        isCode,
        docType,
        sourcePath,
        pageNumber,
        slideNumber,
        sheetName,
        metadata: {
          ...fileMetadata,
          ...docMetadata,
          ...blockMetadata,
          splitPart: i + 1,
          totalParts: textChunks.length
        }
      });
    }
  } else {
    // Single chunk
    const chunkIndex = startIndex + chunks.length;

    // Build fullText with heading path
    const fullText = titleText
      ? `${titleText}\n\n${combinedText}`
      : combinedText;

    chunks.push({
      id: generateChunkId(docId, chunkIndex),
      docId,
      chunkIndex,
      fullText,
      summaryText: generateSummary(combinedText),
      titleText,
      headingPath: [...headingPath],
      sectionTitle,
      isTable,
      isCode,
      docType,
      sourcePath,
      pageNumber,
      slideNumber,
      sheetName,
      metadata: {
        ...fileMetadata,
        ...docMetadata,
        ...blockMetadata
      }
    });
  }

  return chunks;
}

/**
 * Creates an empty chunk for documents with no content
 */
function createEmptyChunk(
  docId: string,
  docType: DocType,
  sourcePath: string,
  fileMetadata: FileMetadata,
  docMetadata: Record<string, any>
): Chunk {
  return {
    id: generateChunkId(docId, 0),
    docId,
    chunkIndex: 0,
    fullText: '[Empty document]',
    summaryText: 'Empty document',
    titleText: '',
    headingPath: [],
    sectionTitle: null,
    isTable: false,
    isCode: false,
    docType,
    sourcePath,
    metadata: {
      ...fileMetadata,
      ...docMetadata,
      isEmpty: true
    }
  };
}

/**
 * Determines document type from file extension
 */
function getDocType(filePath: string): DocType {
  const ext = path.extname(filePath).toLowerCase().slice(1);

  const typeMap: Record<string, DocType> = {
    'txt': 'txt',
    'md': 'md',
    'markdown': 'md',
    'html': 'html',
    'htm': 'html',
    'pdf': 'pdf',
    'docx': 'docx',
    'xlsx': 'xlsx',
    'xls': 'xlsx',
    'ppt': 'ppt',
    'pptx': 'pptx',
    'eml': 'eml',
    'msg': 'msg'
  };

  const docType = typeMap[ext];
  if (!docType) {
    throw new Error(`Unsupported file extension: .${ext}`);
  }

  return docType;
}

/**
 * Extracts file metadata from filesystem
 */
function getFileMetadata(absolutePath: string): FileMetadata {
  const stats = fs.statSync(absolutePath);

  return {
    fileName: path.basename(absolutePath),
    fileSize: stats.size,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
    absolutePath
  };
}
