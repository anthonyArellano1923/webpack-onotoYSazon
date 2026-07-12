-- Las pragmas se aplican en db.js por cada conexión (SQLite las resetea al cerrar)

-- Login por teléfono: phone es el identificador de cuenta (normalizado +56XXXXXXXXX).
-- email pasó a opcional. Ambos UNIQUE permiten múltiples NULL en SQLite, así que
-- los usuarios legado registrados solo con email conservan su fila (sin poder
-- entrar hasta re-registrarse o que el admin les asigne teléfono).
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  address       TEXT,
  role          TEXT NOT NULL DEFAULT 'customer'
                  CHECK(role IN ('customer', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Parámetros globales del negocio (fila única, id=1). hallacas_producidas es el
-- "contador simple" de stock de la temporada: 0 significa "contador sin usar"
-- (no se limita disponibilidad) para no marcar todo agotado antes de configurarlo.
CREATE TABLE IF NOT EXISTS settings (
  id                  INTEGER PRIMARY KEY CHECK(id = 1),
  price_per_hallaca   INTEGER NOT NULL DEFAULT 4000,
  cost_per_hallaca    INTEGER NOT NULL DEFAULT 4000,
  hallacas_producidas INTEGER NOT NULL DEFAULT 0
);

-- Catálogo de packs (migrado desde src/data/packs.js). price_clp NULL = pack
-- "por encargo" (precio a coordinar). qty = hallacas que consume el pack, la
-- unidad real de stock del negocio.
CREATE TABLE IF NOT EXISTS packs (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  qty_label        TEXT NOT NULL,
  tag              TEXT,
  tagline          TEXT,
  description      TEXT,
  image            TEXT,
  qty              INTEGER NOT NULL CHECK(qty > 0),
  price_clp        INTEGER,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  is_available     INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

-- user_id es nullable: el checkout no exige login (WhatsApp directo), pero
-- si hay sesión activa el pedido queda asociado igual. customer_name/phone
-- quedan siempre en la fila (desnormalizados) porque son la fuente de verdad
-- para pedidos anónimos, no solo un espejo de users.
-- status usa el vocabulario del Excel de ventas del dueño (pago y entrega
-- mezclados a propósito, es como él controla el negocio); 'cancelado' se
-- agregó para no perder el historial de pedidos que no se concretan.
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name     TEXT NOT NULL DEFAULT '',
  customer_phone    TEXT,
  status            TEXT NOT NULL DEFAULT 'pendiente_pago'
                      CHECK(status IN ('pagado','pendiente_pago','pendiente_entrega','entregado','cortesia','cancelado')),
  delivery          TEXT NOT NULL DEFAULT 'retiro'
                      CHECK(delivery IN ('retiro', 'despacho')),
  address           TEXT,
  date_hint         TEXT,
  notes             TEXT,
  total_clp         INTEGER,
  quantity_hallacas INTEGER NOT NULL DEFAULT 0,
  payment_method    TEXT CHECK(payment_method IN ('cuenta_vista','efectivo') OR payment_method IS NULL),
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
