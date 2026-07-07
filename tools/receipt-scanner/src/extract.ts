import { Mistral } from '@mistralai/mistralai';

import { config } from './config.ts';
import type { ReceiptData } from './types.ts';

const JSON_SHAPE = `{
  "merchant": string,           // store / payee name
  "date": string,               // purchase date, YYYY-MM-DD
  "currency": string,           // ISO 4217 code, e.g. "EUR"
  "total": number,              // grand total actually paid, positive
  "items": [
    {
      "description": string,
      "quantity": number,       // 1 when not shown
      "amount": number,         // line total, positive
      "category": string | null // best matching category name, or null
    }
  ]
}`;

function buildPrompt(markdown: string, categories: string[]): string {
  const categoryGuidance =
    categories.length > 0
      ? `For every item, set "category" to the single best match from this list ` +
        `of the user's Actual Budget categories (use the exact spelling, or null ` +
        `if nothing fits):\n${categories.map(c => `- ${c}`).join('\n')}`
      : `Set "category" to a short, sensible expense category name, or null.`;

  return [
    'You are extracting structured data from a store receipt.',
    'The receipt text below was produced by OCR and may contain noise.',
    'Rules:',
    '- Amounts are positive numbers in the receipt currency.',
    '- "total" is the final amount paid (after discounts, including tax).',
    '- Only include real purchased line items; ignore subtotals, tax lines,',
    '  loyalty points, change due, and payment method lines.',
    '- If a quantity is not shown, use 1.',
    '- Guess the date if it is ambiguous; never invent items.',
    categoryGuidance,
    '',
    'Respond with ONLY a JSON object of exactly this shape (no markdown fence):',
    JSON_SHAPE,
    '',
    'Receipt text:',
    '"""',
    markdown,
    '"""',
  ].join('\n');
}

/**
 * Turn OCR markdown into structured {@link ReceiptData}. When `categories` is
 * provided, the model is constrained to pick category names from that list.
 */
export async function extractReceipt(
  markdown: string,
  categories: string[] = [],
): Promise<ReceiptData> {
  const client = new Mistral({ apiKey: config.mistral.apiKey });

  const response = await client.chat.complete({
    model: config.mistral.textModel,
    temperature: 0,
    messages: [{ role: 'user', content: buildPrompt(markdown, categories) }],
    responseFormat: { type: 'json_object' },
  });

  const content = response.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : '';
  if (!text.trim()) {
    throw new Error('Extraction model returned an empty response');
  }

  // Be tolerant of a stray ```json fence around the object.
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const data = JSON.parse(json) as ReceiptData;
  data.items = (data.items ?? []).filter(item => item.amount > 0);
  return data;
}
