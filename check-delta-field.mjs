import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read .env
const envPath = join(__dirname, '.env');
let envContent = '';
try { envContent = readFileSync(envPath, 'utf8'); } catch(e) {}
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get vortex credentials
const [rows] = await conn.execute('SELECT * FROM vortex_credentials LIMIT 1');
if (!rows.length) { console.log('No credentials'); process.exit(1); }
const creds = rows[0];

// Call Vortex API
const payload = {
  login: creds.login,
  password: creds.password,
  cookies: creds.cookies ? JSON.parse(creds.cookies) : {},
  method: 'get_order_by_id',
  data: { order_id: '87676' }
};

const resp = await fetch(creds.api_url || 'https://api.vortex.ua/api/v1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const json = await resp.json();
const items = json?.data?.items || [];
console.log(`Order 87676 — ${items.length} items:`);
items.forEach(item => {
  console.log(JSON.stringify({
    code: item.code,
    price: item.price,
    base_price: item.base_price,
    base_price_currency: item.base_price_currency,
    qty: item.qty,
    delta: item.delta,
    balance_currency_base_price: item.balance_currency_base_price,
    balance_currency_price: item.balance_currency_price,
    sum_uah: item.sum_uah,
  }, null, 2));
});

await conn.end();
