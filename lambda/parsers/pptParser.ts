import * as fs from 'fs';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import { ParsedBlock, ParseResult } from '../types';

const parseXml = promisify(parseString);

/**
 * PPT/PPTX Parser - Parses PowerPoint files
 *
 * Heading detection strategy:
 * - Slide titles are top-level headings
 * - First text box on slide is typically the title
 *
 * Special handling:
 * - Each slide processed separately
 * - Tables extracted from slide content
 * - Speaker notes included in metadata
 */
export async function parsePpt(filePath: string): Promise<ParseResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.ppt') {
    // Old binary format - limited support
    return parsePptBinary(filePath);
  }

  // PPTX format (Office Open XML)
  return parsePptx(filePath);
}

/**
 * Parses PPTX (Office Open XML) files
 */
async function parsePptx(filePath: string): Promise<ParseResult> {
  const blocks: ParsedBlock[] = [];
  const metadata: Record<string, any> = {};

  // Read the PPTX file (which is a ZIP archive)
  const directory = await unzipper.Open.file(filePath);

  // Find all slide files
  const slideFiles = directory.files
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f.path))
    .sort((a, b) => {
      const numA = parseInt(a.path.match(/slide(\d+)\.xml/)?.[1] || '0');
      const numB = parseInt(b.path.match(/slide(\d+)\.xml/)?.[1] || '0');
      return numA - numB;
    });

  metadata.slideCount = slideFiles.length;

  // Process each slide
  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i];
    const slideNumber = i + 1;

    const content = await slideFile.buffer();
    const xml = content.toString('utf-8');
    const slideData = await parseXml(xml);

    const slideBlocks = parseSlide(slideData, slideNumber);
    blocks.push(...slideBlocks);

    // Try to find speaker notes
    const notesPath = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
    const notesFile = directory.files.find(f => f.path === notesPath);
    if (notesFile) {
      const notesContent = await notesFile.buffer();
      const notesXml = notesContent.toString('utf-8');
      const notesData = await parseXml(notesXml);
      const notes = extractSpeakerNotes(notesData);
      if (notes) {
        // Add notes to last block's metadata
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock) {
          lastBlock.metadata = lastBlock.metadata || {};
          lastBlock.metadata.speakerNotes = notes;
        }
      }
    }
  }

  return {
    blocks,
    metadata
  };
}

/**
 * Parses a single slide into blocks
 */
function parseSlide(slideData: any, slideNumber: number): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  try {
    // Navigate to the shape tree
    const sld = slideData['p:sld'];
    if (!sld) return blocks;

    const cSld = sld['p:cSld']?.[0];
    if (!cSld) return blocks;

    const spTree = cSld['p:spTree']?.[0];
    if (!spTree) return blocks;

    // Find all shapes with text
    const shapes = spTree['p:sp'] || [];
    let slideTitle = '';
    const textBlocks: string[] = [];
    const tables: string[] = [];

    for (const shape of shapes) {
      const nvSpPr = shape['p:nvSpPr']?.[0];
      const txBody = shape['p:txBody']?.[0];

      if (!txBody) continue;

      // Check if this is a title placeholder
      const isTitle = nvSpPr?.['p:nvPr']?.[0]?.['p:ph']?.[0]?.$?.type === 'title' ||
        nvSpPr?.['p:nvPr']?.[0]?.['p:ph']?.[0]?.$?.type === 'ctrTitle';

      // Extract text from paragraphs
      const text = extractTextFromTxBody(txBody);

      if (isTitle && text && !slideTitle) {
        slideTitle = text;
      } else if (text) {
        textBlocks.push(text);
      }
    }

    // Check for tables
    const graphicFrames = spTree['p:graphicFrame'] || [];
    for (const frame of graphicFrames) {
      const table = extractTable(frame);
      if (table) {
        tables.push(table);
      }
    }

    // Create blocks
    if (slideTitle) {
      blocks.push({
        type: 'heading',
        content: slideTitle,
        level: 1,
        slideNumber
      });
    } else {
      blocks.push({
        type: 'heading',
        content: `Slide ${slideNumber}`,
        level: 1,
        slideNumber
      });
    }

    // Add text content
    for (const text of textBlocks) {
      if (text.trim()) {
        // Check if it looks like a list
        const lines = text.split('\n').filter(l => l.trim());
        const isList = lines.length > 1 && lines.every(l =>
          /^\s*[-•*]\s/.test(l) || /^\s*\d+[.)]\s/.test(l)
        );

        blocks.push({
          type: isList ? 'list' : 'paragraph',
          content: text,
          slideNumber
        });
      }
    }

    // Add tables
    for (const table of tables) {
      blocks.push({
        type: 'table',
        content: table,
        isTable: true,
        slideNumber
      });
    }

  } catch (error) {
    // Log but don't fail
    console.error(`Error parsing slide ${slideNumber}:`, error);
  }

  return blocks;
}

/**
 * Extracts text from a txBody element
 */
function extractTextFromTxBody(txBody: any): string {
  const paragraphs: string[] = [];

  const aPs = txBody['a:p'] || [];
  for (const p of aPs) {
    let paraText = '';

    const aRs = p['a:r'] || [];
    for (const r of aRs) {
      const text = r['a:t']?.[0];
      if (typeof text === 'string') {
        paraText += text;
      } else if (text?._) {
        paraText += text._;
      }
    }

    // Check for bullet/numbering
    const pPr = p['a:pPr']?.[0];
    if (pPr?.['a:buChar'] || pPr?.['a:buAutoNum']) {
      paraText = '• ' + paraText;
    }

    if (paraText.trim()) {
      paragraphs.push(paraText);
    }
  }

  return paragraphs.join('\n');
}

/**
 * Extracts table content from a graphic frame
 */
function extractTable(frame: any): string | null {
  try {
    const graphic = frame['a:graphic']?.[0];
    const graphicData = graphic?.['a:graphicData']?.[0];
    const tbl = graphicData?.['a:tbl']?.[0];

    if (!tbl) return null;

    const rows: string[][] = [];
    const trs = tbl['a:tr'] || [];

    for (const tr of trs) {
      const cells: string[] = [];
      const tcs = tr['a:tc'] || [];

      for (const tc of tcs) {
        const txBody = tc['a:txBody']?.[0];
        const text = txBody ? extractTextFromTxBody(txBody) : '';
        cells.push(text.replace(/\n/g, ' ').trim());
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) return null;

    // Format as text table
    const colCount = Math.max(...rows.map(r => r.length));
    const colWidths: number[] = [];

    for (let c = 0; c < colCount; c++) {
      colWidths[c] = Math.max(
        ...rows.map(r => (r[c] || '').length),
        3
      );
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
  } catch {
    return null;
  }
}

/**
 * Extracts speaker notes from notes slide
 */
function extractSpeakerNotes(notesData: any): string | null {
  try {
    const notes = notesData['p:notes'];
    const cSld = notes?.['p:cSld']?.[0];
    const spTree = cSld?.['p:spTree']?.[0];
    const shapes = spTree?.['p:sp'] || [];

    for (const shape of shapes) {
      const nvSpPr = shape['p:nvSpPr']?.[0];
      const phType = nvSpPr?.['p:nvPr']?.[0]?.['p:ph']?.[0]?.$?.type;

      if (phType === 'body') {
        const txBody = shape['p:txBody']?.[0];
        if (txBody) {
          return extractTextFromTxBody(txBody);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Parses old binary PPT format (limited support)
 */
async function parsePptBinary(filePath: string): Promise<ParseResult> {
  // Binary PPT format is complex - provide basic support
  const blocks: ParsedBlock[] = [];

  blocks.push({
    type: 'paragraph',
    content: `[Binary PPT format detected. For full parsing support, please convert to PPTX format.]`
  });

  return {
    blocks,
    metadata: {
      format: 'binary',
      note: 'Binary PPT format has limited parsing support'
    }
  };
}
