import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { getDb } from "./db";
import { orders, orderItems } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export async function handleExcelExport(req: Request, res: Response) {
  try {
    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    // Get all orders with items
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
        retailPrice: orderItems.retailPrice,
        itemCurrency: orderItems.currency,
        deliveryTime: orderItems.deliveryTime,
        realDeliveryTime: orderItems.realDeliveryTime,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
      .orderBy(desc(orders.createdTs));

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Замовлення");

    // Title row
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    const titleText = `Звіт «Замовлення клієнтів» — ${startDate.toLocaleDateString("uk-UA")} - ${now.toLocaleDateString("uk-UA")}`;
    worksheet.mergeCells("A1:AA1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = titleText;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center" };

    // Headers
    const headers = [
      "№", "Менеджер", "Бренд", "Артикул", "Опис", "Статус", "Склад",
      "Оформлено", "Прибуття", "К-сть", "Вхідна ціна", "Валюта вхід.",
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
      const rp = row.retailPrice ? Number(row.retailPrice) : null;
      const delta = bp != null && rp != null ? (rp - bp) : null;

      worksheet.addRow([
        row.vortexOrderId,
        row.managerName || "",
        row.brandName || "",
        row.code || "",
        row.description || "",
        row.status || "",
        row.whName || "",
        formatDate(row.createdTs),
        formatDate(row.deliveryTime),
        row.qty || "",
        bp != null ? bp : "",
        row.basePriceCurrency || "",
        rp != null ? rp : "",
        delta != null ? delta : "",
        row.itemCurrency || "",
        "",
        "",
        row.clientName || "",
        "",
        "",
        row.deliveryName || "",
        row.customerPhone || "",
        row.trackNumber || "",
        formatDate(row.realDeliveryTime),
        "",
        "",
        "",
      ]);
    }

    // Column widths
    const widths = [12, 35, 15, 15, 30, 12, 25, 12, 12, 8, 12, 10, 12, 10, 10, 14, 10, 30, 12, 14, 20, 15, 18, 12, 14, 10, 18];
    widths.forEach((w, i) => {
      worksheet.getColumn(i + 1).width = w;
    });

    // Send response
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Vortex_Orders_${now.toISOString().slice(0, 10)}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("[Export] Excel export error:", error);
    res.status(500).json({ error: "Export failed" });
  }
}
