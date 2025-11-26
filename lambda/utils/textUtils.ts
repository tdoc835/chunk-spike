/**
 * Text utility functions for document chunking
 */

/**
 * Joins heading path into a title string
 *
 * @param headingPath - Array of heading strings forming the hierarchy
 * @returns Joined string with " > " separator
 */
export function joinHeadingPath(headingPath: string[]): string {
  return headingPath.filter(h => h.trim()).join(' > ');
}

/**
 * Generates a deterministic summary text from content
 * Strategy: First complete sentence OR first 200 characters, whichever is shorter
 *
 * @param text - The full text content
 * @returns A short summary string
 */
export function generateSummary(text: string): string {
  if (!text || text.trim().length === 0) {
    return '';
  }

  const cleaned = text.trim();

  // Find first sentence ending (., !, ?)
  // Be careful with abbreviations and decimals
  const sentenceEndRegex = /[.!?](?:\s|$)/;
  const match = cleaned.match(sentenceEndRegex);

  if (match && match.index !== undefined) {
    const firstSentence = cleaned.substring(0, match.index + 1).trim();
    // If first sentence is under 200 chars, use it
    if (firstSentence.length <= 200) {
      return firstSentence;
    }
  }

  // Otherwise, take first 200 characters
  if (cleaned.length <= 200) {
    return cleaned;
  }

  // Try to break at word boundary
  const truncated = cleaned.substring(0, 200);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 150) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Estimates token count for a text string
 * Uses rough approximation: ~4 characters per token for English text
 *
 * @param text - The text to estimate
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough approximation: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Splits text into chunks without breaking sentences or paragraphs
 * Used when a section is too large and needs to be split
 *
 * @param text - The text to split
 * @param maxTokens - Maximum tokens per chunk (default 500)
 * @param minTokens - Minimum tokens per chunk (default 200)
 * @returns Array of text chunks
 */
export function splitTextIntoChunks(
  text: string,
  maxTokens: number = 500,
  minTokens: number = 200
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) {
    return [text.trim()];
  }

  const chunks: string[] = [];

  // First try splitting by paragraphs (double newline)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);
    const currentTokens = estimateTokens(currentChunk);

    // If adding this paragraph exceeds max and we have enough content
    if (currentTokens + paragraphTokens > maxTokens && currentTokens >= minTokens) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    }
    // If single paragraph is too large, split by sentences
    else if (paragraphTokens > maxTokens) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      const sentenceChunks = splitBySentences(paragraph, maxTokens, minTokens);
      chunks.push(...sentenceChunks);
    }
    else {
      currentChunk = currentChunk
        ? currentChunk + '\n\n' + paragraph
        : paragraph;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Splits text by sentences when paragraph splitting isn't granular enough
 */
function splitBySentences(
  text: string,
  maxTokens: number,
  minTokens: number
): string[] {
  const chunks: string[] = [];

  // Split by sentence endings
  const sentences = text.split(/(?<=[.!?])\s+/);

  let currentChunk = '';

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    const currentTokens = estimateTokens(currentChunk);

    if (currentTokens + sentenceTokens > maxTokens && currentTokens >= minTokens) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = currentChunk
        ? currentChunk + ' ' + sentence
        : sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Cleans text by normalizing whitespace and removing control characters
 *
 * @param text - The text to clean
 * @returns Cleaned text
 */
export function cleanText(text: string): string {
  if (!text) return '';

  return text
    // Remove control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize multiple spaces to single
    .replace(/[ \t]+/g, ' ')
    // Normalize multiple newlines to double (paragraph break)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Detects if text appears to be a table based on structure
 *
 * @param text - The text to analyze
 * @returns True if text appears to be tabular
 */
export function isTableLike(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim());

  if (lines.length < 2) return false;

  // Check for consistent delimiters (|, \t, multiple spaces)
  const hasConsistentPipes = lines.every(l => (l.match(/\|/g) || []).length >= 2);
  const hasConsistentTabs = lines.every(l => l.includes('\t'));
  const hasConsistentSpacing = lines.every(l => (l.match(/\s{2,}/g) || []).length >= 2);

  return hasConsistentPipes || hasConsistentTabs || hasConsistentSpacing;
}

/**
 * Formats a table for human-readable text output
 *
 * @param rows - 2D array of table data
 * @param headers - Optional header row
 * @returns Formatted table string
 */
export function formatTable(rows: string[][], headers?: string[]): string {
  if (!rows || rows.length === 0) return '';

  const allRows = headers ? [headers, ...rows] : rows;

  // Calculate column widths
  const colCount = Math.max(...allRows.map(r => r.length));
  const colWidths: number[] = [];

  for (let i = 0; i < colCount; i++) {
    colWidths[i] = Math.max(...allRows.map(r => (r[i] || '').length));
  }

  // Format rows
  const formatted = allRows.map(row => {
    return row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join(' | ');
  });

  // Add separator after header
  if (headers) {
    const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');
    formatted.splice(1, 0, separator);
  }

  return formatted.join('\n');
}
