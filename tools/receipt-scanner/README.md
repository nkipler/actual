# Receipt scanner → Actual Budget

Scan a receipt (photo or PDF), read it with **Mistral OCR**, and import it into
[Actual Budget](https://actualbudget.org) as a **single split transaction** — one
parent transaction for the total, with one subtransaction per category.

## Why this exists

Actual's CSV import treats **every row as its own transaction**, so a receipt
with many lines becomes many separate transactions instead of one split. This
tool sidesteps CSV entirely and uses the official `@actual-app/api`, which
supports `subtransactions` natively. The result is exactly what you want:

```
Carrefour              -42.17   (parent, the total you paid)
├─ Groceries           -31.90
├─ Household           -6.30
└─ Taxes / rounding    -3.97   (auto-balancing split, so the total always matches)
```

## Pipeline

```
photo / PDF ──▶ Mistral OCR ──▶ structured extraction ──▶ split transaction ──▶ Actual
             (mistral-ocr-latest)  (Mistral chat, JSON)     (build.ts)          (API / JSON / CSV)
```

When importing, the tool fetches your real Actual categories and asks the model
to map each line item to one of them, so splits land in the right budget
categories automatically. Unmatched categories are left uncategorized (and
reported), never guessed into the wrong bucket.

## Setup

This is a standalone tool; it is **not** part of the Actual yarn workspaces, so
it never touches the monorepo build. Install its own dependencies:

```bash
cd tools/receipt-scanner
npm install          # or: yarn install / pnpm install
cp .env.example .env # then fill it in
```

Fill in `.env`:

- `MISTRAL_API_KEY` — required for OCR + extraction ([get one](https://console.mistral.ai/)).
- `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID` — only needed for
  `--import` (direct import into your budget). `ACTUAL_SYNC_ID` is under
  Actual → Settings → Advanced → "Sync ID".
- `ACTUAL_E2E_PASSWORD` — only if your budget is end-to-end encrypted.

## Usage

```bash
# 1) Preview: OCR + extraction, print the split, no writes
npm run scan -- receipt.jpg

# 2) Save the built transaction as JSON (and/or a flat CSV of line items)
npm run scan -- receipt.pdf --json out.json --csv items.csv

# 3) Import straight into Actual as a split transaction
npm run scan -- receipt.jpg --account "Checking" --import

# Dry run the import (shows what would happen, writes nothing)
npm run scan -- receipt.jpg --account "Checking" --import --dry-run

# Several receipts at once
npm run scan -- receipts/*.jpg --account "Checking" --import
```

### Options

| Flag | Description |
| --- | --- |
| `--account <nameOrId>` | Actual account to import into (required with `--import`). |
| `--import` | Import the results directly into Actual. |
| `--json <path>` | Write the built transaction(s) to a JSON file. |
| `--csv <path>` | Write a flat CSV of line items (for manual review). |
| `--no-group` | Keep one split per line item instead of grouping by category. |
| `--dry-run` | With `--import`, preview without writing. |

Supported inputs: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`.

## Notes

- **Duplicates**: each transaction gets a stable `imported_id` derived from
  merchant + date + total, so re-importing the same receipt won't duplicate it.
- **Amounts**: expenses are stored as negative integer cents (2-decimal
  currencies). The auto-balancing split guarantees the parent total matches what
  you actually paid, even when tax/rounding/discounts don't appear as line items.
- **The CSV output is for review only.** Importing that CSV into Actual would
  recreate the "one row per split" problem — use `--import` or the JSON for real
  splits.
- **Models**: OCR uses `mistral-ocr-latest`; extraction defaults to
  `mistral-small-latest` (override with `MISTRAL_TEXT_MODEL`).
