import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import * as api from '@actual-app/api';

import { config } from './config.ts';
import type { ActualImportTransaction } from './types.ts';

let connected = false;

/** Init the API and download the configured budget. Idempotent. */
export async function connect(): Promise<void> {
  if (connected) return;

  const dataDir = resolve(config.actual.dataDir ?? './.actual-cache');
  await mkdir(dataDir, { recursive: true });

  await api.init({
    dataDir,
    serverURL: config.actual.serverURL,
    password: config.actual.password,
  });
  await api.downloadBudget(
    config.actual.syncId,
    config.actual.e2ePassword
      ? { password: config.actual.e2ePassword }
      : undefined,
  );
  connected = true;
}

export async function disconnect(): Promise<void> {
  if (!connected) return;
  await api.shutdown();
  connected = false;
}

/** Category names, used to constrain the extraction model. */
export async function getCategoryNames(): Promise<string[]> {
  const categories = await api.getCategories();
  return categories.map(category => category.name);
}

/** Resolve an account by name (case-insensitive) or id. */
export async function resolveAccountId(nameOrId: string): Promise<string> {
  const accounts = await api.getAccounts();
  const match = accounts.find(
    account =>
      account.id === nameOrId ||
      account.name.toLowerCase() === nameOrId.toLowerCase(),
  );
  if (!match) {
    const names = accounts.map(a => `"${a.name}"`).join(', ');
    throw new Error(`Account "${nameOrId}" not found. Available: ${names}`);
  }
  return match.id;
}

async function categoryNameToId(): Promise<Map<string, string>> {
  const categories = await api.getCategories();
  return new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
}

/**
 * Import one transaction (with its category-named splits) into `accountId`,
 * resolving split category names to ids. Returns the raw API result plus the
 * names that could not be matched to a real category.
 */
export async function importReceiptTransaction(
  accountId: string,
  transaction: ActualImportTransaction,
): Promise<{ result: unknown; unmatchedCategories: string[] }> {
  const nameToId = await categoryNameToId();
  const unmatched = new Set<string>();

  const subtransactions = transaction.subtransactions?.map(split => {
    if (!split.category) return { ...split, category: undefined };
    const id = nameToId.get(split.category.toLowerCase());
    if (!id) unmatched.add(split.category);
    return { ...split, category: id };
  });

  const result = await api.importTransactions(accountId, [
    { ...transaction, subtransactions },
  ]);

  return { result, unmatchedCategories: [...unmatched] };
}
