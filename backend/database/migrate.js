/**
 * Migraciones idempotentes para traer al día bases de datos creadas con
 * versiones anteriores del schema. `schema.sql` define la forma final (las
 * instalaciones nuevas la obtienen directo); cada función de acá detecta si
 * una DB vieja necesita el cambio y lo aplica una sola vez.
 *
 * SQLite no permite relajar un NOT NULL, cambiar una FK ni editar un CHECK
 * con ALTER TABLE, así que esos casos siguen el patrón oficial: crear tabla
 * nueva → copiar datos (mapeando valores si cambió el vocabulario) → drop →
 * rename, todo dentro de una transacción y con foreign_keys=OFF mientras
 * dura el swap (se re-activa al terminar).
 */

const { normalizePhone } = require('../utils/phone');

// QA-16: 'entregado'/'pendiente_entrega' salen del enum — la entrega pasa a
// ser su propia columna (orders.delivered_at), no un estado de pago.
/** Estados del Excel del dueño. 'cancelado' es nuestro, para no borrar filas. */
const ORDER_STATUSES = "'pagado','pendiente_pago','cortesia','cancelado'";

// QA-16: mapa histórico actualizado — 'entregado'/'pendiente_entrega' ya no
// existen en el enum final. Estas DBs legadas (enum estilo e-commerce) eran
// solo de desarrollo, así que se mapean directo al enum final sin distinguir
// pago/entrega: delivered/shipped/confirmed/preparing → 'pagado' (ya se dio
// por completada la venta), pending → 'pendiente_pago', cancelled → 'cancelado'.
const STATUS_MAP_SQL = `
  CASE status
    WHEN 'pending'   THEN 'pendiente_pago'
    WHEN 'confirmed' THEN 'pagado'
    WHEN 'preparing' THEN 'pagado'
    WHEN 'shipped'   THEN 'pagado'
    WHEN 'delivered' THEN 'pagado'
    WHEN 'cancelled' THEN 'cancelado'
    ELSE status
  END`;

const ORDERS_FINAL_SQL = `
  CREATE TABLE orders_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    customer_name     TEXT NOT NULL DEFAULT '',
    customer_phone    TEXT,
    status            TEXT NOT NULL DEFAULT 'pendiente_pago'
                        CHECK(status IN (${ORDER_STATUSES})),
    delivery          TEXT NOT NULL DEFAULT 'retiro'
                        CHECK(delivery IN ('retiro', 'despacho')),
    address           TEXT,
    date_hint         TEXT,
    notes             TEXT,
    total_clp         INTEGER,
    quantity_hallacas INTEGER NOT NULL DEFAULT 0,
    payment_method    TEXT CHECK(payment_method IN ('cuenta_vista','efectivo') OR payment_method IS NULL),
    source            TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web', 'admin')),
    delivered_at      TEXT,
    batch_id          INTEGER REFERENCES production_batches(id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );`;

const ORDERS_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS orders_updated_at
    AFTER UPDATE ON orders
  BEGIN
    UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
  END;`;

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all();
}

function tableSql(db, table) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table);
  return row?.sql || '';
}

/** Ejecuta un swap de tabla con FKs apagadas y en transacción. */
function withTableSwap(db, fn) {
  db.pragma('foreign_keys = OFF');
  db.transaction(fn)();
  db.pragma('foreign_keys = ON');
}

/* ---- orders: versión más vieja (user_id NOT NULL, sin customer_name) ---- */
function migrateOrdersLegacy(db) {
  const cols = tableColumns(db, 'orders');
  if (cols.some((c) => c.name === 'customer_name')) return;

  console.log('→ Migrando tabla orders (pedidos anónimos + campos de venta)...');
  withTableSwap(db, () => {
    db.exec(`
      ${ORDERS_FINAL_SQL}

      -- Pedidos viejos siempre tenían user_id NOT NULL: heredamos nombre/teléfono
      -- desde users. quantity_hallacas queda en 0 (dato histórico no capturado antes).
      INSERT INTO orders_new (
        id, user_id, customer_name, customer_phone, status, delivery,
        date_hint, notes, total_clp, quantity_hallacas, source, created_at, updated_at
      )
      SELECT o.id, o.user_id, u.name, u.phone, ${STATUS_MAP_SQL.replaceAll('status', 'o.status')},
             o.delivery, o.date_hint, o.notes, o.total_clp, 0, 'web', o.created_at, o.updated_at
      FROM orders o
      JOIN users u ON u.id = o.user_id;

      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;
      ${ORDERS_TRIGGER_SQL}
    `);
  });
  console.log('✓ Tabla orders migrada.');
}

/* ---- orders: columna address (para DBs que migraron antes de existir) ---- */
function addOrdersAddressColumn(db) {
  const cols = tableColumns(db, 'orders');
  if (cols.some((c) => c.name === 'address')) return;

  console.log('→ Agregando columna orders.address (dirección de despacho)...');
  db.exec('ALTER TABLE orders ADD COLUMN address TEXT');
  console.log('✓ Columna orders.address agregada.');
}

/* ---- orders: enum de status viejo → vocabulario del Excel ---- */
function migrateOrdersStatusEnum(db) {
  // El CHECK no se puede leer por PRAGMA; lo detectamos en el SQL de creación.
  if (tableSql(db, 'orders').includes('pendiente_pago')) return;

  console.log('→ Migrando orders.status al vocabulario del Excel (pagado/pendiente_pago/...)...');
  withTableSwap(db, () => {
    db.exec(`
      ${ORDERS_FINAL_SQL}

      INSERT INTO orders_new (
        id, user_id, customer_name, customer_phone, status, delivery, address,
        date_hint, notes, total_clp, quantity_hallacas, payment_method, source,
        created_at, updated_at
      )
      SELECT id, user_id, customer_name, customer_phone, ${STATUS_MAP_SQL},
             delivery, address, date_hint, notes, total_clp, quantity_hallacas,
             payment_method, source, created_at, updated_at
      FROM orders;

      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;
      ${ORDERS_TRIGGER_SQL}
    `);
  });
  console.log('✓ orders.status migrado.');
}

/* ---- production_batches: QA-16, tandas de producción (eventos, no contador) ---- */
function createProductionBatchesTable(db) {
  // QA-16: producción por tandas/lotes — eventos de producción con su propia
  // info (fecha, cantidad, costo). ADR-3 (plan 09): tabla de COSTOS solamente,
  // el stock NO se deriva de acá (vive en stock_movements, invariante I-1).
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_batches (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      produced_at    TEXT NOT NULL DEFAULT (date('now','localtime')),
      quantity       INTEGER NOT NULL CHECK(quantity > 0),
      cost_total_clp INTEGER NOT NULL DEFAULT 0,
      notes          TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/* ---- stock_movements: ADR-3 (plan 09), el stock como dato propio ---- */
function createStockMovementsTable(db) {
  const exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stock_movements'"
  ).get();
  if (exists) return;

  console.log('→ Creando tabla stock_movements (ADR-3, plan 09)...');
  // ADR-3: el stock deja de derivarse de production_batches y pasa a vivir en
  // su propia tabla de movimientos. Nace VACÍA a propósito: no se migran las
  // tandas existentes a movimientos (en local se parte de 0; en producción
  // production_batches queda vacía tras el wipe D-0). Si hiciera falta un
  // punto de partida, la vía correcta es un ingreso manual con motivo
  // "Saldo inicial de temporada", no una migración automática.
  //
  // batch_ref sin FOREIGN KEY es intencional (invariante I-1): borrar o editar
  // una tanda no puede alcanzar al stock. No "arreglarlo" con ON DELETE CASCADE.
  db.exec(`
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
  `);
  console.log('✓ Tabla stock_movements creada.');
}

/* ---- orders: columna delivered_at (QA-16, la entrega deja de ser un status) ---- */
function addOrdersDeliveredAtColumn(db) {
  const cols = tableColumns(db, 'orders');
  if (cols.some((c) => c.name === 'delivered_at')) return;

  console.log('→ Agregando columna orders.delivered_at (entrega, QA-16)...');
  // QA-16: la entrega deja de ser un estado y pasa a ser su propia columna
  db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT');
  console.log('✓ Columna orders.delivered_at agregada.');
}

/* ---- orders: columna batch_id (QA-16/ADR-2, atribución de venta a tanda) ---- */
function addOrdersBatchIdColumn(db) {
  const cols = tableColumns(db, 'orders');
  if (cols.some((c) => c.name === 'batch_id')) return;

  console.log('→ Agregando columna orders.batch_id (tanda de la venta, QA-16)...');
  // QA-16/ADR-2: tanda a la que se atribuye la venta (informes por tanda).
  // Se asigna en el INSERT a la tanda vigente; NULL si no había tandas.
  db.exec('ALTER TABLE orders ADD COLUMN batch_id INTEGER REFERENCES production_batches(id) ON DELETE SET NULL');
  console.log('✓ Columna orders.batch_id agregada.');
}

/* ---- orders: columna stock_exempt (H-2 auditoría 10, ADR-3) ---- */
function addOrdersStockExemptColumn(db) {
  const cols = tableColumns(db, 'orders');
  if (cols.some((c) => c.name === 'stock_exempt')) return;

  console.log('→ Agregando columna orders.stock_exempt (encargos fuera del stock, H-2)...');
  // H-2/ADR-3: pedidos sólo por encargo no descuentan del stock. Los pedidos
  // históricos quedan en 0 (comportamiento anterior: descontaban), que es lo
  // correcto — sólo los encargos nuevos nacen exentos.
  db.exec('ALTER TABLE orders ADD COLUMN stock_exempt INTEGER NOT NULL DEFAULT 0');
  console.log('✓ Columna orders.stock_exempt agregada.');
}

/* ---- orders: swap final del enum de status (QA-16, sacar entregado/pendiente_entrega) ---- */
function migrateOrdersFinalStatusEnum(db) {
  // El CHECK no se puede leer por PRAGMA; lo detectamos en el SQL de creación.
  if (!tableSql(db, 'orders').includes('entregado')) return;

  console.log('→ Migrando orders.status: sacando entregado/pendiente_entrega (QA-16)...');
  // QA-16: SIN mapeo de datos históricos (decisión de Anthony, 2026-07-15) — la
  // Fase 0 (wipe de ventas de prueba) dejó orders vacía en producción, así que
  // el INSERT copia las columnas tal cual. Si hubiera filas con estado viejo
  // acá, es señal de que el wipe no corrió: detenerse y avisar antes de seguir.
  const stale = db.prepare(
    "SELECT COUNT(*) AS n FROM orders WHERE status IN ('entregado','pendiente_entrega')"
  ).get().n;
  if (stale > 0) {
    throw new Error(
      `migrateOrdersFinalStatusEnum: ${stale} orden(es) con status 'entregado'/'pendiente_entrega'. ` +
      'El wipe de la Fase 0 (D-0) no corrió sobre esta base. Deteniendo la migración — avisar al arquitecto.'
    );
  }

  withTableSwap(db, () => {
    db.exec(`
      ${ORDERS_FINAL_SQL}

      INSERT INTO orders_new (
        id, user_id, customer_name, customer_phone, status, delivery, address,
        date_hint, notes, total_clp, quantity_hallacas, payment_method, source,
        delivered_at, batch_id, created_at, updated_at
      )
      SELECT id, user_id, customer_name, customer_phone, status, delivery, address,
             date_hint, notes, total_clp, quantity_hallacas, payment_method, source,
             delivered_at, batch_id, created_at, updated_at
      FROM orders;

      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;
      ${ORDERS_TRIGGER_SQL}
    `);
  });
  console.log('✓ orders.status migrado (entregado/pendiente_entrega retirados).');
}

/* ---- users: login por teléfono (phone UNIQUE, email opcional, address) ---- */
function migrateUsersTable(db) {
  const cols = tableColumns(db, 'users');
  const emailCol = cols.find((c) => c.name === 'email');
  const hasAddress = cols.some((c) => c.name === 'address');
  if (hasAddress && emailCol && emailCol.notnull === 0) return;

  console.log('→ Migrando tabla users (login por teléfono, email opcional)...');
  withTableSwap(db, () => {
    db.exec(`
      CREATE TABLE users_new (
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

      -- Los usuarios legado (registrados por email, sin teléfono) conservan su
      -- fila con phone NULL: no pueden entrar hasta re-registrarse o que se les
      -- asigne teléfono (decisión del plan: base de usuarios aún muy chica).
      INSERT INTO users_new (id, name, phone, email, password_hash, address, role, created_at)
      SELECT id, name, phone, email, password_hash, NULL, role, created_at FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  });

  // Normalizar teléfonos existentes a +56XXXXXXXXX; los ilegibles quedan NULL
  // (equivalen a "sin teléfono": ese usuario re-registra o el admin lo corrige).
  const users = db.prepare('SELECT id, phone FROM users WHERE phone IS NOT NULL').all();
  const update = db.prepare('UPDATE users SET phone = ? WHERE id = ?');
  for (const u of users) {
    const normalized = normalizePhone(u.phone);
    if (normalized !== u.phone) update.run(normalized, u.id);
  }
  console.log('✓ Tabla users migrada.');
}

/* ---- seeds: settings (fila única) y packs (desde src/data/packs.js) ---- */
function seedSettings(db) {
  db.prepare(`
    INSERT OR IGNORE INTO settings (id, price_per_hallaca, cost_per_hallaca, hallacas_producidas)
    VALUES (1, 4000, 4000, 0)
  `).run();
}

// Espejo de src/data/packs.js (el frontend es ESM y esto CommonJS, no se puede
// importar directo). Tras el seed, la BD es la fuente de verdad y packs.js
// queda solo como fallback visual si la API no responde.
const PACKS_SEED = [
  {
    id: 'p1', name: 'Una probadita', qty: 1, qty_label: '1 hallaca', price_clp: 3500,
    tag: 'Para ti', tagline: 'Perfecta para conocer el sabor.',
    description: 'Una hallaca tradicional venezolana, hecha a mano con masa de maíz teñida con onoto, guiso de res, cerdo y pollo, aceitunas, alcaparras, pasitas y aliños frescos. Envuelta en hoja de plátano y amarrada con pabilo, como manda la tradición.',
    ingredients: ['Masa de maíz', 'Onoto', 'Guiso mixto', 'Aceitunas', 'Pasitas', 'Hoja de plátano'],
    image: 'https://i.ibb.co/v62n8w2B/b064c458a44e20aeda58f5ae48a2e546.jpg',
  },
  {
    id: 'p4', name: 'Cena íntima', qty: 4, qty_label: '4 hallacas', price_clp: 13000,
    tag: 'Popular', tagline: 'Para una cena en pareja o entre dos.',
    description: 'Cuatro hallacas envueltas en hoja de plátano, listas para calentar al baño maría. Vienen con pan de jamón en porción y un toque de ensalada de gallina si lo pides extra. Suficiente para una cena sentada para dos personas con sobras al día siguiente.',
    ingredients: ['4 hallacas', 'Pan de jamón', 'Hoja de plátano', 'Pabilo tradicional'],
    image: 'https://i.ibb.co/m5xVgYsW/60194f47fd48bb2bc2fefe1c651d412e.jpg',
  },
  {
    id: 'p10', name: 'Cena familiar', qty: 10, qty_label: '10 hallacas', price_clp: 32000,
    tag: 'Mejor valor', tagline: 'El plato fuerte de la mesa familiar.',
    description: 'Diez hallacas para una mesa de familia. Incluye pan de jamón completo, ensalada de gallina y un pernil pequeño para acompañar — la cena navideña venezolana clásica, lista para servir. Ideal para 5–6 personas con segundo plato al día siguiente.',
    ingredients: ['10 hallacas', 'Pan de jamón entero', 'Ensalada de gallina', 'Pernil pequeño'],
    image: 'https://i.ibb.co/JF8jdwxg/f06f9930c92b0ff9b5f0754d1464d89e.jpg',
  },
  {
    id: 'pXL', name: 'Diciembre completo', qty: 10, qty_label: '+10 hallacas', price_clp: null,
    tag: 'Por encargo', tagline: 'Para que tu casa huela a Caracas en diciembre.',
    description: 'Pedido grande — más de 10 hallacas. Cuéntanos cuántas necesitas y coordinamos contigo cantidad, retiro o despacho y precio. Ideal para encuentros familiares grandes, fiestas de fin de año o regalos para tu gente. Pedido con 5 días de anticipación.',
    ingredients: ['10+ hallacas', 'Misma receta tradicional', 'Coordinación directa', 'Entrega o retiro'],
    image: 'https://i.ibb.co/LdGZg9fN/a73918b40d264892fb9b81da7fce9846.jpg',
  },
];

function seedPacks(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM packs').get().n;
  if (count > 0) return;

  console.log('→ Sembrando catálogo de packs desde packs.js...');
  const insert = db.prepare(`
    INSERT INTO packs (id, name, qty_label, tag, tagline, description, image, qty, price_clp, ingredients_json, sort_order)
    VALUES (@id, @name, @qty_label, @tag, @tagline, @description, @image, @qty, @price_clp, @ingredients_json, @sort_order)
  `);
  db.transaction(() => {
    PACKS_SEED.forEach((p, i) => {
      insert.run({ ...p, ingredients_json: JSON.stringify(p.ingredients), sort_order: i });
    });
  })();
  console.log('✓ Packs sembrados.');
}

function runMigrations(db) {
  // Legadas (DBs muy viejas) primero, luego QA-16 (D-1 → D-2 → D-3), luego seeds.
  migrateOrdersLegacy(db);
  addOrdersAddressColumn(db);
  migrateOrdersStatusEnum(db);
  migrateUsersTable(db);
  createProductionBatchesTable(db);
  createStockMovementsTable(db);
  addOrdersDeliveredAtColumn(db);
  addOrdersBatchIdColumn(db);
  migrateOrdersFinalStatusEnum(db);
  // Después del swap final (que recrea orders sin esta columna): puramente
  // aditiva e independiente del enum de status.
  addOrdersStockExemptColumn(db);
  seedSettings(db);
  seedPacks(db);
}

module.exports = { runMigrations };
