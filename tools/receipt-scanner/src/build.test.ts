import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTransaction } from './build.ts';
import type { ReceiptData } from './types.ts';

function receipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    merchant: 'Carrefour',
    date: '2026-01-15',
    currency: 'EUR',
    total: 10,
    items: [
      { description: 'Milk', quantity: 1, amount: 4, category: 'Groceries' },
      { description: 'Soap', quantity: 1, amount: 6, category: 'Household' },
    ],
    ...overrides,
  };
}

test('parent amount is the negative total in integer cents', () => {
  const tx = buildTransaction(receipt());
  assert.equal(tx.amount, -1000);
  assert.equal(tx.payee_name, 'Carrefour');
  assert.equal(tx.date, '2026-01-15');
  assert.equal(tx.cleared, true);
});

test('splits sum exactly to the parent amount', () => {
  const tx = buildTransaction(receipt());
  const sum = (tx.subtransactions ?? []).reduce((s, t) => s + t.amount, 0);
  assert.equal(sum, tx.amount);
});

test('groups line items sharing a category into one split', () => {
  const tx = buildTransaction(
    receipt({
      items: [
        { description: 'Milk', quantity: 1, amount: 4, category: 'Groceries' },
        { description: 'Bread', quantity: 1, amount: 2, category: 'Groceries' },
        { description: 'Soap', quantity: 1, amount: 4, category: 'Household' },
      ],
    }),
  );
  assert.equal(tx.subtransactions?.length, 2);
  const groceries = tx.subtransactions?.find(s => s.category === 'Groceries');
  assert.equal(groceries?.amount, -600);
});

test('keeps one split per item when grouping is disabled', () => {
  const tx = buildTransaction(
    receipt({
      total: 6,
      items: [
        { description: 'Milk', quantity: 1, amount: 4, category: 'Groceries' },
        { description: 'Bread', quantity: 1, amount: 2, category: 'Groceries' },
      ],
    }),
    { groupByCategory: false },
  );
  assert.equal(tx.subtransactions?.length, 2);
});

test('adds a balancing split when items do not sum to the total', () => {
  // Items total 8.50 but the receipt says 10.00 (tax/discount not itemized).
  const tx = buildTransaction(
    receipt({
      total: 10,
      items: [
        { description: 'Milk', quantity: 1, amount: 4, category: 'Groceries' },
        { description: 'Soap', quantity: 1, amount: 4.5, category: 'Household' },
      ],
    }),
  );
  const balancing = tx.subtransactions?.find(
    s => s.notes === 'Taxes / rounding / discount',
  );
  assert.ok(balancing, 'expected a balancing split');
  assert.equal(balancing?.amount, -150);
  const sum = (tx.subtransactions ?? []).reduce((s, t) => s + t.amount, 0);
  assert.equal(sum, -1000);
});

test('no balancing split when items already sum to the total', () => {
  const tx = buildTransaction(receipt());
  const balancing = tx.subtransactions?.find(
    s => s.notes === 'Taxes / rounding / discount',
  );
  assert.equal(balancing, undefined);
});

test('rounds fractional cents and still balances via the balancing split', () => {
  // 3 x 3.33 = 9.99 rounded per item, but total is 10.00.
  const tx = buildTransaction(
    receipt({
      total: 10,
      items: [
        { description: 'A', quantity: 1, amount: 3.33, category: 'Groceries' },
        { description: 'B', quantity: 1, amount: 3.33, category: 'Groceries' },
        { description: 'C', quantity: 1, amount: 3.33, category: 'Groceries' },
      ],
    }),
  );
  const sum = (tx.subtransactions ?? []).reduce((s, t) => s + t.amount, 0);
  assert.equal(sum, -1000);
});

test('uncategorized items leave the split category undefined', () => {
  const tx = buildTransaction(
    receipt({
      items: [{ description: 'Mystery', quantity: 1, amount: 10, category: null }],
    }),
  );
  assert.equal(tx.subtransactions?.length, 1);
  assert.equal(tx.subtransactions?.[0]?.category, undefined);
});

test('empty items produce a single balancing split equal to the total', () => {
  const tx = buildTransaction(receipt({ total: 10, items: [] }));
  assert.equal(tx.subtransactions?.length, 1);
  assert.equal(tx.subtransactions?.[0]?.amount, -1000);
});

test('imported_id is stable for the same receipt but differs by total', () => {
  const a = buildTransaction(receipt({ total: 10 }));
  const b = buildTransaction(receipt({ total: 10 }));
  const c = buildTransaction(receipt({ total: 12 }));
  assert.equal(a.imported_id, b.imported_id);
  assert.notEqual(a.imported_id, c.imported_id);
  assert.match(a.imported_id ?? '', /^receipt-[0-9a-f]{16}$/);
});

test('quantity greater than one is noted on the split', () => {
  const tx = buildTransaction(
    receipt({
      items: [{ description: 'Water', quantity: 6, amount: 3, category: 'Groceries' }],
    }),
    { groupByCategory: false },
  );
  assert.equal(tx.subtransactions?.[0]?.notes, '6× Water');
});
