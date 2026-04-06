import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Total counts
const [[totals]] = await conn.query('SELECT COUNT(*) as orders FROM orders');
const [[itemTotals]] = await conn.query('SELECT COUNT(*) as items FROM order_items');
console.log('Total orders:', totals.orders, 'Total items:', itemTotals.items);

// Admin managers remaining
const [admins] = await conn.query("SELECT managerName, COUNT(*) as cnt FROM orders WHERE managerName LIKE '%Адмінка%' GROUP BY managerName");
console.log('Admin managers remaining:', admins);

// ВЛАСНА ЛОГІСТИКА items
const [[logCount]] = await conn.query("SELECT COUNT(*) as cnt FROM order_items WHERE code = 'ВЛАСНА ЛОГІСТИКА'");
console.log('ВЛАСНА ЛОГІСТИКА items:', logCount.cnt);

// Check specific invoices from bug report
const [invoices] = await conn.query("SELECT vortexOrderId, managerName, clientName FROM orders WHERE vortexOrderId IN ('56727','56962','57030','57235','57472')");
console.log('Bug report invoices:', invoices);

// Date range
const [[dateRange]] = await conn.query('SELECT MIN(FROM_UNIXTIME(createdTs)) as min_date, MAX(FROM_UNIXTIME(createdTs)) as max_date FROM orders');
console.log('Date range:', dateRange);

// Check ВЛАСНА ЛОГІСТИКА duplicates (same client, same date, different manager)
const [logDups] = await conn.query(`
  SELECT o.vortexOrderId, o.clientName, o.managerName, oi.description, oi.price, oi.currency
  FROM order_items oi
  JOIN orders o ON o.vortexOrderId = oi.vortexOrderId
  WHERE oi.code = 'ВЛАСНА ЛОГІСТИКА'
  ORDER BY o.clientName, o.createdTs
`);
console.log('ВЛАСНА ЛОГІСТИКА entries:', logDups.length);
logDups.forEach(r => console.log(`  ${r.vortexOrderId} | ${r.clientName} | ${r.managerName} | ${r.price} ${r.currency}`));

await conn.end();
