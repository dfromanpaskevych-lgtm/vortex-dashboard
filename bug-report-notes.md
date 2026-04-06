# Bug Report Notes — tz_allparts_manus_bug(1).docx

## Bug #1 — Wrong Manager (78 rows)

API puts admin/operator who confirmed/edited the order into "Manager" field instead of the real sales manager.

### 5 Replacement Patterns:
| Real Manager (Vortex) | What Manus Shows (bug) | Count |
|---|---|---|
| В. Козлюк, В. Крепчук, Занюк, П. Александрович, Мосійчук та ін. | Ж. Романюк(Адмінка) | ~55 |
| Лясковець, Шкалуба, Н. Герасимчук, Губа, В. Гуменюк та ін. | Л. Київ Адмінка | ~21 |
| В. Шмагленко (@allparts_Vad_sh) | О. Кісільчук (@Allparts_) | 7 |
| М. Мілінічук (@allparts_M_M) | Є. Бардаш | 2 |
| І. Платонов | І. Гопанчук (адмінка) | 1 |

### 23 Unique Orders with Wrong Manager:
| Date | Article | Client | Correct Manager | Bug Manager | Invoice |
|---|---|---|---|---|---|
| 04.03 | 19505RWCA00 | Гаєвський Євген | В. Козлюк (Савицькі) | Ж. Романюк(Адмінка) | 56420 |
| 04.03 | BL3Z6L266A | Діма | Лясковець Вітьки | Л. Київ Адмінка | 56727 |
| 04.03 | AT4Z6256BZUFO | Діма | Лясковець Вітьки | Л. Київ Адмінка | 56727 |
| 04.03 | AA5Z6303D | Діма | Лясковець Вітьки | Л. Київ Адмінка | 56727 |
| 05.03 | 3 089 968 2 | Игумнов Олександр | В. Козлюк (Савицькі) | Ж. Романюк(Адмінка) | 56404 |
| 05.03 | FP 7445 311 | Коваленко Є. | В. Крепчук (Яровиця) | Л. Київ Адмінка | 56560 |
| 06.03 | 12658 | Вадим Шмагленко | В. Шмагленко (@allparts_Vad_sh) | О. Кісільчук (@Allparts_) | 56962 |
| 06.03 | 211075 | Вадим Шмагленко | В. Шмагленко (@allparts_Vad_sh) | О. Кісільчук (@Allparts_) | 56962 |
| 06.03 | RH6083 | Вадим Шмагленко | В. Шмагленко (@allparts_Vad_sh) | О. Кісільчук (@Allparts_) | 56962 |
| 07.03 | 86350F1600 | Сергій Кулик | Шкалуба (Яровиця) | Л. Київ Адмінка | 56610 |
| 09.03 | 971400048AM | Дикий Віталій | В. Крепчук (Яровиця) | Ж. Романюк(Адмінка) | 57109 |
| 09.03 | 8W6 807 283 | Кучеренко Дмитро | Мосійчук Набережна | Ж. Романюк(Адмінка) | 57030 |
| 09.03 | 9GT807983OK1 | Коретний Ростислав | П. Александрович | Л. Київ Адмінка | 56496 |
| 10.03 | 7L8 413 031 J | Фрумос А.И | П. Александрович | Ж. Романюк(Адмінка) | 56666 |
| 17.03 | 41B2K82K | Рыков Роман | Губа СМ Губки | Л. Київ Адмінка | 57179 |
| 18.03 | 29150P4000 | Лисенко Павло | Занюк Вітькі | Ж. Романюк(Адмінка) | 57235 |
| 20.03 | 1 987 301 015 | Іван Волод. | І. Платонов | І. Гопанчук (адмінка) | 56966 |
| 21.03 | 54359700060 | Станіслав Капустін | Занюк Вітькі | Ж. Романюк(Адмінка) | 57130 |
| 24.03 | 04857830AB | Стрембіцький А. | П. Александрович | Ж. Романюк(Адмінка) | 57154 |
| 26.03 | 13X502 | Устименко Кирило | М. Мілінічук (СТО) | Є. Бардаш | 57521 |
| 27.03 | A 211 620 11 87 | Москальчук Р. | П. Александрович | Ж. Романюк(Адмінка) | 57237 |
| 30.03 | FP3034311 | kızıl Орхан | Занюк Вітькі | Ж. Романюк(Адмінка) | 57472 |
| 31.03 | 82 00 751 534 | Мурадян М | П. Александрович | Ж. Романюк(Адмінка) | 57409 |

### Key Insight from Investigation:
The problem is that Vortex creates TWO separate orders for the same client:
- One in EUR with the REAL manager (correct)
- One in UAH with an ADMIN manager (wrong)
Both have the same client, same date, same created timestamp.
The Manus sync picks up BOTH orders. The admin order has the wrong manager.

### What to Check:
- Find where manager_name is mapped in the JSON response
- Look for fields: responsible, manager, created_by, modified_by, confirmed_by, assigned_to
- The correct field should have the real sales manager

### Verification:
- Invoice 56962 → should be В. Шмагленко (@allparts_Vad_sh)
- Invoice 56727 → should be Лясковець Вітьки Allparts_F_L
- Invoice 57235 → should be Занюк Вітькі allparts_S_Z
- Invoice 57030 → should be Мосійчук Набережна allparts_M_A

## Bug #2 — Extra ВЛАСНА ЛОГІСТИКА Rows (4 rows)

4 rows with article "ВЛАСНА ЛОГІСТИКА" from "Л. Київ Адмінка" that don't exist in Vortex at all.
For the same clients and dates, Vortex has ВЛАСНА ЛОГІСТИКА from correct managers (С. Марчук Логістика).

| Date | Client | Manus Manager | Sum | Problem |
|---|---|---|---|---|
| 04.03 | Воробей Володимир | Л. Київ Адмінка | 1000 грн | Not in Vortex |
| 04.03 | Діма | Л. Київ Адмінка | 500 грн | Not in Vortex |
| 09.03 | Коретний Ростислав | Л. Київ Адмінка | 400 грн | Not in Vortex |
| 17.03 | Рыков Роман | Л. Київ Адмінка | 600 грн | Not in Vortex |

## USER CLARIFICATION:
- ВЛАСНА ЛОГІСТИКА should NOT be deleted! It must stay in the system.
- In the main Orders tab — DO NOT show rows with article "ВЛАСНА ЛОГІСТИКА"
- Create a SEPARATE "Логістика" tab to show all logistics records
- In dashboards/statistics, logistics should also be separate

## Definition of Done:
1. Re-run for invoices 56727, 56962, 57030, 57235, 57472 — manager must match Vortex
2. Ж. Романюк(Адмінка) and Л. Київ Адмінка must NOT appear in Manager field for completed orders
3. 4 extra ВЛАСНА ЛОГІСТИКА rows from Admin — absent or merged with correct row
4. Total count of complete rows stays 1458 (doesn't decrease after fix)
