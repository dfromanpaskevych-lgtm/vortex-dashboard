import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const conn = await mysql.createConnection(url);
try {
  await conn.execute("ALTER TABLE `sync_logs` ADD `dateFrom` varchar(10)");
  console.log("Added dateFrom column");
} catch (e) {
  if (e.code === "ER_DUP_FIELDNAME") console.log("dateFrom already exists");
  else throw e;
}
try {
  await conn.execute("ALTER TABLE `sync_logs` ADD `dateTo` varchar(10)");
  console.log("Added dateTo column");
} catch (e) {
  if (e.code === "ER_DUP_FIELDNAME") console.log("dateTo already exists");
  else throw e;
}
await conn.end();
console.log("Migration 0009 done");
