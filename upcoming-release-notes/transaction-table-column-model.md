---
category: Maintenance
authors: [MatissJanis]
---

Introduce a TanStack Table-based column model for the transaction table as the foundation for modernizing the underlying table components. The new model is the single source of truth for column order, width, sorting and keyboard-navigation fields, and drives the table header. It is gated behind the `transactionTableV2` feature flag (enabled by default) with no change to the table's look, feel or behavior.
