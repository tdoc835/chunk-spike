import * as fs from 'fs';
import pdfParse from 'pdf-parse';
import { ParsedBlock, ParseResult } from '../types';

/**
 * PDF Parser - Parses PDF files using pdf-parse
 *
 * Heading detection strategy:
 * 1. ALL CAPS lines
 * 2. Numeric patterns (1., 1.1, 1.1.1)
 * 3. Lines surrounded by blank lines that are short
 * 4. Bold/larger text (limited detection with pdf-parse)
 *
 * Table detection:
 * - Aligned columns with repeated spacing
 * - Multiple consecutive lines with similar structure
 */
export async function parsePdf(filePath: string): Promise<ParseResult> {
  const dataBuffer = fs.readFileSync(filePath);

  // Configure pdf-parse to preserve page breaks
  const options = {
    pagerender: renderPage
  };

  const data = await pdfParse(dataBuffer, options);

  const blocks: ParsedBlock[] = [];
  const metadata: Record<string, any> = {
    pageCount: data.numpages,
    info: data.info
  };

  // Split by page markers we inserted
  const pages = data.text.split('<<<PAGE_BREAK>>>');

  for (let pageNum = 0; pageNum < pages.length; pageNum++) {
    const pageContent = pages[pageNum].trim();
    if (!pageContent) continue;

    const pageBlocks = parsePageContent(pageContent, pageNum + 1);
    blocks.push(...pageBlocks);
  }

  return {
    blocks,
    metadata
  };
}

/**
 * Custom page renderer to insert page break markers
 */
function renderPage(pageData: any): Promise<string> {
  return pageData.getTextContent().then((textContent: any) => {
    let lastY = -1;
    let text = '';

    for (const item of textContent.items) {
      if (lastY !== item.transform[5] && lastY !== -1) {
        text += '\n';
      }
      text += item.str;
      lastY = item.transform[5];
    }

    return text + '<<<PAGE_BREAK>>>';
  });
}

/**
 * Parses content from a single page into blocks
 */
function parsePageContent(content: string, pageNumber: number): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = content.split('\n');

  let currentContent: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : '';
    const nextLine = i < lines.length - 1 ? lines[i + 1] : '';

    // Check for heading patterns
    const headingInfo = detectPdfHeading(line, prevLine, nextLine);
    if (headingInfo) {
      // Flush current content
      flushPdfContent(blocks, currentContent, pageNumber);
      currentContent = [];

      blocks.push({
        type: 'heading',
        content: headingInfo.text,
        level: headingInfo.level,
        pageNumber
      });

      i++;
      continue;
    }

    // Check for table start
    if (isTableStart(lines, i)) {
      // Flush current content
      flushPdfContent(blocks, currentContent, pageNumber);
      currentContent = [];

      // Extract table content
      const tableResult = extractTable(lines, i);
      blocks.push({
        type: 'table',
        content: tableResult.content,
        isTable: true,
        pageNumber
      });

      i = tableResult.endIndex;
      continue;
    }

    currentContent.push(line);
    i++;
  }

  // Flush remaining content
  flushPdfContent(blocks, currentContent, pageNumber);

  return blocks;
}

/**
 * Detects if a line is a heading based on PDF heuristics
 */
function detectPdfHeading(
  line: string,
  prevLine: string,
  nextLine: string
): { text: string; level: number } | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.length < 2) return null;

  // Pattern 1: Numbered headings (1., 1.1, 1.1.1, etc.)
  const numberedMatch = trimmed.match(/^(\d+(?:\.\d+)*\.?)\s+(.+)$/);
  if (numberedMatch) {
    const numbering = numberedMatch[1];
    const level = (numbering.match(/\d+/g) || []).length;
    return {
      text: trimmed,
      level: Math.min(level, 6)
    };
  }

  // Pattern 2: ALL CAPS lines (likely section headers)
  if (
    /^[A-Z][A-Z0-9\s\-_&:,.]+$/.test(trimmed) &&
    trimmed.length >= 3 &&
    trimmed.length <= 100 &&
    !prevLine.trim()
  ) {
    // Determine level based on length/context
    const level = trimmed.length > 50 ? 1 : 2;
    return { text: trimmed, level };
  }

  // Pattern 3: Chapter/Section markers
  const chapterMatch = trimmed.match(/^(Chapter|Section|Part|Article)\s+(\d+|[IVXLC]+)[.:]*\s*(.*)$/i);
  if (chapterMatch) {
    return {
      text: trimmed,
      level: chapterMatch[1].toLowerCase() === 'chapter' ? 1 : 2
    };
  }

  // Pattern 4: Short lines surrounded by blank lines
  if (
    !prevLine.trim() &&
    !nextLine.trim() &&
    trimmed.length >= 3 &&
    trimmed.length <= 60 &&
    /^[A-Z]/.test(trimmed)
  ) {
    return { text: trimmed, level: 2 };
  }

  return null;
}

/**
 * Flushes accumulated content into blocks
 */
function flushPdfContent(
  blocks: ParsedBlock[],
  content: string[],
  pageNumber: number
): void {
  const text = content.join('\n').trim();
  if (!text) return;

  // Split by double newlines
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  for (const para of paragraphs) {
    const trimmed = para.trim();

    // Check if it looks like a list
    if (isList(trimmed)) {
      blocks.push({
        type: 'list',
        content: trimmed,
        pageNumber
      });
    } else {
      blocks.push({
        type: 'paragraph',
        content: trimmed,
        pageNumber
      });
    }
  }
}

/**
 * Checks if content appears to be a list
 */
function isList(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;

  const listLines = lines.filter(l =>
    /^\s*[-*•]\s+/.test(l) ||
    /^\s*\d+[.)]\s+/.test(l) ||
    /^\s*[a-z][.)]\s+/i.test(l)
  );

  return listLines.length / lines.length >= 0.7;
}

/**
 * Detects if a potential table starts at the given line index
 */
function isTableStart(lines: string[], startIndex: number): boolean {
  // Need at least 2 lines for a table
  if (startIndex + 1 >= lines.length) return false;

  const line1 = lines[startIndex];
  const line2 = lines[startIndex + 1];

  // Check for consistent spacing patterns
  const spaces1 = (line1.match(/\s{2,}/g) || []).length;
  const spaces2 = (line2.match(/\s{2,}/g) || []).length;

  // Both lines should have multiple spacing groups
  if (spaces1 < 2 || spaces2 < 2) return false;

  // Similar number of spacing groups
  return Math.abs(spaces1 - spaces2) <= 1;
}

/**
 * Extracts table content starting from the given line
 */
function extractTable(
  lines: string[],
  startIndex: number
): { content: string; endIndex: number } {
  const tableLines: string[] = [];
  let i = startIndex;

  // Count spaces in first line to establish pattern
  const firstSpaces = (lines[startIndex].match(/\s{2,}/g) || []).length;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line might end table
    if (!trimmed) {
      // Check if next line continues table
      if (i + 1 < lines.length) {
        const nextSpaces = (lines[i + 1].match(/\s{2,}/g) || []).length;
        if (Math.abs(nextSpaces - firstSpaces) <= 1 && nextSpaces >= 2) {
          tableLines.push('');
          i++;
          continue;
        }
      }
      break;
    }

    // Check if line fits table pattern
    const lineSpaces = (line.match(/\s{2,}/g) || []).length;
    if (lineSpaces < 2 && tableLines.length > 0) {
      break;
    }

    tableLines.push(line);
    i++;

    // Reasonable limit for table detection
    if (tableLines.length > 100) break;
  }

  return {
    content: tableLines.join('\n'),
    endIndex: i
  };
}
