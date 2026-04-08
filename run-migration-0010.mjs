import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { config } from "dotenv";
config();

const sql = readFileSync("./drizzle/0010_brown_rocket_racer.sql", "utf8");
const conn = await mysql.createConnection(process.env.DATABASE_URL);
try {
  for (const stmt of sql.split(";").map(s => s.trim()).filter(Boolean)) {
    console.log("Executing:", stmt.slice(0, 80));
    await conn.execute(stmt);
  }
  console.log("Migration 0010 applied successfully.");
} finally {
  await conn.end();
}
