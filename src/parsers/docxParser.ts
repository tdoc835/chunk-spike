import * as fs from 'fs';
import mammoth from 'mammoth';
import { ParsedBlock, ParseResult } from '../types';

/**
 * DOCX Parser - Parses Word documents using mammoth
 *
 * Heading detection strategy:
 * - Uses official heading styles (Heading 1, Heading 2, etc.)
 * - Falls back to heuristics (bold text, all caps) when styles unavailable
 *
 * Special handling:
 * - Tables with proper row/column structure
 * - Numbered and bulleted lists
 * - Document metadata (author, title, etc.)
 */
export async function parseDocx(filePath: string): Promise<ParseResult> {
  const buffer = fs.readFileSync(filePath);

  // Configure mammoth with style mapping
  const options = {
    styleMap: [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
      "p[style-name='Heading 5'] => h5:fresh",
      "p[style-name='Heading 6'] => h6:fresh",
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => h2:fresh"
    ]
  };

  const result = await mammoth.convertToHtml({ buffer }, options);
  const html = result.value;

  // Parse the HTML output
  const blocks = parseDocxHtml(html);

  // Extract any warnings as metadata
  const metadata: Record<string, any> = {};
  if (result.messages.length > 0) {
    metadata.parserWarnings = result.messages.map(m => m.message);
  }

  return {
    blocks,
    metadata
  };
}

/**
 * Parses mammoth's HTML output into blocks
 */
function parseDocxHtml(html: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  // Simple regex-based parsing since mammoth outputs clean HTML
  // Split by major block elements
  const parts = html.split(/(<h[1-6][^>]*>|<\/h[1-6]>|<p[^>]*>|<\/p>|<table[^>]*>|<\/table>|<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>|<pre[^>]*>|<\/pre>)/i);

  let currentTag = '';
  let currentLevel = 0;
  let inTable = false;
  let tableContent = '';
  let inList = false;
  let listContent = '';
  let listOrdered = false;
  let inPre = false;
  let preContent = '';

  for (const part of parts) {
    if (!part) continue;

    // Check for opening tags
    const headingOpen = part.match(/<h([1-6])[^>]*>/i);
    if (headingOpen) {
      currentTag = 'heading';
      currentLevel = parseInt(headingOpen[1]);
      continue;
    }

    // Closing heading
    if (/<\/h[1-6]>/i.test(part)) {
      currentTag = '';
      continue;
    }

    // Paragraph tags
    if (/<p[^>]*>/i.test(part)) {
      currentTag = 'paragraph';
      continue;
    }

    if (/<\/p>/i.test(part)) {
      currentTag = '';
      continue;
    }

    // Table handling
    if (/<table[^>]*>/i.test(part)) {
      inTable = true;
      tableContent = '';
      continue;
    }

    if (/<\/table>/i.test(part)) {
      inTable = false;
      const parsed = parseTableHtml(tableContent);
      if (parsed) {
        blocks.push({
          type: 'table',
          content: parsed,
          isTable: true
        });
      }
      tableContent = '';
      continue;
    }

    // List handling
    if (/<ul[^>]*>/i.test(part)) {
      inList = true;
      listOrdered = false;
      listContent = '';
      continue;
    }

    if (/<ol[^>]*>/i.test(part)) {
      inList = true;
      listOrdered = true;
      listContent = '';
      continue;
    }

    if (/<\/ul>|<\/ol>/i.test(part)) {
      inList = false;
      const parsed = parseListHtml(listContent, listOrdered);
      if (parsed) {
        blocks.push({
          type: 'list',
          content: parsed
        });
      }
      listContent = '';
      continue;
    }

    // Pre/code handling
    if (/<pre[^>]*>/i.test(part)) {
      inPre = true;
      preContent = '';
      continue;
    }

    if (/<\/pre>/i.test(part)) {
      inPre = false;
      if (preContent.trim()) {
        blocks.push({
          type: 'code',
          content: stripHtml(preContent),
          isCode: true
        });
      }
      preContent = '';
      continue;
    }

    // Content handling
    if (inTable) {
      tableContent += part;
      continue;
    }

    if (inList) {
      listContent += part;
      continue;
    }

    if (inPre) {
      preContent += part;
      continue;
    }

    // Regular content
    const text = stripHtml(part).trim();
    if (!text) continue;

    if (currentTag === 'heading') {
      blocks.push({
        type: 'heading',
        content: text,
        level: currentLevel
      });
    } else if (currentTag === 'paragraph' || text) {
      // Check if it might be a heading based on content
      const maybeHeading = detectImplicitHeading(text);
      if (maybeHeading) {
        blocks.push({
          type: 'heading',
          content: maybeHeading.text,
          level: maybeHeading.level
        });
      } else {
        blocks.push({
          type: 'paragraph',
          content: text
        });
      }
    }
  }

  return blocks;
}

/**
 * Strips HTML tags from content
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parses table HTML into readable format
 */
function parseTableHtml(html: string): string {
  const rows: string[][] = [];

  // Extract rows
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const rowHtml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowHtml.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || [];

    for (const cellHtml of cellMatches) {
      cells.push(stripHtml(cellHtml).trim());
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return '';

  // Format as text table
  const colCount = Math.max(...rows.map(r => r.length));
  const colWidths: number[] = [];
  for (let i = 0; i < colCount; i++) {
    colWidths[i] = Math.max(...rows.map(r => (r[i] || '').length), 3);
  }

  const formatted = rows.map((row, idx) => {
    const paddedRow = row.map((cell, i) =>
      cell.padEnd(colWidths[i])
    ).join(' | ');

    if (idx === 0 && rows.length > 1) {
      const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');
      return paddedRow + '\n' + separator;
    }
    return paddedRow;
  });

  return formatted.join('\n');
}

/**
 * Parses list HTML into readable format
 */
function parseListHtml(html: string, ordered: boolean): string {
  const items: string[] = [];
  const itemMatches = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];

  for (let i = 0; i < itemMatches.length; i++) {
    const text = stripHtml(itemMatches[i]).trim();
    const bullet = ordered ? `${i + 1}.` : '-';
    if (text) {
      items.push(`${bullet} ${text}`);
    }
  }

  return items.join('\n');
}

/**
 * Detects implicit headings based on text characteristics
 * (for when Word doesn't use proper heading styles)
 */
function detectImplicitHeading(text: string): { text: string; level: number } | null {
  // ALL CAPS short text
  if (
    /^[A-Z][A-Z0-9\s\-_&:]+$/.test(text) &&
    text.length >= 3 &&
    text.length <= 80
  ) {
    return { text, level: text.length > 40 ? 1 : 2 };
  }

  // Numbered sections
  const numbered = text.match(/^(\d+(?:\.\d+)*\.?)\s+(.+)$/);
  if (numbered && text.length <= 100) {
    const level = (numbered[1].match(/\d+/g) || []).length;
    return { text, level: Math.min(level, 6) };
  }

  return null;
}
