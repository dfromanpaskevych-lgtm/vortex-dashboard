import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await mysql.createConnection(DATABASE_URL);

try {
  // Check if column already exists
  const [cols] = await conn.execute(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'order_items' AND COLUMN_NAME = 'balanceCurrencyBasePrice'"
  );
  if (cols.length > 0) {
    console.log("Column balanceCurrencyBasePrice already exists — skipping.");
  } else {
    await conn.execute("ALTER TABLE `order_items` ADD COLUMN `balanceCurrencyBasePrice` decimal(12,2)");
    console.log("✅ Migration applied: added balanceCurrencyBasePrice column to order_items");
  }
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exit(1);
} finally {
  await conn.end();
}
