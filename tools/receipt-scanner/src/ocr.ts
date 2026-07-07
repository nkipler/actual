import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { Mistral } from '@mistralai/mistralai';

import { config } from './config.ts';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

function mimeType(path: string): string {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) {
    throw new Error(
      `Unsupported file type: ${path}. ` +
        `Supported: ${Object.keys(MIME_BY_EXT).join(', ')}`,
    );
  }
  return mime;
}

/**
 * Run a local image or PDF through Mistral OCR and return the extracted text
 * as Markdown (all pages concatenated).
 */
export async function ocrFile(path: string): Promise<string> {
  const mime = mimeType(path);
  const isPdf = mime === 'application/pdf';
  const base64 = (await readFile(path)).toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  const client = new Mistral({ apiKey: config.mistral.apiKey });

  const response = await client.ocr.process({
    model: config.mistral.ocrModel,
    document: isPdf
      ? { type: 'document_url', documentUrl: dataUrl }
      : { type: 'image_url', imageUrl: dataUrl },
  });

  const markdown = response.pages
    .map(page => page.markdown)
    .join('\n\n')
    .trim();

  if (!markdown) {
    throw new Error(`OCR returned no text for ${path}`);
  }
  return markdown;
}
