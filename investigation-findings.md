# Investigation Findings — Dual Order Pattern

## Key Discovery

Vortex creates **separate orders** for the same client with the **same `created` timestamp** but:
- **EUR order** → real sales manager (correct)
- **UAH order(s)** → admin account (Ж. Романюк(Адмінка), Л. Київ Адмінка, etc.)

These are NOT duplicates — they contain **different items** (different article codes, different prices).
The admin orders are legitimate orders with real items that need to be kept.

## Pattern Examples

### March 4 — Діма (client_id 45290):
- Order 86369 (EUR): manager="Лясковець Вітьки", items: BL3Z6L266A, AT4Z6256BZUFO, AA5Z6303D
- Order 86371 (UAH): manager="Л. Київ Адмінка", items: BL3Z6L266A, AT4Z6256BZUFO, AA5Z6303D
- **SAME items!** Both have the same articles. This IS a duplicate.

### March 4 — Воробей Володимир (client_id 45286):
- Order 86370 (EUR): manager="Н. Герасимчук", items: 19503RAAA01, 19503RWCA01, 19505RWCA00
- Order 86861 (UAH): manager="Л. Київ Адмінка", items: ВЛАСНА ЛОГІСТИКА, 19503RAAA01, 19503RWCA01, 19505RWCA00
- **Admin order has EXTRA item** (ВЛАСНА ЛОГІСТИКА) + same items as EUR order

### March 6 — Вадим Шмагленко (client_id 35633):
- Order 85899 (EUR): manager="О. Кісільчук", items: 10 items including 12658, 211075, RH6083
- **Only ONE order** — no paired UAH order. Manager is О. Кісільчук, but should be В. Шмагленко.
- This is a DIFFERENT bug — not dual-order, but wrong manager in the single order itself.

### March 9 — Кучеренко (client_id 37480):
- Order 86034 (EUR): manager="Мосійчук", items: 8W6 807 065 Q GRU
- Order 86803 (UAH): manager="Ж. Романюк(Адмінка)", items: 8W6 821 105 B, 8W0 805 594 E, etc. (9 items)
- **DIFFERENT items!** These are separate orders that belong to the same client.

### March 9 — Коретний Ростислав (client_id 42650):
- Order 86025 (EUR): manager="Л. Київ Адмінка", items: 9GT807983OK1
- Order 86639 (UAH): manager="Л. Київ Адмінка", items: ВЛАСНА ЛОГІСТИКА, 9GT854885BOK1
- **BOTH are admin!** No EUR order with real manager exists.

## Conclusions

1. **The dual-order pattern is NOT consistent** — sometimes items are the same (duplicates), sometimes different (separate orders).
2. **For admin orders paired with EUR orders of the same client+timestamp**: the EUR order's manager is the correct one. We should copy the EUR manager to the UAH admin order.
3. **For admin orders WITHOUT a paired EUR order** (like Коретний): we need another approach.
4. **For О. Кісільчук / Є. Бардаш / І. Гопанчук**: these are NOT admin accounts but regular managers who appear INSTEAD of the real manager. This is a different problem — possibly the API returns the wrong manager for some orders.

## Strategy

### For admin orders (Ж. Романюк(Адмінка), Л. Київ Адмінка, М. Скоп(Адмінка), І. Гопанчук (адмінка)):
- Find paired EUR order for same client_id + same created timestamp
- If found: copy manager_name from EUR order to admin order
- If not found: leave as-is (or mark as "needs manual review")

### For О. Кісільчук → В. Шмагленко (7 rows):
- These 7 items all belong to invoice 56962, client "вадим шмагленко"
- Only ONE order exists (85899, EUR) with manager О. Кісільчук
- The correct manager В. Шмагленко is NOT available anywhere in the API response
- This requires a manual override or a different API field

### For Є. Бардаш → М. Мілінічук (2 rows):
- Similar — need to check if there's a paired order

### For І. Гопанчук (адмінка) → І. Платонов (1 row):
- "адмінка" in name suggests this is also an admin account pattern
