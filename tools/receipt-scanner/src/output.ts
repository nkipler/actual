import { writeFile } from 'node:fs/promises';

import type { ActualImportTransaction, ReceiptData } from './types.ts';

export async function writeJson(
  path: string,
  transactions: ActualImportTransaction[],
): Promise<void> {
  await writeFile(path, JSON.stringify(transactions, null, 2) + '\n');
}

function csvCell(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Flat CSV of every line item across all receipts. Handy for a manual review,
 * but note that importing this into Actual would recreate the "one row per
 * split" problem — use the JSON / direct import for real splits.
 */
export async function writeCsv(
  path: string,
  receipts: ReceiptData[],
): Promise<void> {
  const header = [
    'date',
    'merchant',
    'description',
    'quantity',
    'amount',
    'currency',
    'category',
  ];
  const rows = receipts.flatMap(receipt =>
    receipt.items.map(item =>
      [
        receipt.date,
        receipt.merchant,
        item.description,
        item.quantity,
        item.amount.toFixed(2),
        receipt.currency,
        item.category ?? '',
      ]
        .map(csvCell)
        .join(','),
    ),
  );
  await writeFile(path, [header.join(','), ...rows].join('\n') + '\n');
}
