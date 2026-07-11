/**
 * Migraciones idempotentes para bases de datos creadas antes de que `orders`
 * soportara pedidos anónimos. `schema.sql` ya define la forma final (nuevas
 * instalaciones la obtienen directo); este archivo trae al día una DB que ya
 * tenía la tabla `orders` vieja (`user_id NOT NULL`, sin customer_name/phone).
 *
 * SQLite no permite relajar un NOT NULL ni una FK con ALTER TABLE, así que
 * seguimos el patrón oficial: crear tabla nueva → copiar datos → drop →
 * rename, todo dentro de una transacción y con foreign_keys=OFF mientras dura
 * el swap (se re-activa al terminar).
 */

function ordersNeedsMigration(db) {
  const cols = db.prepare("PRAGMA table_info('orders')").all();
  return !cols.some((c) => c.name === 'customer_name');
}

function migrateOrdersTable(db) {
  if (!ordersNeedsMigration(db)) return;

  console.log('→ Migrando tabla orders (pedidos anónimos + campos de venta)...');

  db.pragma('foreign_keys = OFF');
  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE orders_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        customer_name     TEXT NOT NULL DEFAULT '',
        customer_phone    TEXT,
        status            TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','confirmed','preparing','shipped','delivered','cancelled')),
        delivery          TEXT NOT NULL DEFAULT 'retiro'
                            CHECK(delivery IN ('retiro', 'despacho')),
        address           TEXT,
        date_hint         TEXT,
        notes             TEXT,
        total_clp         INTEGER,
        quantity_hallacas INTEGER NOT NULL DEFAULT 0,
        payment_method    TEXT,
        source            TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web', 'admin')),
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Pedidos viejos siempre tenían user_id NOT NULL: heredamos nombre/teléfono
      -- desde users. quantity_hallacas queda en 0 (dato histórico no capturado antes).
      INSERT INTO orders_new (
        id, user_id, customer_name, customer_phone, status, delivery,
        date_hint, notes, total_clp, quantity_hallacas, source, created_at, updated_at
      )
      SELECT o.id, o.user_id, u.name, u.phone, o.status, o.delivery,
             o.date_hint, o.notes, o.total_clp, 0, 'web', o.created_at, o.updated_at
      FROM orders o
      JOIN users u ON u.id = o.user_id;

      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;

      CREATE TRIGGER IF NOT EXISTS orders_updated_at
        AFTER UPDATE ON orders
      BEGIN
        UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `);
  });
  run();
  db.pragma('foreign_keys = ON');

  console.log('✓ Tabla orders migrada.');
}

function addOrdersAddressColumn(db) {
  const cols = db.prepare("PRAGMA table_info('orders')").all();
  if (cols.some((c) => c.name === 'address')) return;

  console.log('→ Agregando columna orders.address (dirección de despacho)...');
  db.exec('ALTER TABLE orders ADD COLUMN address TEXT');
  console.log('✓ Columna orders.address agregada.');
}

function runMigrations(db) {
  migrateOrdersTable(db);
  addOrdersAddressColumn(db);
}

module.exports = { runMigrations };
