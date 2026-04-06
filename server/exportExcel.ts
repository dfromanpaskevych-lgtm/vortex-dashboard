import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { getDb } from "./db";
import { orders, orderItems } from "../drizzle/schema";
import { eq, desc, and, like, or, gte, lte, sql } from "drizzle-orm";

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateForTitle(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export async function handleExcelExport(req: Request, res: Response) {
  try {
    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    // Parse query params for filters
    const manager = req.query.manager as string | undefined;
    const status = req.query.status as string | undefined;
    const brand = req.query.brand as string | undefined;
    const client = req.query.client as string | undefined;
    const search = req.query.search as string | undefined;
    const dateFromStr = req.query.dateFrom as string | undefined;
    const dateToStr = req.query.dateTo as string | undefined;

    // Build conditions
    const conditions: any[] = [];

    // Exclude ВЛАСНА ЛОГІСТИКА
    conditions.push(sql`${orderItems.code} != 'ВЛАСНА ЛОГІСТИКА'`);

    if (manager) {
      conditions.push(like(orders.managerName, `%${manager}%`));
    }
    if (client) {
      conditions.push(like(orders.clientName, `%${client}%`));
    }
    if (status) {
      conditions.push(eq(orderItems.status, status));
    }
    if (brand) {
      conditions.push(like(orderItems.brandName, `%${brand}%`));
    }
    if (dateFromStr) {
      const dateFromTs = Math.floor(new Date(dateFromStr + "T00:00:00").getTime() / 1000);
      conditions.push(gte(orders.createdTs, dateFromTs));
    }
    if (dateToStr) {
      const dateToTs = Math.floor(new Date(dateToStr + "T23:59:59").getTime() / 1000);
      conditions.push(lte(orders.createdTs, dateToTs));
    }
    if (search) {
      conditions.push(
        or(
          like(orders.vortexOrderId, `%${search}%`),
          like(orders.clientName, `%${search}%`),
          like(orders.managerName, `%${search}%`),
          like(orderItems.code, `%${search}%`),
          like(orderItems.description, `%${search}%`),
          like(orderItems.brandName, `%${search}%`),
          like(orders.trackNumber, `%${search}%`),
          like(orders.customerPhone, `%${search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get filtered orders with items
    const rows = await db
      .select({
        vortexOrderId: orders.vortexOrderId,
        clientName: orders.clientName,
        managerName: orders.managerName,
        currency: orders.currency,
        sumUah: orders.sumUah,
        deliveryName: orders.deliveryName,
        customerPhone: orders.customerPhone,
        trackNumber: orders.trackNumber,
        createdTs: orders.createdTs,
        code: orderItems.code,
        brandName: orderItems.brandName,
        description: orderItems.description,
        status: orderItems.status,
        whName: orderItems.whName,
        qty: orderItems.qty,
        basePrice: orderItems.basePrice,
        basePriceCurrency: orderItems.basePriceCurrency,
        price: orderItems.price,
        retailPrice: orderItems.retailPrice,
        itemCurrency: orderItems.currency,
        deliveryTime: orderItems.deliveryTime,
        realDeliveryTime: orderItems.realDeliveryTime,
        supplierName: orderItems.supplierName,
        supplierTotal: orderItems.supplierTotal,
        supplierCurrency: orderItems.supplierCurrency,
        rgTimestamp: orderItems.rgTimestamp,
        fixedRate: orderItems.fixedRate,
        fixedRateDate: orderItems.fixedRateDate,
        balanceCurrencyTotal: orders.balanceCurrencyTotal,
        balanceCurrency: orders.balanceCurrency,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
      .where(whereClause)
      .orderBy(desc(orders.createdTs));

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Замовлення");

    // Title row — show actual date range if selected
    let titleText: string;
    if (dateFromStr && dateToStr) {
      titleText = `Звіт «Замовлення клієнтів» — ${formatDateForTitle(dateFromStr)} - ${formatDateForTitle(dateToStr)}`;
    } else if (dateFromStr) {
      titleText = `Звіт «Замовлення клієнтів» — від ${formatDateForTitle(dateFromStr)}`;
    } else if (dateToStr) {
      titleText = `Звіт «Замовлення клієнтів» — до ${formatDateForTitle(dateToStr)}`;
    } else {
      titleText = `Звіт «Замовлення клієнтів» — всі дати`;
    }

    // Add filter info to title
    const filterParts: string[] = [];
    if (manager) filterParts.push(`Менеджер: ${manager}`);
    if (status) filterParts.push(`Статус: ${status}`);
    if (brand) filterParts.push(`Бренд: ${brand}`);
    if (client) filterParts.push(`Клієнт: ${client}`);
    if (search) filterParts.push(`Пошук: ${search}`);
    if (filterParts.length > 0) {
      titleText += ` | ${filterParts.join(", ")}`;
    }

    titleText += ` | ${rows.length} рядків`;

    worksheet.mergeCells("A1:AC1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = titleText;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center" };

    // Headers
    const headers = [
      "№", "Менеджер", "Бренд", "Артикул", "Опис", "Статус", "Склад",
      "Оформлено", "Прибуття", "К-сть", "Вхідна ціна", "Валюта вхід.",
      "Вхідна (грн)", "Курс",
      "Продаж", "Дельта", "Валюта продаж", "Поточний баланс", "Валюта баланс",
      "Клієнт", "Тип клієнта", "Група націнок", "Доставка", "Номер телефону",
      "Документ видачі", "Дата видачі", "Баланс постач.", "Валюта постач.",
      "Дата оплати накладної",
    ];

    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD3D3D3" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Data rows
    for (const row of rows) {
      const bp = row.basePrice ? Number(row.basePrice) : null;
      const sp = row.price ? Number(row.price) : (row.retailPrice ? Number(row.retailPrice) : null);
      const qty = Number(row.qty) || 1;
      // Vortex delta = (price_per_unit - base_price_per_unit) × qty
      // Both price and base_price are per-unit; delta is for the TOTAL quantity
      const delta = bp != null && sp != null ? (sp - bp) * qty : null;
      const phone = row.customerPhone && row.customerPhone.trim() !== "" ? row.customerPhone.trim() : "немає номеру";

      // Calculate base price in UAH using fixedRate
      const fixedRate = row.fixedRate ? Number(row.fixedRate) : null;
      const basePriceUah = bp != null && fixedRate && fixedRate > 0 ? bp * fixedRate : null;

      worksheet.addRow([
        row.vortexOrderId,
        row.managerName?.trim() || "—",
        row.brandName || "—",
        row.code || "—",
        row.description?.trim() || "—",
        row.status || "—",
        row.whName || "—",
        formatDate(row.createdTs),
        formatDate(row.deliveryTime),
        row.qty || "—",
        bp != null ? bp : "—",
        row.basePriceCurrency ? row.basePriceCurrency.toUpperCase() : "—",
        basePriceUah != null ? Math.round(basePriceUah * 100) / 100 : "—",
        fixedRate != null ? fixedRate : "—",
        sp != null ? sp : "—",
        delta != null ? delta : "—",
        row.itemCurrency ? row.itemCurrency.toUpperCase() : "—",
        row.balanceCurrencyTotal ? Number(row.balanceCurrencyTotal) : "—",
        row.balanceCurrency ? row.balanceCurrency.toUpperCase() : "—",
        row.clientName?.trim() || "—",
        "—",  // Тип клієнта - не в API
        "—",  // Група націнок - не в API
        row.deliveryName || "—",
        phone,
        row.trackNumber || "—",
        formatDate(row.realDeliveryTime),
        row.supplierTotal ? Number(row.supplierTotal) : "—",
        row.supplierCurrency ? row.supplierCurrency.toUpperCase() : "—",
        formatDate(row.rgTimestamp),
      ]);
    }

    // Column widths
    const widths = [12, 35, 15, 15, 30, 12, 25, 12, 12, 8, 12, 10, 12, 8, 12, 10, 10, 14, 10, 30, 12, 14, 20, 15, 18, 12, 14, 10, 18];
    widths.forEach((w, i) => {
      worksheet.getColumn(i + 1).width = w;
    });

    // Filename with date range
    const now = new Date();
    let filename = `Vortex_Orders`;
    if (dateFromStr) filename += `_${dateFromStr}`;
    if (dateToStr) filename += `_${dateToStr}`;
    if (!dateFromStr && !dateToStr) filename += `_${now.toISOString().slice(0, 10)}`;
    filename += `.xlsx`;

    // Send response
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("[Export] Excel export error:", error);
    res.status(500).json({ error: "Export failed" });
  }
}
