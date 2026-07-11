-- Las pragmas se aplican en db.js por cada conexión (SQLite las resetea al cerrar)

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'customer'
                  CHECK(role IN ('customer', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- user_id es nullable: el checkout no exige login (WhatsApp directo), pero
-- si hay sesión activa el pedido queda asociado igual. customer_name/phone
-- quedan siempre en la fila (desnormalizados) porque son la fuente de verdad
-- para pedidos anónimos, no solo un espejo de users.
CREATE TABLE IF NOT EXISTS orders (
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

CREATE TABLE IF NOT EXISTS order_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  pack_id           TEXT NOT NULL,
  pack_name         TEXT NOT NULL,
  qty               INTEGER NOT NULL DEFAULT 1 CHECK(qty > 0),
  price_at_time_clp INTEGER
);

CREATE TRIGGER IF NOT EXISTS orders_updated_at
  AFTER UPDATE ON orders
BEGIN
  UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
END;
