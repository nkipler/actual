#!/usr/bin/env -S npx tsx
import { Command } from 'commander';

import {
  connect,
  disconnect,
  getCategoryNames,
  importReceiptTransaction,
  resolveAccountId,
} from './actual.ts';
import { buildTransaction } from './build.ts';
import { extractReceipt } from './extract.ts';
import { ocrFile } from './ocr.ts';
import { writeCsv, writeJson } from './output.ts';
import type {
  ActualImportTransaction,
  ReceiptData,
} from './types.ts';

type CliOptions = {
  account?: string;
  import: boolean;
  json?: string;
  csv?: string;
  group: boolean;
  dryRun: boolean;
};

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function printReceipt(
  receipt: ReceiptData,
  tx: ActualImportTransaction,
): void {
  console.log(`\n🧾 ${receipt.merchant} — ${receipt.date}`);
  console.log(`   Total: ${receipt.currency} ${receipt.total.toFixed(2)}`);
  for (const split of tx.subtransactions ?? []) {
    const category = split.category ?? '(uncategorized)';
    console.log(
      `   • ${formatCents(split.amount).padStart(9)}  ${category} — ${split.notes ?? ''}`,
    );
  }
}

async function run(files: string[], options: CliOptions): Promise<void> {
  const needActual = options.import;
  let categories: string[] = [];

  if (needActual) {
    console.log('Connecting to Actual…');
    await connect();
    categories = await getCategoryNames();
  }

  const receipts: ReceiptData[] = [];
  const transactions: ActualImportTransaction[] = [];

  for (const file of files) {
    console.log(`\nScanning ${file}…`);
    const markdown = await ocrFile(file);
    const receipt = await extractReceipt(markdown, categories);
    const tx = buildTransaction(receipt, { groupByCategory: options.group });
    receipts.push(receipt);
    transactions.push(tx);
    printReceipt(receipt, tx);
  }

  if (options.json) {
    await writeJson(options.json, transactions);
    console.log(`\nWrote ${transactions.length} transaction(s) to ${options.json}`);
  }
  if (options.csv) {
    await writeCsv(options.csv, receipts);
    console.log(`Wrote line items to ${options.csv}`);
  }

  if (options.import) {
    if (!options.account) {
      throw new Error('--account is required when using --import');
    }
    const accountId = await resolveAccountId(options.account);
    for (const tx of transactions) {
      if (options.dryRun) {
        console.log(`\n[dry-run] Would import "${tx.payee_name}" (${tx.imported_id})`);
        continue;
      }
      const { unmatchedCategories } = await importReceiptTransaction(
        accountId,
        tx,
      );
      console.log(`\nImported "${tx.payee_name}" into ${options.account}`);
      if (unmatchedCategories.length > 0) {
        console.log(
          `   ⚠ No matching Actual category for: ${unmatchedCategories.join(', ')} ` +
            `(left uncategorized)`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('receipt-scan')
    .description(
      'Scan receipts with Mistral OCR and import them into Actual as split transactions.',
    )
    .argument('<files...>', 'Receipt image(s) or PDF(s) to scan')
    .option('--account <nameOrId>', 'Actual account to import into')
    .option('--import', 'Import the results directly into Actual', false)
    .option('--json <path>', 'Write the built transactions to a JSON file')
    .option('--csv <path>', 'Write a flat CSV of line items (for review)')
    .option('--no-group', 'Keep one split per line item instead of grouping by category')
    .option('--dry-run', 'With --import, preview without writing', false)
    .action(async (files: string[], options: CliOptions) => {
      try {
        await run(files, options);
      } finally {
        await disconnect();
      }
    });

  await program.parseAsync();
}

main().catch(error => {
  console.error(`\nError: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
