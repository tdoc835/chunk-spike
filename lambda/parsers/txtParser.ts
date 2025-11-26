import * as fs from 'fs';
import { ParsedBlock, ParseResult } from '../types';
import { isTableLike } from '../utils/textUtils';

/**
 * TXT Parser - Parses plain text files with heading heuristics
 *
 * Heading detection strategy:
 * 1. ALL CAPS lines (at least 3 chars, not too long)
 * 2. Lines ending with ":"
 * 3. Lines surrounded by blank lines that are short
 * 4. Underlined text (===, ---)
 * 5. Numbered headings (1., 1.1, Chapter 1, etc.)
 */
export async function parseTxt(filePath: string): Promise<ParseResult> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const blocks: ParsedBlock[] = [];

  let currentHeadingLevel = 0;
  let currentContent: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : '';
    const nextLine = i < lines.length - 1 ? lines[i + 1] : '';

    // Check for underlined headings (=== or ---)
    if (nextLine && /^[=]{3,}$/.test(nextLine.trim())) {
      // This is a level 1 heading
      flushContent(blocks, currentContent, currentHeadingLevel);
      currentContent = [];
      blocks.push({
        type: 'heading',
        content: line.trim(),
        level: 1
      });
      currentHeadingLevel = 1;
      i += 2; // Skip the underline
      continue;
    }

    if (nextLine && /^[-]{3,}$/.test(nextLine.trim())) {
      // This is a level 2 heading
      flushContent(blocks, currentContent, currentHeadingLevel);
      currentContent = [];
      blocks.push({
        type: 'heading',
        content: line.trim(),
        level: 2
      });
      currentHeadingLevel = 2;
      i += 2;
      continue;
    }

    // Check for heading patterns
    const headingInfo = detectHeading(line, prevLine, nextLine);
    if (headingInfo) {
      flushContent(blocks, currentContent, currentHeadingLevel);
      currentContent = [];
      blocks.push({
        type: 'heading',
        content: headingInfo.text,
        level: headingInfo.level
      });
      currentHeadingLevel = headingInfo.level;
      i++;
      continue;
    }

    // Regular content line
    currentContent.push(line);
    i++;
  }

  // Flush remaining content
  flushContent(blocks, currentContent, currentHeadingLevel);

  return {
    blocks,
    metadata: {}
  };
}

/**
 * Flushes accumulated content into appropriate blocks
 */
function flushContent(
  blocks: ParsedBlock[],
  content: string[],
  currentLevel: number
): void {
  const text = content.join('\n').trim();
  if (!text) return;

  // Split by double newlines to get paragraphs
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  for (const para of paragraphs) {
    const trimmed = para.trim();

    // Check if it's a table
    if (isTableLike(trimmed)) {
      blocks.push({
        type: 'table',
        content: trimmed,
        isTable: true
      });
    }
    // Check if it's code (indented with 4+ spaces)
    else if (isCodeBlock(trimmed)) {
      blocks.push({
        type: 'code',
        content: trimmed,
        isCode: true
      });
    }
    // Check if it's a list
    else if (isList(trimmed)) {
      blocks.push({
        type: 'list',
        content: trimmed
      });
    }
    // Regular paragraph
    else {
      blocks.push({
        type: 'paragraph',
        content: trimmed
      });
    }
  }
}

/**
 * Detects if a line is a heading based on various heuristics
 */
function detectHeading(
  line: string,
  prevLine: string,
  nextLine: string
): { text: string; level: number } | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.length < 2) return null;

  // Pattern 1: ALL CAPS (at least 3 chars, not too long, surrounded by blank lines)
  if (
    /^[A-Z][A-Z0-9\s\-_&:,.]+$/.test(trimmed) &&
    trimmed.length >= 3 &&
    trimmed.length <= 100 &&
    !prevLine.trim() &&
    !nextLine.trim()
  ) {
    return { text: trimmed, level: 1 };
  }

  // Pattern 2: Numbered headings like "1.", "1.1", "Chapter 1"
  const numberedMatch = trimmed.match(/^(\d+\.(?:\d+\.)*|\s*Chapter\s+\d+[:.]*)\s*(.+)?$/i);
  if (numberedMatch && !prevLine.trim()) {
    const level = (numberedMatch[1].match(/\./g) || []).length || 1;
    return {
      text: trimmed,
      level: Math.min(level, 6)
    };
  }

  // Pattern 3: Lines ending with ":" that are short and surrounded by blank lines
  if (
    trimmed.endsWith(':') &&
    trimmed.length <= 80 &&
    !prevLine.trim() &&
    nextLine.trim()
  ) {
    return { text: trimmed.slice(0, -1), level: 2 };
  }

  // Pattern 4: Short lines surrounded by blank lines (potential titles)
  if (
    !prevLine.trim() &&
    !nextLine.trim() &&
    trimmed.length >= 3 &&
    trimmed.length <= 60 &&
    !trimmed.includes('.') &&
    /^[A-Z]/.test(trimmed)
  ) {
    return { text: trimmed, level: 2 };
  }

  return null;
}

/**
 * Checks if text appears to be a code block (indented)
 */
function isCodeBlock(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length < 2) return false;

  // Check if most lines are indented with 4+ spaces
  const indentedLines = lines.filter(l => /^(\s{4,}|\t)/.test(l) || !l.trim());
  return indentedLines.length / lines.length >= 0.8;
}

/**
 * Checks if text appears to be a list
 */
function isList(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;

  // Check for bullet or numbered list patterns
  const listLines = lines.filter(l =>
    /^\s*[-*•]\s+/.test(l) ||
    /^\s*\d+[.)]\s+/.test(l) ||
    /^\s*[a-z][.)]\s+/i.test(l)
  );

  return listLines.length / lines.length >= 0.7;
}
