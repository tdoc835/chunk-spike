import * as fs from 'fs';
import * as cheerio from 'cheerio';
import { ParsedBlock, ParseResult } from '../types';

/**
 * HTML Parser - Parses HTML files using cheerio
 *
 * Heading detection strategy:
 * - Uses h1-h6 tags directly
 * - Preserves semantic structure
 *
 * Special handling:
 * - Tables (<table>)
 * - Code blocks (<pre>, <code>)
 * - Lists (<ul>, <ol>)
 * - Strips scripts, styles, navigation elements
 */
export async function parseHtml(filePath: string): Promise<ParseResult> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(content);
  const blocks: ParsedBlock[] = [];

  // Remove unwanted elements
  $('script, style, nav, footer, header, aside, noscript, iframe').remove();

  // Extract title as metadata
  const title = $('title').text().trim();
  const metadata: Record<string, any> = {};
  if (title) {
    metadata.title = title;
  }

  // Extract meta description
  const metaDesc = $('meta[name="description"]').attr('content');
  if (metaDesc) {
    metadata.description = metaDesc;
  }

  // Process body content
  const body = $('body').length ? $('body') : $.root();

  // Process elements in order
  processElement($, body, blocks);

  return {
    blocks,
    metadata
  };
}

/**
 * Recursively processes HTML elements into blocks
 */
function processElement(
  $: cheerio.CheerioAPI,
  element: cheerio.Cheerio<any>,
  blocks: ParsedBlock[]
): void {
  element.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = $(node).text().trim();
      if (text && text.length > 0) {
        // Check if we should merge with previous paragraph
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'paragraph') {
          lastBlock.content += ' ' + text;
        } else if (text.length > 10) {
          blocks.push({
            type: 'paragraph',
            content: text
          });
        }
      }
      return;
    }

    if (node.type !== 'tag') return;

    const $el = $(node);
    const tagName = node.name.toLowerCase();

    // Headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = parseInt(tagName[1]);
      const text = $el.text().trim();
      if (text) {
        blocks.push({
          type: 'heading',
          content: text,
          level
        });
      }
      return;
    }

    // Paragraphs
    if (tagName === 'p') {
      const text = $el.text().trim();
      if (text) {
        blocks.push({
          type: 'paragraph',
          content: text
        });
      }
      return;
    }

    // Code blocks
    if (tagName === 'pre' || tagName === 'code') {
      const text = $el.text().trim();
      if (text) {
        // Check if it's inline code (small) vs code block
        if (tagName === 'pre' || text.includes('\n') || text.length > 100) {
          blocks.push({
            type: 'code',
            content: text,
            isCode: true
          });
        } else {
          // Inline code - merge with surrounding text
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock && lastBlock.type === 'paragraph') {
            lastBlock.content += ' `' + text + '`';
          }
        }
      }
      return;
    }

    // Tables
    if (tagName === 'table') {
      const tableContent = parseTable($, $el);
      if (tableContent) {
        blocks.push({
          type: 'table',
          content: tableContent,
          isTable: true
        });
      }
      return;
    }

    // Lists
    if (tagName === 'ul' || tagName === 'ol') {
      const listContent = parseList($, $el, tagName === 'ol');
      if (listContent) {
        blocks.push({
          type: 'list',
          content: listContent
        });
      }
      return;
    }

    // Blockquotes
    if (tagName === 'blockquote') {
      const text = $el.text().trim();
      if (text) {
        const quotedText = text.split('\n').map(line => `> ${line}`).join('\n');
        blocks.push({
          type: 'paragraph',
          content: quotedText
        });
      }
      return;
    }

    // Divs, articles, sections - recurse
    if (['div', 'article', 'section', 'main', 'span'].includes(tagName)) {
      processElement($, $el, blocks);
      return;
    }

    // Other elements - try to extract text
    const text = $el.text().trim();
    if (text && !$el.children().length) {
      blocks.push({
        type: 'paragraph',
        content: text
      });
    } else if ($el.children().length) {
      processElement($, $el, blocks);
    }
  });
}

/**
 * Parses an HTML table into readable text
 */
function parseTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): string {
  const rows: string[][] = [];

  table.find('tr').each((_, tr) => {
    const cells: string[] = [];
    $(tr).find('th, td').each((_, cell) => {
      cells.push($(cell).text().trim());
    });
    if (cells.length > 0) {
      rows.push(cells);
    }
  });

  if (rows.length === 0) return '';

  // Calculate column widths
  const colCount = Math.max(...rows.map(r => r.length));
  const colWidths: number[] = [];
  for (let i = 0; i < colCount; i++) {
    colWidths[i] = Math.max(...rows.map(r => (r[i] || '').length), 3);
  }

  // Format rows
  const formatted = rows.map((row, idx) => {
    const paddedRow = row.map((cell, i) =>
      cell.padEnd(colWidths[i])
    ).join(' | ');

    // Add separator after first row (assumed header)
    if (idx === 0 && rows.length > 1) {
      const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');
      return paddedRow + '\n' + separator;
    }
    return paddedRow;
  });

  return formatted.join('\n');
}

/**
 * Parses an HTML list into readable text
 */
function parseList(
  $: cheerio.CheerioAPI,
  list: cheerio.Cheerio<any>,
  ordered: boolean,
  indent: number = 0
): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  list.children('li').each((i, li) => {
    const $li = $(li);
    const bullet = ordered ? `${i + 1}.` : '-';

    // Get direct text (not nested lists)
    let text = '';
    $li.contents().each((_, node) => {
      if (node.type === 'text') {
        text += $(node).text();
      } else if (node.type === 'tag' && !['ul', 'ol'].includes(node.name)) {
        text += $(node).text();
      }
    });

    text = text.trim();
    if (text) {
      lines.push(`${prefix}${bullet} ${text}`);
    }

    // Handle nested lists
    $li.children('ul, ol').each((_, nestedList) => {
      const nestedContent = parseList(
        $,
        $(nestedList),
        nestedList.name === 'ol',
        indent + 1
      );
      if (nestedContent) {
        lines.push(nestedContent);
      }
    });
  });

  return lines.join('\n');
}
