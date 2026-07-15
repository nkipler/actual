/** A single line item read from a receipt. */
export type ReceiptItem = {
  /** Human readable description exactly as printed on the receipt. */
  description: string;
  /** Quantity, when the receipt shows one. Defaults to 1. */
  quantity: number;
  /** Line total in the receipt currency (positive number, e.g. 3.49). */
  amount: number;
  /**
   * Name of the Actual category this item most likely belongs to.
   * When the list of real categories is provided to the model it must pick
   * one of them; otherwise it is a free-form guess.
   */
  category: string | null;
};

/** Structured data extracted from one receipt. */
export type ReceiptData = {
  /** Store / payee name printed on the receipt. */
  merchant: string;
  /** Purchase date in YYYY-MM-DD format. */
  date: string;
  /** ISO 4217 currency code, best effort (e.g. "EUR", "USD"). */
  currency: string;
  /** Grand total actually paid, as printed on the receipt (positive number). */
  total: number;
  /** Individual line items. */
  items: ReceiptItem[];
};

/** Shape accepted by `@actual-app/api` import, with split subtransactions. */
export type ActualImportTransaction = {
  date: string;
  amount: number;
  payee_name: string;
  notes?: string;
  imported_id?: string;
  cleared?: boolean;
  subtransactions?: Array<{
    amount: number;
    category?: string;
    notes?: string;
  }>;
};
