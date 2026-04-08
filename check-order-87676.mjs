import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check DB data for order 87676
const [items] = await conn.execute(
  `SELECT oi.code, oi.price, oi.basePrice, oi.basePriceCurrency, oi.qty, oi.fixedRate, oi.balanceCurrencyBasePrice
   FROM order_items oi
   JOIN orders o ON o.vortexOrderId = oi.vortexOrderId
   WHERE o.vortexOrderId = '87676'`
);

console.log('=== DB data for order 87676 ===');
items.forEach(item => {
  const price = Number(item.price);
  const basePrice = Number(item.basePrice);
  const qty = Number(item.qty) || 1;
  const fixedRate = item.fixedRate ? Number(item.fixedRate) : null;
  const balBase = item.balanceCurrencyBasePrice ? Number(item.balanceCurrencyBasePrice) : null;
  
  // Current "Дельта" formula in UI: (price - basePrice) × qty
  const deltaCurrentUI = (price - basePrice) * qty;
  // Expected per ТЗ: delta_per_unit = 550, so Дельта displayed = 550 (per unit)
  // MANUS Дельта = 550 × 4 = 2200
  
  console.log(JSON.stringify({
    code: item.code,
    price,
    basePrice,
    basePriceCurrency: item.basePriceCurrency,
    qty,
    fixedRate,
    balanceCurrencyBasePrice: balBase,
    // Calculations
    'delta_current_UI (price-base)*qty': deltaCurrentUI,
    'delta_per_unit (price-base)/1': price - basePrice,
    'MANUS_Продажна': price * qty,
    'MANUS_Дельта_if_delta_per_unit=550': 550 * qty,
    'MANUS_Вхідна': (price * qty) - (550 * qty),
  }, null, 2));
});

await conn.end();
