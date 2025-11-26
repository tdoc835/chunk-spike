import * as fs from 'fs';
import * as path from 'path';
import { simpleParser, ParsedMail } from 'mailparser';
import MsgReader from '@kenjiuno/msgreader';
import { ParsedBlock, ParseResult } from '../types';

/**
 * EML/MSG Parser - Parses email files
 *
 * Heading detection strategy:
 * - Subject line is top-level heading
 * - Email headers (From, To, Date) preserved as metadata
 *
 * Special handling:
 * - Both plain text and HTML body versions
 * - Quoted reply detection
 * - Attachment listing (not content parsing)
 */
export async function parseEml(filePath: string): Promise<ParseResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.msg') {
    return parseMsgFile(filePath);
  }

  // EML format
  return parseEmlFile(filePath);
}

/**
 * Parses EML (RFC 822) email files
 */
async function parseEmlFile(filePath: string): Promise<ParseResult> {
  const content = fs.readFileSync(filePath);
  const parsed = await simpleParser(content);

  return processEmail(parsed);
}

/**
 * Parses MSG (Outlook) email files
 */
async function parseMsgFile(filePath: string): Promise<ParseResult> {
  const fileBuffer = fs.readFileSync(filePath);
  // Convert Buffer to ArrayBuffer for MsgReader
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  const msgReader = new MsgReader(arrayBuffer as ArrayBuffer);
  const msgData = msgReader.getFileData();

  // Convert MSG format to our common structure
  const blocks: ParsedBlock[] = [];
  const metadata: Record<string, any> = {};

  // Extract headers
  const subject = msgData.subject || 'No Subject';
  const from = msgData.senderEmail || msgData.senderName || '';
  const to = msgData.recipients?.map((r: any) => r.email || r.name).join(', ') || '';
  const date = msgData.creationTime || msgData.messageDeliveryTime;

  metadata.from = from;
  metadata.to = to;
  metadata.subject = subject;
  if (date) {
    metadata.date = new Date(date).toISOString();
  }

  // Add subject as heading
  blocks.push({
    type: 'heading',
    content: subject,
    level: 1
  });

  // Add email headers as a block
  const headerLines = [];
  if (from) headerLines.push(`From: ${from}`);
  if (to) headerLines.push(`To: ${to}`);
  if (date) headerLines.push(`Date: ${new Date(date).toLocaleString()}`);

  if (headerLines.length > 0) {
    blocks.push({
      type: 'email-header',
      content: headerLines.join('\n'),
      metadata: { ...metadata }
    });
  }

  // Parse body
  const body = msgData.body || '';
  if (body) {
    const bodyBlocks = parseEmailBody(body);
    blocks.push(...bodyBlocks);
  }

  // List attachments
  const attachments = msgData.attachments || [];
  if (attachments.length > 0) {
    const attachmentList = attachments.map((a: any) =>
      `• ${a.fileName || a.name || 'Unnamed attachment'}`
    ).join('\n');

    blocks.push({
      type: 'attachment-list',
      content: `Attachments:\n${attachmentList}`,
      metadata: {
        attachmentCount: attachments.length,
        attachments: attachments.map((a: any) => ({
          name: a.fileName || a.name,
          size: a.content?.length
        }))
      }
    });
  }

  return {
    blocks,
    metadata
  };
}

/**
 * Processes parsed email into blocks
 */
function processEmail(parsed: ParsedMail): ParseResult {
  const blocks: ParsedBlock[] = [];
  const metadata: Record<string, any> = {};

  // Extract headers
  const subject = parsed.subject || 'No Subject';
  const from = formatAddress(parsed.from);
  const to = formatAddressList(parsed.to);
  const cc = formatAddressList(parsed.cc);
  const date = parsed.date;

  metadata.from = from;
  metadata.to = to;
  if (cc) metadata.cc = cc;
  metadata.subject = subject;
  if (date) {
    metadata.date = date.toISOString();
  }
  if (parsed.messageId) {
    metadata.messageId = parsed.messageId;
  }

  // Add subject as heading
  blocks.push({
    type: 'heading',
    content: subject,
    level: 1
  });

  // Add email headers as a block
  const headerLines = [];
  if (from) headerLines.push(`From: ${from}`);
  if (to) headerLines.push(`To: ${to}`);
  if (cc) headerLines.push(`CC: ${cc}`);
  if (date) headerLines.push(`Date: ${date.toLocaleString()}`);

  if (headerLines.length > 0) {
    blocks.push({
      type: 'email-header',
      content: headerLines.join('\n'),
      metadata: { ...metadata }
    });
  }

  // Parse body
  // Prefer plain text, fall back to HTML
  let bodyContent = parsed.text || '';

  if (!bodyContent && parsed.html) {
    // Strip HTML tags for basic text
    bodyContent = stripHtml(parsed.html);
  }

  if (bodyContent) {
    const bodyBlocks = parseEmailBody(bodyContent);
    blocks.push(...bodyBlocks);
  }

  // List attachments
  if (parsed.attachments && parsed.attachments.length > 0) {
    const attachmentList = parsed.attachments.map(a =>
      `• ${a.filename || 'Unnamed attachment'} (${formatSize(a.size)})`
    ).join('\n');

    blocks.push({
      type: 'attachment-list',
      content: `Attachments:\n${attachmentList}`,
      metadata: {
        attachmentCount: parsed.attachments.length,
        attachments: parsed.attachments.map(a => ({
          name: a.filename,
          size: a.size,
          contentType: a.contentType
        }))
      }
    });
  }

  return {
    blocks,
    metadata
  };
}

/**
 * Parses email body into blocks, handling quoted replies
 */
function parseEmailBody(body: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  // Split by quoted reply markers
  const parts = splitByQuotes(body);

  for (const part of parts) {
    if (part.isQuote) {
      // Quoted content
      blocks.push({
        type: 'paragraph',
        content: part.content,
        metadata: { isQuotedReply: true }
      });
    } else {
      // Regular content - split by paragraphs
      const paragraphs = part.content.split(/\n\s*\n/).filter(p => p.trim());

      for (const para of paragraphs) {
        const trimmed = para.trim();

        // Check if it looks like a signature
        if (isSignature(trimmed)) {
          blocks.push({
            type: 'paragraph',
            content: trimmed,
            metadata: { isSignature: true }
          });
        } else {
          blocks.push({
            type: 'paragraph',
            content: trimmed
          });
        }
      }
    }
  }

  return blocks;
}

/**
 * Splits email body by quoted reply sections
 */
function splitByQuotes(body: string): Array<{ content: string; isQuote: boolean }> {
  const parts: Array<{ content: string; isQuote: boolean }> = [];
  const lines = body.split('\n');

  let currentContent: string[] = [];
  let inQuote = false;

  for (const line of lines) {
    const isQuoteLine = /^>+\s?/.test(line) ||
      /^On .+ wrote:$/.test(line.trim()) ||
      /^-{3,} ?Original Message ?-{3,}/.test(line) ||
      /^From:.*Sent:.*To:/s.test(line);

    if (isQuoteLine !== inQuote) {
      // Transition
      if (currentContent.length > 0) {
        parts.push({
          content: currentContent.join('\n').trim(),
          isQuote: inQuote
        });
      }
      currentContent = [line];
      inQuote = isQuoteLine;
    } else {
      currentContent.push(line);
    }
  }

  // Last part
  if (currentContent.length > 0) {
    parts.push({
      content: currentContent.join('\n').trim(),
      isQuote: inQuote
    });
  }

  return parts.filter(p => p.content);
}

/**
 * Checks if text appears to be an email signature
 */
function isSignature(text: string): boolean {
  // Common signature markers
  const markers = [
    /^--\s*$/m,
    /^Regards,?\s*$/im,
    /^Best,?\s*$/im,
    /^Thanks,?\s*$/im,
    /^Sincerely,?\s*$/im,
    /^Sent from my/im
  ];

  return markers.some(m => m.test(text));
}

/**
 * Formats email address object(s)
 */
function formatAddress(addr: any): string {
  if (!addr) return '';

  if (addr.value && Array.isArray(addr.value)) {
    return addr.value.map((a: any) =>
      a.name ? `${a.name} <${a.address}>` : a.address
    ).join(', ');
  }

  if (addr.text) return addr.text;

  return String(addr);
}

/**
 * Formats list of email addresses
 */
function formatAddressList(addrs: any): string {
  if (!addrs) return '';

  if (Array.isArray(addrs)) {
    return addrs.map(formatAddress).join(', ');
  }

  return formatAddress(addrs);
}

/**
 * Strips HTML tags from content
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Formats file size for display
 */
function formatSize(bytes: number): string {
  if (!bytes) return 'unknown size';

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
