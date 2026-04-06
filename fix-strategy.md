# Fix Strategy for Bug #1 and Bug #2

## Full March Scan Results:
- Total admin orders: 39
- Admin WITH EUR pair (same client_id + same created): 24
- Admin WITHOUT pair: 15

## Fix Plan:

### Step 1: Restore deleted Адмінка orders
Previous fix deleted 39 admin orders. Need to re-sync March to bring them back.
BUT: we should NOT delete them this time. Instead, fix their manager.

### Step 2: Fix manager for admin orders WITH EUR pair (24 orders)
For these 24 orders, copy manager_name from the paired EUR order.
Match criteria: same client_id + same created timestamp + different order_id.

### Step 3: Admin orders WITHOUT pair (15 orders)
These 15 orders have no paired EUR order. They are standalone admin orders.
List:
- 86371 (Діма, Л. Київ Адмінка) — has paired order 86369 with DIFFERENT created? Need to check by client_id only
- 86861 (Воробей Володимир, Л. Київ Адмінка)
- 86188 (Сергій Кулик, Л. Київ Адмінка)
- 86025 (Коретний Ростислав, Л. Київ Адмінка)
- 86639 (Коретний Ростислав, Л. Київ Адмінка)
- 87017 (Булана Алла, Л. Київ Адмінка)
- 86645 (Саша, Л. Київ Адмінка)
- 86116 (Фрумос А.И, Ж. Романюк(Адмінка))
- 86117 (Фрумос А.И, Ж. Романюк(Адмінка))
- 86324 (Скуз Євгеній, Л. Київ Адмінка)
- 86613 (Влад Фіщук, М. Скоп(Адмінка))
- 86619 (Марія Скоп, М. Скоп(Адмінка))
- 86623 (Марія Скоп, М. Скоп(Адмінка))
- 86859 (Євгеній, Л. Київ Адмінка)
- 87156 (Марцинко Ольга, Ж. Романюк(Адмінка))

For these, try matching by client_id on the same day (ignoring created timestamp).
If still no pair found, leave manager as-is.

### Step 4: Fix О. Кісільчук → В. Шмагленко (7 items, invoice 56962)
Only ONE order exists (85899) with manager О. Кісільчук. No pair.
The bug report says correct manager is В. Шмагленко (@allparts_Vad_sh).
This is NOT an admin account — it's a different manager entirely.
Need manual override in syncService: if vortexOrderId=85899, set manager to В. Шмагленко.

### Step 5: Fix Є. Бардаш → М. Мілінічук (2 items, invoice 57521)
Order 87695 (UAH): manager="Є. Бардаш", client="Устименко Кирило"
Items: ВЛАСНА ЛОГІСТИКА + 13X502
No paired EUR order found. Є. Бардаш is NOT an admin account (no "Адмінка" in name).
Need manual override: if vortexOrderId=87695, set manager to М. Мілінічук.

### Step 6: Fix І. Гопанчук (адмінка) → І. Платонов (1 item, invoice 56966)
Order 86762 (EUR): manager="І. Гопанчук (адмінка) @imurrravska"
Has "(адмінка)" in name but is an EUR order. No pair found.
Need manual override: if vortexOrderId=86762, set manager to І. Платонов.

## Implementation Strategy:

### In syncService.ts:
1. REMOVE the Адмінка filter (don't skip admin orders)
2. After saving all orders for a day, do a POST-PROCESSING step:
   - For each admin order (manager contains "Адмінка"):
     a. Find paired non-admin order with same client_id + same created timestamp
     b. If found: update admin order's manager to pair's manager
     c. If not found: try same client_id on same day
     d. If still not found: leave as-is
3. Apply manual overrides for specific orders:
   - 85899: О. Кісільчук → В. Шмагленко (@allparts_Vad_sh)
   - 87695: Є. Бардаш → М. Мілінічук (СТО)
   - 86762: І. Гопанчук (адмінка) → І. Платонов

### For ВЛАСНА ЛОГІСТИКА:
- Keep all records in DB (don't delete)
- Filter them OUT of the main Orders tab
- Create separate Логістика tab
- Exclude from main dashboard stats
