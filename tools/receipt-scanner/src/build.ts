import { createHash } from 'node:crypto';

import type { ActualImportTransaction, ReceiptData } from './types.ts';

/** Convert a positive currency amount to negative integer cents (an expense). */
function toExpenseCents(amount: number): number {
  return -Math.round(amount * 100);
}

/** Stable id so re-importing the same receipt does not create duplicates. */
function importedId(receipt: ReceiptData): string {
  const seed = `${receipt.merchant}|${receipt.date}|${receipt.total}`;
  return `receipt-${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

export type BuildOptions = {
  /** Group line items sharing a category into a single split. Default true. */
  groupByCategory?: boolean;
};

/**
 * Turn a parsed receipt into a single Actual transaction whose splits add up to
 * the receipt total. Subtransaction `category` fields hold category *names*;
 * resolve them to ids at import time.
 *
 * A balancing split is appended when the line items do not sum to the printed
 * total (tax, rounding, discounts, or items OCR missed), so the parent amount
 * always matches what was actually paid.
 */
export function buildTransaction(
  receipt: ReceiptData,
  { groupByCategory = true }: BuildOptions = {},
): ActualImportTransaction {
  const totalCents = toExpenseCents(receipt.total);

  let splits = receipt.items.map(item => ({
    amount: toExpenseCents(item.amount),
    category: item.category ?? undefined,
    notes:
      item.quantity && item.quantity !== 1
        ? `${item.quantity}× ${item.description}`
        : item.description,
  }));

  if (groupByCategory) {
    const byCategory = new Map<string, { amount: number; notes: string[] }>();
    for (const split of splits) {
      const key = split.category ?? '';
      const entry = byCategory.get(key) ?? { amount: 0, notes: [] };
      entry.amount += split.amount;
      entry.notes.push(split.notes);
      byCategory.set(key, entry);
    }
    splits = [...byCategory.entries()].map(([category, entry]) => ({
      amount: entry.amount,
      category: category || undefined,
      notes: entry.notes.join(', '),
    }));
  }

  const splitSum = splits.reduce((sum, split) => sum + split.amount, 0);
  const difference = totalCents - splitSum;
  if (difference !== 0) {
    splits.push({
      amount: difference,
      category: undefined,
      notes: 'Taxes / rounding / discount',
    });
  }

  return {
    date: receipt.date,
    amount: totalCents,
    payee_name: receipt.merchant,
    notes: `Receipt — ${receipt.currency} ${receipt.total.toFixed(2)}`,
    imported_id: importedId(receipt),
    cleared: true,
    subtransactions: splits,
  };
}
