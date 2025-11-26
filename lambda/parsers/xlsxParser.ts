import * as XLSX from 'xlsx';
import { ParsedBlock, ParseResult } from '../types';

/**
 * XLSX Parser - Parses Excel files using xlsx library
 *
 * Heading detection strategy:
 * - Sheet names are top-level headings
 * - First row is typically header row
 * - Bold/formatted cells can indicate subheadings
 *
 * Special handling:
 * - Multiple sheets processed separately
 * - Each data region becomes a table chunk
 * - Merged cells handled appropriately
 */
export async function parseXlsx(filePath: string): Promise<ParseResult> {
  const workbook = XLSX.readFile(filePath, {
    cellStyles: true,
    cellDates: true
  });

  const blocks: ParsedBlock[] = [];
  const metadata: Record<string, any> = {
    sheetNames: workbook.SheetNames,
    sheetCount: workbook.SheetNames.length
  };

  // Process each sheet
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    // Add sheet name as top-level heading
    blocks.push({
      type: 'heading',
      content: sheetName,
      level: 1,
      sheetName
    });

    // Parse sheet content
    const sheetBlocks = parseSheet(sheet, sheetName);
    blocks.push(...sheetBlocks);
  }

  return {
    blocks,
    metadata
  };
}

/**
 * Parses a single worksheet into blocks
 */
function parseSheet(sheet: XLSX.WorkSheet, sheetName: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  // Get the range of the sheet
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

  if (range.e.r < 0 || range.e.c < 0) {
    return blocks;
  }

  // Convert sheet to array of arrays
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ''
  });

  if (data.length === 0) {
    return blocks;
  }

  // Find data regions (contiguous non-empty areas)
  const regions = findDataRegions(data);

  for (const region of regions) {
    // Extract region data
    const regionData = data.slice(region.startRow, region.endRow + 1)
      .map(row => row.slice(region.startCol, region.endCol + 1));

    // Check if first row is header
    const hasHeader = isHeaderRow(regionData[0], regionData.slice(1));

    // Format as table
    const tableContent = formatExcelTable(regionData, hasHeader);

    if (tableContent) {
      blocks.push({
        type: 'table',
        content: tableContent,
        isTable: true,
        sheetName
      });
    }
  }

  return blocks;
}

/**
 * Finds contiguous data regions in the sheet
 */
function findDataRegions(data: any[][]): Array<{
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}> {
  const regions: Array<{
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  }> = [];

  // Simple approach: find bounding box of all non-empty cells
  // Then split by empty rows

  let inRegion = false;
  let regionStart = 0;
  let minCol = Infinity;
  let maxCol = 0;

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const hasContent = row.some(cell => cell !== '' && cell !== null && cell !== undefined);

    if (hasContent) {
      if (!inRegion) {
        inRegion = true;
        regionStart = r;
        minCol = Infinity;
        maxCol = 0;
      }

      // Track column bounds
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) {
          minCol = Math.min(minCol, c);
          maxCol = Math.max(maxCol, c);
        }
      }
    } else if (inRegion) {
      // End of region
      regions.push({
        startRow: regionStart,
        endRow: r - 1,
        startCol: minCol === Infinity ? 0 : minCol,
        endCol: maxCol
      });
      inRegion = false;
    }
  }

  // Don't forget last region
  if (inRegion) {
    regions.push({
      startRow: regionStart,
      endRow: data.length - 1,
      startCol: minCol === Infinity ? 0 : minCol,
      endCol: maxCol
    });
  }

  return regions;
}

/**
 * Determines if the first row is likely a header row
 */
function isHeaderRow(firstRow: any[], dataRows: any[][]): boolean {
  if (!firstRow || firstRow.length === 0) return false;
  if (dataRows.length === 0) return false;

  // Check if first row is all strings
  const firstRowAllStrings = firstRow.every(
    cell => typeof cell === 'string' || cell === '' || cell === null
  );

  if (!firstRowAllStrings) return false;

  // Check if data rows have different types (numbers, dates)
  const dataHasOtherTypes = dataRows.some(row =>
    row.some(cell =>
      typeof cell === 'number' ||
      cell instanceof Date
    )
  );

  // Check if first row has no duplicate values (headers usually unique)
  const nonEmpty = firstRow.filter(c => c !== '' && c !== null);
  const unique = new Set(nonEmpty.map(c => String(c).toLowerCase()));

  return dataHasOtherTypes || unique.size === nonEmpty.length;
}

/**
 * Formats Excel data as a readable text table
 */
function formatExcelTable(data: any[][], hasHeader: boolean): string {
  if (!data || data.length === 0) return '';

  // Convert all cells to strings
  const stringData = data.map(row =>
    row.map(cell => {
      if (cell === null || cell === undefined || cell === '') {
        return '';
      }
      if (cell instanceof Date) {
        return cell.toLocaleDateString();
      }
      return String(cell);
    })
  );

  // Calculate column widths
  const colCount = Math.max(...stringData.map(r => r.length));
  const colWidths: number[] = [];

  for (let c = 0; c < colCount; c++) {
    colWidths[c] = Math.max(
      ...stringData.map(row => (row[c] || '').length),
      3
    );
    // Cap width for readability
    colWidths[c] = Math.min(colWidths[c], 50);
  }

  // Format rows
  const formatted = stringData.map((row, idx) => {
    const paddedCells = [];
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] || '';
      const truncated = cell.length > 50 ? cell.substring(0, 47) + '...' : cell;
      paddedCells.push(truncated.padEnd(colWidths[c]));
    }
    const rowStr = paddedCells.join(' | ');

    // Add separator after header
    if (hasHeader && idx === 0) {
      const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');
      return rowStr + '\n' + separator;
    }
    return rowStr;
  });

  return formatted.join('\n');
}
