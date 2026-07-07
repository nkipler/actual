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

---

## Before you start (read this first)

**1. You need a Mistral API key.** Create an account at
[console.mistral.ai](https://console.mistral.ai/), add billing, and create an API
key. Mistral OCR and the small model used here are **paid** (a receipt costs a
fraction of a cent, but it is not free). Never share or commit this key.

**2. Direct import (`--import`) requires an Actual *sync server*.** The API can
only write into a budget that lives on a server — it cannot reach a budget you
only opened locally in your browser. You have a sync server if you log into
Actual with a URL and a password. If you don't have one yet, see
[Actual's server setup guide](https://actualbudget.org/docs/install/). Once you
have it you need three things from Actual → **Settings**:

- the **server URL** (e.g. `https://actual.example.com`)
- your **server password**
- the budget's **Sync ID** (Settings → **Advanced settings** → "Sync ID")

If you don't want to import automatically, you can skip the server entirely and
just generate a JSON file with `--json` to inspect the result.

**3. This tool is standalone.** It is *not* part of the Actual yarn workspaces,
so it never touches the main app's build. It has its own dependencies.

---

## Setup

```bash
cd tools/receipt-scanner
npm install                 # installs this tool's own dependencies
cp .env.example .env        # then open .env and fill it in
```

Open `.env` in a text editor and fill in the values (each one is explained in the
file). At minimum you need `MISTRAL_API_KEY`. The `ACTUAL_*` values are only
needed if you want to import automatically with `--import`.

`.env` is git-ignored, so your keys never get committed.

---

## First run (step by step)

**Step 1 — just look at what it reads (no key spending on Actual, no writes):**

```bash
npm run scan -- path/to/receipt.jpg
```

This runs OCR + extraction and prints the transaction it *would* create. Nothing
is written anywhere. Use this to confirm the amounts and categories look right.

**Step 2 — preview the import without writing (needs the `ACTUAL_*` values):**

```bash
npm run scan -- path/to/receipt.jpg --account "Checking" --import --dry-run
```

`"Checking"` is the **name of the account** in Actual you want the receipt to go
into (the tool matches it case-insensitively, or you can pass an account id).
`--dry-run` connects to Actual and validates everything but writes nothing.

**Step 3 — do it for real:**

```bash
npm run scan -- path/to/receipt.jpg --account "Checking" --import
```

Re-running the same receipt will **not** create a duplicate (each transaction
gets a stable id derived from merchant + date + total).

---

## All options

| Flag | Description |
| --- | --- |
| `--account <nameOrId>` | Actual account to import into (required with `--import`). |
| `--import` | Import the results directly into Actual (needs a sync server). |
| `--json <path>` | Write the built transaction(s) to a JSON file. |
| `--csv <path>` | Write a flat CSV of line items (for manual review only). |
| `--no-group` | Keep one split per line item instead of grouping by category. |
| `--dry-run` | With `--import`, preview without writing. |

Multiple files at once:

```bash
npm run scan -- receipts/*.jpg --account "Checking" --import
```

Supported inputs: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`.

---

## Tests

The transaction-building logic (splitting, category grouping, balancing) is
covered by unit tests that need no network and no API key:

```bash
npm test
```

---

## Good to know

- **Duplicates**: the stable `imported_id` (merchant + date + total) stops the
  same receipt being imported twice.
- **Amounts**: expenses are stored as negative integer cents (2-decimal
  currencies). The auto-balancing split guarantees the parent total matches what
  you actually paid, even when tax/rounding/discounts aren't itemized.
- **The CSV output is for review only.** Importing that CSV into Actual would
  recreate the "one row per split" problem — use `--import` or the JSON for real
  splits.
- **Models**: OCR uses `mistral-ocr-latest`; extraction defaults to
  `mistral-small-latest` (override with `MISTRAL_TEXT_MODEL` in `.env`).
- **Privacy**: your receipt images and their text are sent to Mistral for
  processing. Don't scan documents you're not comfortable sending to a
  third-party API.
