import * as fs from 'fs';
import { marked, Token } from 'marked';
import { ParsedBlock, ParseResult } from '../types';

/**
 * Markdown Parser - Parses markdown files using marked library
 *
 * Heading detection strategy:
 * - Uses # markers directly from markdown syntax
 * - Preserves heading hierarchy (h1-h6)
 *
 * Special handling:
 * - Code blocks (fenced ```)
 * - Tables (markdown table syntax)
 * - Lists (bulleted and numbered)
 */
export async function parseMd(filePath: string): Promise<ParseResult> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const blocks: ParsedBlock[] = [];

  // Configure marked to use synchronous lexer
  const tokens = marked.lexer(content);

  for (const token of tokens) {
    processToken(token, blocks);
  }

  return {
    blocks,
    metadata: {}
  };
}

/**
 * Processes a markdown token into ParsedBlocks
 */
function processToken(token: Token, blocks: ParsedBlock[]): void {
  switch (token.type) {
    case 'heading':
      blocks.push({
        type: 'heading',
        content: extractText(token),
        level: token.depth
      });
      break;

    case 'paragraph':
      blocks.push({
        type: 'paragraph',
        content: extractText(token)
      });
      break;

    case 'code':
      blocks.push({
        type: 'code',
        content: token.text,
        isCode: true,
        metadata: token.lang ? { language: token.lang } : undefined
      });
      break;

    case 'table':
      const tableContent = formatMarkdownTable(token);
      blocks.push({
        type: 'table',
        content: tableContent,
        isTable: true
      });
      break;

    case 'list':
      const listContent = formatList(token);
      blocks.push({
        type: 'list',
        content: listContent
      });
      break;

    case 'blockquote':
      blocks.push({
        type: 'paragraph',
        content: extractBlockquoteText(token)
      });
      break;

    case 'html':
      // Skip HTML blocks in markdown or extract text
      const textContent = token.text.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({
          type: 'paragraph',
          content: textContent
        });
      }
      break;

    case 'space':
      // Ignore whitespace tokens
      break;

    case 'hr':
      // Ignore horizontal rules
      break;

    default:
      // Handle any other token types
      if ('text' in token && token.text) {
        blocks.push({
          type: 'paragraph',
          content: token.text
        });
      }
  }
}

/**
 * Extracts plain text from a token, handling nested tokens
 */
function extractText(token: any): string {
  if (typeof token === 'string') return token;

  if (token.text) {
    return token.text;
  }

  if (token.tokens) {
    return token.tokens.map(extractText).join('');
  }

  return '';
}

/**
 * Extracts text from blockquote tokens
 */
function extractBlockquoteText(token: any): string {
  if (token.tokens) {
    return token.tokens
      .map((t: any) => {
        if (t.type === 'paragraph') return extractText(t);
        if (t.text) return t.text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .split('\n')
      .map((line: string) => `> ${line}`)
      .join('\n');
  }
  return '';
}

/**
 * Formats a markdown table into readable text
 */
function formatMarkdownTable(token: any): string {
  const rows: string[] = [];

  // Header
  if (token.header && token.header.length > 0) {
    const headerRow = token.header.map((cell: any) => extractText(cell)).join(' | ');
    rows.push(headerRow);

    // Separator
    const separator = token.header.map(() => '---').join(' | ');
    rows.push(separator);
  }

  // Body rows
  if (token.rows) {
    for (const row of token.rows) {
      const rowText = row.map((cell: any) => extractText(cell)).join(' | ');
      rows.push(rowText);
    }
  }

  return rows.join('\n');
}

/**
 * Formats a list into readable text
 */
function formatList(token: any, indent: number = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  if (token.items) {
    for (let i = 0; i < token.items.length; i++) {
      const item = token.items[i];
      const bullet = token.ordered ? `${i + 1}.` : '-';

      // Get item text
      let itemText = '';
      if (item.tokens) {
        for (const subToken of item.tokens) {
          if (subToken.type === 'text') {
            itemText += subToken.text;
          } else if (subToken.type === 'paragraph') {
            itemText += extractText(subToken);
          } else if (subToken.type === 'list') {
            // Nested list
            if (itemText) {
              lines.push(`${prefix}${bullet} ${itemText}`);
              itemText = '';
            }
            lines.push(formatList(subToken, indent + 1));
            continue;
          }
        }
      } else if (item.text) {
        itemText = item.text;
      }

      if (itemText) {
        lines.push(`${prefix}${bullet} ${itemText}`);
      }
    }
  }

  return lines.join('\n');
}
