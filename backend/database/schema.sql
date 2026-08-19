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

-- Parámetros globales del negocio (fila única, id=1). price_per_hallaca sigue
-- vigente. cost_per_hallaca y hallacas_producidas quedan DEPRECADAS: el costo
-- sale de production_batches y el stock de stock_movements (ver más abajo). No
-- se borran las columnas para evitar otro swap de tabla (decisión plan 04).
-- QA-16 / ADR-3: estas dos columnas ya no se leen para calcular disponibilidad
-- ni costo.
CREATE TABLE IF NOT EXISTS settings (
  id                  INTEGER PRIMARY KEY CHECK(id = 1),
  price_per_hallaca   INTEGER NOT NULL DEFAULT 4000,
  cost_per_hallaca    INTEGER NOT NULL DEFAULT 4000,
  hallacas_producidas INTEGER NOT NULL DEFAULT 0
);

-- QA-16: producción por tandas/lotes — eventos de producción con su propia info
-- (fecha, cantidad, costo).
-- ADR-3 (plan 09): esta tabla es SÓLO el registro de COSTOS (inversión, costo
-- por hallaca, ganancia, margen). NO participa en el cálculo del stock ni de la
-- disponibilidad — ese dato vive en stock_movements (invariante I-1). No volver
-- a derivar el stock desde acá: es el bug que se revisó tres veces.
CREATE TABLE IF NOT EXISTS production_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  produced_at    TEXT NOT NULL DEFAULT (date('now','localtime')),
  quantity       INTEGER NOT NULL CHECK(quantity > 0),
  cost_total_clp INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
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
-- QA-16: 'entregado'/'pendiente_entrega' salen del enum de status — la entrega
-- pasa a ser su propia columna (delivered_at), no un estado de pago.
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name     TEXT NOT NULL DEFAULT '',
  customer_phone    TEXT,
  status            TEXT NOT NULL DEFAULT 'pendiente_pago'
                      CHECK(status IN ('pagado','pendiente_pago','cortesia','cancelado')),
  delivery          TEXT NOT NULL DEFAULT 'retiro'
                      CHECK(delivery IN ('retiro', 'despacho')),
  address           TEXT,
  date_hint         TEXT,
  notes             TEXT,
  total_clp         INTEGER,
  quantity_hallacas INTEGER NOT NULL DEFAULT 0,
  payment_method    TEXT CHECK(payment_method IN ('cuenta_vista','efectivo') OR payment_method IS NULL),
  source            TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web', 'admin')),
  -- QA-16: la entrega deja de ser un estado y pasa a ser su propia columna
  delivered_at      TEXT,
  -- QA-16/ADR-2: tanda a la que se atribuye la venta (informes por tanda).
  -- Se asigna en el INSERT a la tanda vigente; NULL si no había tandas.
  batch_id          INTEGER REFERENCES production_batches(id) ON DELETE SET NULL,
  -- H-2 (auditoría 10, ADR-3): pedido compuesto SÓLO por packs por encargo
  -- (price_clp NULL, "Diciembre completo"). Todavía no es una promesa de venta
  -- —cantidad, precio y fecha se coordinan por WhatsApp— así que NO descuenta
  -- del stock. Se congela en el INSERT (no se deriva de order_items) para que
  -- ponerle precio al pack más adelante no cambie de bando las ventas viejas.
  stock_exempt      INTEGER NOT NULL DEFAULT 0 CHECK(stock_exempt IN (0, 1)),
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

-- ADR-3 (plan 09): EL STOCK ES UN DATO PROPIO, no una fórmula sobre las tandas.
-- Ingresos y egresos de hallacas con motivo obligatorio a nivel de esquema: el
-- negocio necesita el porqué de cada movimiento, no sólo el número.
--
-- batch_ref NO lleva FOREIGN KEY a propósito: es una etiqueta histórica de qué
-- tanda originó el ingreso, NO un vínculo vivo. Borrar o editar la tanda no
-- puede tocar el stock (invariante I-1). No cambiar esto por una FK "prolija".
CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT    NOT NULL DEFAULT (date('now','localtime')),
  delta       INTEGER NOT NULL CHECK(delta <> 0),
  reason      TEXT    NOT NULL CHECK(length(trim(reason)) >= 3),
  kind        TEXT    NOT NULL DEFAULT 'ajuste' CHECK(kind IN ('ajuste','tanda')),
  batch_ref   INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_fecha ON stock_movements(occurred_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS orders_updated_at
  AFTER UPDATE ON orders
BEGIN
  UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
END;
