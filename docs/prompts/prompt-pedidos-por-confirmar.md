# Prompt: pedidos por confirmar, límite por teléfono, encargos y avisos por Telegram

> Pega todo este texto en una sesión local de Claude Code abierta en la raíz del repo `onotoYSazon`.

---

## 0. Contexto y reglas de trabajo

Eres el orquestador de un cambio en Onoto y Sazón: SPA React 19 + Webpack en `src/`, y backend Express + better-sqlite3 en `backend/`. El stock se calcula al vuelo según ADR-3:

`stock = Σ stock_movements.delta − Σ orders.quantity_hallacas`, contando solo pedidos vivos con `stock_exempt = 0`.

**Objetivo de negocio.** Hoy cualquier pedido web reserva stock para siempre y nadie lo valida. Queremos:

1. Que el pedido web quede **por confirmar**. Reserva stock de forma provisional durante **24 h**. Si el dueño no lo confirma en ese plazo, **vence solo** y libera el stock.
2. **Máximo 20 hallacas por número de celular** en pedidos web activos. Aplica igual con o sin cuenta.
3. Si el pedido supera ese límite o el stock disponible, la web **no lo acepta**. Muestra: **«Para un pedido así, ponte en contacto directo con el vendedor.»** junto con un botón de WhatsApp.
4. Los pedidos grandes los registra **el dueño desde el panel** como **encargo para una próxima tanda**. El encargo no descuenta stock hasta que se concreta.
5. **Aviso al dueño por Telegram**:
   - cuando entra un pedido web;
   - cuando a un pedido le quedan pocas horas para vencer;
   - cuando un pedido vence.

   Así el dueño se entera aunque el cliente no le escriba por WhatsApp. El mensaje incluye un enlace `wa.me` directo al cliente.
6. Corregir lo que hoy permite sobreventa: reactivar o editar pedidos sin revisar stock, y transacciones diferidas.

**Fuera de alcance:** pagos online (Mercado Pago). No agregues pasarelas de pago.

**Reglas obligatorias:**
- Rama nueva desde `main`:
  - `git checkout main && git pull`
  - `git checkout -b feature/pedidos-por-confirmar`
- Antes de tocar código, lee:
  - `backend/database/schema.sql`
  - `backend/database/migrate.js`
  - `backend/database/db.js`
  - `backend/controllers/{orders,admin,packs,stock,batches}.controller.js`
  - `backend/routes/{orders,admin}.routes.js`
  - `backend/middleware/rateLimiter.js`
  - `backend/server.js`
  - `src/App.jsx`
  - `src/services/api.js`
  - `src/components/{Sections,AdminDashboard,OrderTransition}.jsx`
  - `src/data/socials.js`
- **Respeta los invariantes existentes:**
  - **I-1:** las tandas no calculan stock; borrarlas o editarlas no mueve el stock.
  - **H-2:** `stock_exempt` se congela en el INSERT.
  - **H-1:** el carrito no se vacía si el pedido falla.
  - El backend recalcula precio y hallacas desde la BD y nunca confía en el cliente.
  - Los topes R-5 y QA-15 siguen vigentes (10.000 hallacas y 99 por ítem).
- Sigue el estilo de comentarios del repo: explica el *porqué* y etiqueta con `PLAN-11`.
- **No hagas commit de** `backend/.env`, `*.db`, `node_modules`.
- Commits pequeños por fase, con mensajes claros en español.
- **Cada fase termina con sus validaciones en verde.** Si una falla, corrige antes de avanzar. No desactives ni saltes tests para que pasen.

### Uso de agentes

Los agentes de `.claude/agents/` (`architect`, `backend`, `frontend`) solo tienen `Read, Glob, Bash`, así que **no pueden editar archivos con Edit/Write**. Elige una de estas dos opciones:
- **Opción A (recomendada):** la sesión principal implementa. Los agentes revisan y verifican, sin editar.
- **Opción B:** añade `Edit, Write` a la línea `tools:` de `backend.md` y `frontend.md` antes de delegarles implementación.

| Fase | Quién | Modelo sugerido |
|---|---|---|
| 1. Diseño / ADR | `architect` | Opus |
| 2. Backend: BD y migración | sesión principal (o `backend` con opción B) | Opus |
| 3. Backend: reglas de pedidos y stock | sesión principal (o `backend`) | Opus |
| 4. Backend: notificaciones Telegram | `backend` | Sonnet (high) |
| 5. Tests backend | sesión principal | Opus |
| 6. Frontend: checkout y carrito | `frontend` | Sonnet (high) |
| 7. Frontend: panel admin | `frontend` | Sonnet (high) |
| 8. Revisión cruzada | `architect` (solo lectura) | Opus |
| 9. Prueba E2E en navegador | `general-purpose` con Playwright | Sonnet (high) |
| 10. Post-deploy | `deploy-verificador` | Sonnet |

---

## 1. Decisiones de diseño (cerradas)

| # | Decisión |
|---|---|
| D1 | No se cambia el `CHECK` de `orders.status`. Se añaden columnas con `ALTER TABLE ... ADD COLUMN`, sin swap de tabla. |
| D2 | **Estado de revisión derivado**, no guardado:<br>• `confirmado` si `confirmed_at IS NOT NULL`<br>• `por_confirmar` si `confirmed_at IS NULL AND expires_at > datetime('now')`<br>• `vencido` si `confirmed_at IS NULL AND expires_at <= datetime('now')`<br>Así el vencimiento no depende de un cron: se evalúa en cada consulta. |
| D3 | **Pedido vivo** (cuenta para stock, reportes y kardex) = `status != 'cancelado' AND (confirmed_at IS NOT NULL OR expires_at > datetime('now'))`. Este fragmento SQL debe vivir en **un solo lugar** (ver §3.1). |
| D4 | Todas las fechas nuevas se guardan en **UTC** con `datetime('now')`, igual que `created_at`. La UI convierte a hora local con `formatLocalDate` (`AdminDashboard.jsx`). |
| D5 | Duración de la reserva: `ORDER_HOLD_HOURS` (por defecto **24**). Aviso previo: `ORDER_REMINDER_HOURS_BEFORE` (por defecto **4**). |
| D6 | Límite por teléfono: `MAX_HALLACAS_POR_TELEFONO` (por defecto **20**).<br>• Suma las hallacas de pedidos **web** (`source = 'web'`) del mismo teléfono normalizado. Si el request trae sesión, suma también los del mismo `user_id`.<br>• Solo cuentan pedidos **vivos** (D3) y **no entregados** (`delivered_at IS NULL`).<br>• Incluye encargos web (`stock_exempt = 1`, pack `pXL`).<br>• Se valida contra `suma_actual + hallacas_del_pedido_nuevo`. |
| D7 | Ventas manuales del admin (`source = 'admin'`): nacen **confirmadas** (`confirmed_at = datetime('now')`), sin `expires_at`, y **no** tienen el límite de 20. |
| D8 | **Encargo para próxima tanda** = venta manual con `encargo: true`, que se guarda con `stock_exempt = 1`. Se concreta con el flujo `confirmStock` que ya existe, cuando hay stock. |
| D9 | El rechazo por límite o falta de stock responde **409** con `{ error, code }`:<br>• `code` es `'LIMITE_TELEFONO'` o `'SIN_STOCK'`.<br>• `error` es exactamente: `Para un pedido así, ponte en contacto directo con el vendedor.` |
| D10 | En el panel, cualquier operación que **aumente** la reserva sin stock suficiente responde **409** `{ code: 'STOCK_INSUFICIENTE', stock, requerido }`. Esto aplica a confirmar un vencido, reactivar un cancelado, subir la cantidad o hacer una venta manual. El admin puede reenviar con `force: true`, previa confirmación en la UI («registrar la realidad»). |
| D11 | Telegram: si faltan `TELEGRAM_BOT_TOKEN` o `TELEGRAM_CHAT_ID`, el notificador **no hace nada** (solo `console.info`). Un fallo de Telegram **nunca** hace fallar un pedido. Se envía **texto plano**, sin `parse_mode`, para evitar inyección de formato. |
| D12 | Se quita `.escape()` de `address` y `notes` en `orders.routes.js`. React ya escapa al mostrar y Telegram va en texto plano. Los datos antiguos ya escapados no se migran. |
| D13 | **Canal de notificación: bot de Telegram, elegido por el dueño. Es la decisión cerrada.** No implementes correo, WhatsApp API, ntfy, web push ni otros canales, ni dejes "adaptadores" para ellos. `backend/services/notify.js` habla solo con la Bot API de Telegram. El ADR-4 debe registrar esta decisión y las alternativas descartadas: ntfy, correo y WhatsApp Cloud API, esta última porque exige cuenta Business verificada y plantillas pagadas. |

---

## 2. Fase 1 — Diseño (agente `architect`, solo lectura)

**Tarea:** revisar este prompt contra el código real y redactar `docs/adr/ADR-4-pedidos-por-confirmar.md` (crea `docs/adr/`) con:
- contexto;
- decisiones D1–D13 (incluido Telegram como canal de avisos);
- el diagrama de estados `por_confirmar → confirmado | vencido`, `vencido → confirmado` (reactivación) y `cualquiera → cancelado`;
- cómo cambia la fórmula del stock;
- riesgos.

**Validaciones de la fase:**
- [ ] El ADR enumera **todos** los lugares donde hoy se filtra `status != 'cancelado'` (ver §3.1) y confirma que no hay más (`grep -rn "cancelado" backend`).
- [ ] Revisa el orden de `runMigrations()` en `migrate.js` y confirma en qué posición va la migración nueva.
- [ ] Confirma que `migrateOrdersFinalStatusEnum` corre **antes** de `addOrdersStockExemptColumn` y de la migración nueva. Si es así, no hay pérdida de columnas y `ORDERS_FINAL_SQL` no se toca (ver §3.2).
- [ ] Confirma la invariante del backfill (§3.2): ningún INSERT de `orders` deja `confirmed_at` **y** `expires_at` ambos en NULL después del cambio. Revisa `createOrder` y `createManualSale`, y busca `grep -rn "INSERT INTO orders" backend`.

---

## 3. Fase 2 y 3 — Backend

### 3.1 Módulo central de estado del pedido

Crear `backend/utils/orderState.js` con:

```js
// PLAN-11: única definición de "pedido vivo" y del estado de revisión.
const LIVE_ORDER_SQL = "status != 'cancelado' AND (confirmed_at IS NOT NULL OR expires_at > datetime('now'))";
function holdHours()      { /* ORDER_HOLD_HOURS, entero 1..168, default 24 */ }
function reminderHours()  { /* ORDER_REMINDER_HOURS_BEFORE, entero 0..holdHours-1, default 4 */ }
function maxPorTelefono() { /* MAX_HALLACAS_POR_TELEFONO, entero 1..10000, default 20 */ }
function reviewState(row) { /* 'confirmado' | 'por_confirmar' | 'vencido' — compara en UTC */ }
module.exports = { LIVE_ORDER_SQL, holdHours, reminderHours, maxPorTelefono, reviewState };
```

- Los valores inválidos de las variables de entorno caen al valor por defecto, con un `console.warn` al arrancar.
- `reviewState` debe parsear `expires_at` como UTC: `new Date(expires_at.replace(' ', 'T') + 'Z')`.

**Reemplaza `status != 'cancelado'` por `${LIVE_ORDER_SQL}` en todas estas ubicaciones** (verifica los números de línea, pueden haberse movido):

| Archivo | Línea aprox. | Consulta |
|---|---|---|
| `packs.controller.js` | 29 | `getStock` (comprometidas) |
| `packs.controller.js` | 52 | `getStockBreakdown` (comprometidas) |
| `packs.controller.js` | 56 | `getStockBreakdown` (entregadas) |
| `stock.controller.js` | 55 | kardex: ventas vivas |
| `stock.controller.js` | 92 | encargos por coordinar |
| `admin.controller.js` | 460 | reportes: ventas |
| `admin.controller.js` | 465 | reportes: por método |
| `admin.controller.js` | 479 | reportes: montos |
| `admin.controller.js` | 486 | reportes: ventas de hoy |
| `admin.controller.js` | 506 | reportes: encargos |

- En reportes, `porEstado` (`... WHERE stock_exempt = 0 GROUP BY status`) debe sumar además los contadores `por_confirmar` y `vencidos`.
- Añadir al payload de `/admin/reports`:
  - `por_confirmar: { n, hallacas }`
  - `vencidos: { n, hallacas }`

### 3.2 Esquema y migración

**`schema.sql`**, tabla `orders` (instalaciones nuevas): añadir estas columnas, con comentario `PLAN-11`:

```sql
confirmed_at        TEXT,   -- NULL = aún no validado por el dueño (solo web)
expires_at          TEXT,   -- UTC; vence la reserva provisional del pedido web
reminder_sent_at    TEXT,   -- aviso "por vencer" ya enviado (idempotencia)
expired_notified_at TEXT,   -- aviso "vencido" ya enviado (idempotencia)
```

Más los índices:

```sql
CREATE INDEX IF NOT EXISTS idx_orders_phone  ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_review ON orders(confirmed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
```

**`migrate.js`**: nueva función `addOrdersReviewColumns(db)`, que se registra **al final** de `runMigrations()`:
- Para cada columna, si no existe en `PRAGMA table_info('orders')`, ejecuta `ALTER TABLE orders ADD COLUMN ...`.
- **Backfill de pedidos legados (detalle crítico):** ejecutar en **cada** arranque, dentro de una transacción:
  ```sql
  UPDATE orders SET confirmed_at = created_at
  WHERE confirmed_at IS NULL AND expires_at IS NULL;
  ```
  Es idempotente y seguro por esta **invariante**: todo pedido web creado con este plan nace con `expires_at` NOT NULL (§3.3), y las ventas manuales nacen con `confirmed_at` fijado (§3.4). Por eso solo una fila anterior al cambio puede tener ambas columnas en NULL. Esas filas ya reservaban stock y deben quedar confirmadas.
  - **No uses** `WHERE confirmed_at IS NULL` a secas: confirmaría automáticamente los pedidos web nuevos y anularía el objetivo del cambio.
  - **No condiciones** el backfill a «la columna se acaba de crear»: es frágil si otra migración recrea la tabla.
- **Esta invariante va en un comentario** junto al INSERT de `createOrder` y junto al backfill.
- Crear los índices con `IF NOT EXISTS`.
- **No toques `ORDERS_FINAL_SQL`** (`migrate.js:37-58`). Ese swap solo corre en BDs muy viejas (`includes('entregado')`) y **antes** de `addOrdersStockExemptColumn` y de la migración nueva, que añaden sus columnas después. Si se le agregaran columnas sin copiarlas en el `INSERT INTO orders_new (...)` explícito, se crearían vacías. Solo añade un comentario `PLAN-11`: cualquier recreación futura de `orders` debe incluir `stock_exempt`, `confirmed_at`, `expires_at`, `reminder_sent_at` y `expired_notified_at`, **y copiarlas** en el INSERT.
- Envolver `withTableSwap` en `try/finally` para que `foreign_keys` vuelva a `ON` aunque falle.
- **`LIVE_ORDER_SQL` usa nombres de columna sin alias.** Úsalo solo en consultas de una tabla (`FROM orders`). Si alguna consulta tiene JOIN, crea una variante con alias `o.` en `orderState.js`.

### 3.3 `createOrder` (web) — `orders.controller.js`

1. Mantener todas las validaciones actuales (pack inexistente o no disponible, mezcla encargo + stock, rangos).
2. Ejecutar dentro de `db.transaction(...).immediate()` (better-sqlite3), en este orden:
   - a) **Límite por teléfono (D6):**
     ```sql
     SELECT COALESCE(SUM(quantity_hallacas),0) AS activas FROM orders
     WHERE source = 'web' AND delivered_at IS NULL AND ${LIVE_ORDER_SQL}
       AND (customer_phone = ? OR (? IS NOT NULL AND user_id = ?))
     ```
     Si `activas + qtyHallacas > maxPorTelefono()`, lanzar 409 `code: 'LIMITE_TELEFONO'`. Aplica también a pedidos solo por encargo (`pXL`).
   - b) **Stock:** solo si no es solo por encargo. Si `qtyHallacas > getStock()`, lanzar 409 `code: 'SIN_STOCK'`.
   - c) **INSERT** con `confirmed_at = NULL` y `expires_at = datetime('now', '+' || ? || ' hours')`, usando `holdHours()`.
3. El texto de error de a) y b) es exactamente `Para un pedido así, ponte en contacto directo con el vendedor.` (D9). El handler de errores debe devolver `{ error, code }` cuando `err.code` exista.
4. Responder 201 con:
   ```js
   {
     message: 'Pedido recibido. Queda reservado por 24 h mientras el vendedor lo confirma por WhatsApp.',
     order: { id, status: 'pendiente_pago', review: 'por_confirmar', expiresAt },
     holdHours,
   }
   ```
   El número 24 sale de `holdHours()`. Para encargos, mantener el texto actual de coordinación.
5. **Después del commit** de la transacción, llamar a `notify.newOrder(order)` sin `await` que bloquee la respuesta, y con `.catch` que solo loguee.
6. `getMyOrders`: incluir `quantity_hallacas`, `confirmed_at`, `expires_at` y `review` (vía `reviewState`).
7. Mapear errores `SQLITE_BUSY*` a 503 `{ error: 'Servidor ocupado, intenta de nuevo.' }`.

### 3.4 Panel admin — `admin.controller.js`

**`getAllOrders`:** devolver además `confirmed_at`, `expires_at` y `review: reviewState(o)`.

**`updateOrder`:** nuevos campos de body, `confirm` (solo `true`) y `force` (boolean). Toda la lógica va dentro de `db.transaction(...).immediate()`:

- **Reserva antes y después:**
  - `reservaAntes` = (el pedido es vivo según D3 **y** `stock_exempt = 0`) ? `quantity_hallacas` : 0
  - `reservaDespues` se calcula con los valores finales:
    - `status` final;
    - `quantity` final;
    - `stock_exempt` final (0 si `confirmStock`);
    - `confirmed_at` final: queda fijado si `confirm === true`, si el `status` final es `pagado` o `cortesia`, o si ya lo estaba.
- **Confirmación implícita:** cambiar `status` a `pagado` o `cortesia` en un pedido `por_confirmar` o `vencido` lo **confirma**. Hay que fijar `confirmed_at = datetime('now')` en el mismo UPDATE.
- **Chequeo de stock (D10):** si `reservaDespues > reservaAntes` y `getStock() < (reservaDespues - reservaAntes)` y `force !== true`, lanzar 409 `{ code: 'STOCK_INSUFICIENTE', stock, requerido }`.
  - Cubre: confirmar un vencido, reactivar un cancelado (`status` de `cancelado` a otro), subir `quantityHallacas`, y `confirmStock`. Unifica el chequeo que hoy existe solo para `confirmStock`.
- **Entrega sin confirmar:** `delivered: true` sobre un pedido no confirmado responde 409 `{ code: 'PEDIDO_NO_CONFIRMADO', error: 'Confirma el pedido antes de marcarlo como entregado.' }`. Se mantiene el 409 existente para encargos exentos.
- **Validación de cantidad:** `quantityHallacas` debe ser `Number.isInteger` y **≥ 1**. Hoy se acepta 0 y strings vía `Number()`; rechaza ambos con 400.
- **Validación de tipos:** `notes` y `customerName` deben ser `typeof 'string'` (o `null` en notes). Si no, 400, no 500.
- **Rechazar** un pedido = `status: 'cancelado'`. No requiere chequeo.

**`createManualSale`:**
- `confirmed_at = datetime('now')`, `expires_at = NULL`.
- Nuevo campo `encargo: boolean`. Si es `true`, `stock_exempt = 1`, el total puede ser `NULL` y no se chequea stock.
- Si **no** es encargo y la venta deja el stock negativo: 409 `STOCK_INSUFICIENTE`, salvo `force: true`. Todo en una transacción `.immediate()`.
- No permitir crear una venta con `status: 'cancelado'` (400).

**`deleteOrder`:** sin cambios de lógica en este plan. Solo validar que `id` sea un entero positivo.

### 3.5 Rate limit y proxy

- `server.js`: añadir `if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);` **antes** de los limiters.
- `rateLimiter.js`: nuevo `orderLimiter` de 10 pedidos por hora por IP, con mensaje en español. Aplicarlo solo a `router.post('/')` en `orders.routes.js`, antes de `optionalAuth`.

### 3.6 Notificaciones por Telegram (Fase 4) — `backend/services/notify.js`

> Método establecido: **bot de Telegram** (D13). Es el único canal de avisos del sistema.

- Usa el `fetch` nativo de Node ≥ 18. No añadas dependencias. Hace `POST https://api.telegram.org/bot<TOKEN>/sendMessage` con `{ chat_id, text, disable_web_page_preview: true }` y un timeout de 5 s (`AbortSignal.timeout(5000)`).
- Funciones:
  - `newOrder(order)`: «🆕 Pedido web #ID — NOMBRE — N hallacas (entrega/retiro) — vence DD/MM HH:MM (hora Chile) — WhatsApp cliente: https://wa.me/56XXXXXXXXX — Panel: PUBLIC_ADMIN_URL». Indica «(encargo)» si `stock_exempt = 1`.
  - `orderExpiringSoon(order)`: «⏳ El pedido #ID de NOMBRE vence en ~X h y aún no está confirmado.» con los mismos enlaces.
  - `orderExpired(order)`: «⌛ El pedido #ID de NOMBRE venció y liberó N hallacas.»
- Formatear la hora con `toLocaleString('es-CL', { timeZone: 'America/Santiago' })`.
- Para el enlace `wa.me`, quitar el `+` de `customer_phone`.
- **Barrido periódico** `startOrderSweeper()`, llamado desde `server.js` solo si `NODE_ENV !== 'test'`. Corre cada 10 minutos y una vez al arrancar:
  - **Por vencer:** `confirmed_at IS NULL AND status != 'cancelado' AND reminder_sent_at IS NULL AND expires_at > datetime('now') AND expires_at <= datetime('now', '+' || reminderHours() || ' hours')`. Notificar y luego `UPDATE reminder_sent_at = datetime('now')`.
  - **Vencidos:** `confirmed_at IS NULL AND status != 'cancelado' AND expired_notified_at IS NULL AND expires_at <= datetime('now')`. Notificar y luego `UPDATE expired_notified_at = datetime('now')`.
  - Marcar **solo si el envío fue OK**. Si Telegram falla, se reintenta en el siguiente barrido.
  - Si no hay token, marcar igual. Así, al configurarlo más tarde, no llega una avalancha de avisos viejos.
- `server.js`: `clearInterval` en `SIGTERM`/`SIGINT`.

### 3.7 Variables de entorno

Añadir a `backend/.env.example`, comentadas:

```
ORDER_HOLD_HOURS=24
ORDER_REMINDER_HOURS_BEFORE=4
MAX_HALLACAS_POR_TELEFONO=20
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
PUBLIC_ADMIN_URL=https://www.onotosazon.cl
TRUST_PROXY=1
TZ=America/Santiago
```

Antes de escribir `PUBLIC_ADMIN_URL`, verifica el dominio real: el repo usa `onotosazon.cl` y `onotoysazon.cl` en distintos sitios.

### 3.8 Exponer el límite al frontend

`GET /api/packs` (`listPublicPacks`) devuelve además:

```js
limits: { maxHallacasPorTelefono: maxPorTelefono(), holdHours: holdHours() }
```

El `stock_available` público pasa a usar `getStock()` con la fórmula nueva (D3).

---

## 4. Fase 5 — Tests backend (obligatorios)

- Añadir `"test": "node --test test/"` en `backend/package.json` y crear `backend/test/`. Sin dependencias nuevas.
- Antes de hacer `require` de `db.js`: `process.env.DB_PATH = ':memory:'`, `process.env.NODE_ENV = 'test'`, `JWT_SECRET` y las variables `ADMIN_*` de prueba.
- Probar los controladores con `req`/`res` falsos (un helper `mockRes()` que capture `status` y `json`).
- Para simular el paso del tiempo: `UPDATE orders SET expires_at = datetime('now','-1 minute') WHERE id = ?`.
- Mockear `fetch` global en los tests del notificador.

**Casos mínimos (todos deben pasar):**

| # | Caso | Esperado |
|---|---|---|
| T1 | Pedido web con stock 50, pide 10 | 201. `confirmed_at` NULL. `expires_at` ≈ ahora+24h (±1 min). `getStock()` = 40 |
| T2 | T1 + vencer | `getStock()` = 50. Kardex no lo incluye. Reportes no lo cuentan. `getAllOrders` → `review: 'vencido'`. `reports.vencidos.n = 1` |
| T3 | Confirmar pedido `por_confirmar` | `confirmed_at` fijado. Stock sin cambio (ya estaba reservado). No vence aunque pase `expires_at` |
| T4a | Confirmar vencido con stock suficiente | 200, vuelve a reservar |
| T4b | Confirmar vencido sin stock | 409 `STOCK_INSUFICIENTE` con `stock` y `requerido` |
| T4c | T4b con `force: true` | 200, stock negativo |
| T5a | Teléfono con 15 activas pide 6 | 409 `LIMITE_TELEFONO` + texto exacto D9 |
| T5b | 15 activas pide 5 | 201 |
| T5c | Pedidos cancelados, vencidos o entregados del mismo teléfono | No cuentan |
| T5d | `912345678`, `+56912345678` y `9 1234 5678` | Cuentan como el mismo teléfono |
| T5e | Usuario logueado | Mismo límite de 20. También suma pedidos por `user_id` aunque haya usado otro teléfono |
| T5f | Ventas manuales (`source='admin'`) del mismo teléfono | No cuentan |
| T6 | Pide más que el stock (con el límite OK) | 409 `SIN_STOCK` + texto exacto D9 |
| T7 | Encargo `pXL` con `quantityHallacas` 21 | 409 `LIMITE_TELEFONO`. Con 20 → 201 y `stock_exempt = 1`, el stock no cambia |
| T8a | Cancelado → `pagado` sin stock | 409. Con `force` → 200 |
| T8b | Subir cantidad sin stock | 409. Bajar cantidad → 200 siempre |
| T8c | `quantityHallacas` 0, `"7"`, `null` | 400 |
| T9 | `status: 'pagado'` sobre un `por_confirmar` | Fija `confirmed_at` |
| T10 | `delivered: true` sobre un no confirmado | 409 `PEDIDO_NO_CONFIRMADO` |
| T11a | Venta manual | `confirmed_at` fijado, `expires_at` NULL, no topada a 20 |
| T11b | Venta manual que deja stock negativo | 409. Con `force` → 201 |
| T11c | Venta manual con `encargo: true` | `stock_exempt = 1`, el stock no cambia. Luego `confirmStock` la concreta con chequeo |
| T11d | Venta manual con `status: 'cancelado'` | 400 |
| T12a | Migración sobre BD con esquema **anterior** (crear `orders` sin las columnas nuevas e insertar 3 pedidos, uno con `stock_exempt = 1`) | Tras `runMigrations`, los 3 tienen `confirmed_at = created_at`. `stock_exempt` se conserva. `getStock()` es igual antes y después de migrar |
| T12b | Un pedido web nuevo + segunda corrida de `runMigrations` | El pedido nuevo **sigue** con `confirmed_at` NULL (tiene `expires_at`, así que el backfill no lo toca) |
| T12c | Swap de tabla | `foreign_keys` queda ON al terminar, incluso si la función interna lanza |
| T12d | BD muy vieja (con `'entregado'` en el CHECK y `orders` vacía) | `runMigrations` completo termina con todas las columnas: `stock_exempt` + las 4 nuevas |
| T13a | Notificador sin token | No llama a `fetch` y no lanza |
| T13b | Notificador con token y `fetch` mockeado | 1 llamada por pedido nuevo. El texto contiene `wa.me/569...` |
| T13c | `fetch` que lanza | El pedido igual responde 201 |
| T13d | Barrido | Envía «por vencer» una sola vez y «vencido» una sola vez (idempotente). Si `fetch` falla, no marca y reintenta en el siguiente barrido |
| T14 | Notas `Av. O'Higgins & <b>x</b>` | Se guardan sin escapar |
| T15 | Invariante I-1 | Borrar o editar una tanda no cambia `getStock()` (test de regresión) |
| T16 | Kardex | El saldo final coincide con `getStock()` en un escenario mixto (movimientos, pedido confirmado, por confirmar, vencido, cancelado, encargo) |

**Validación de la fase:** `cd backend && npm test` sale con 0 fallos. Pega la salida en el resumen final.

---

## 5. Fase 6 — Frontend: checkout y carrito (agente `frontend`)

1. **`src/services/api.js`, `apiFetch`:**
   - Parsear el JSON con seguridad: `const data = await res.json().catch(() => ({}))`.
   - Si `!res.ok`, lanzar un `Error` con `err.status = res.status`, `err.code = data.code` y `err.data = data`.
   - Mensaje por defecto: `'No pudimos conectar con el servidor. Intenta de nuevo.'`.
   - Revisar todos los consumidores: siguen usando `err.message`.
2. **`App.jsx`:**
   - Guardar `limits` desde `/packs`. Respaldo: `{ maxHallacasPorTelefono: 20, holdHours: 24 }` si la API falla o no lo trae.
   - Pasar `limits` al carrito y a `PackModal`.
3. **Carrito (`CartModal` en `Sections.jsx`):**
   - Si `cartHallacas > limits.maxHallacasPorTelefono`, deshabilitar «Confirmar pedido» y mostrar: **«Para un pedido así, ponte en contacto directo con el vendedor.»**
   - Junto al mensaje, un botón WhatsApp hacia `https://wa.me/${WHATSAPP_PHONE}` con texto prellenado del pedido (reutilizar `buildMessage`).
   - Los botones `+` no permiten superar el límite. Reusar el patrón de `StockLimitNotice`.
4. **`PackModal`, pedido por encargo (`pXL`):**
   - Cambiar el tope 1000 (`Sections.jsx` ~343-345, `max="1000"` ~467 y el texto ~473-475) por `limits.maxHallacasPorTelefono`.
   - Texto al superarlo: el mismo mensaje de contacto directo, con botón de WhatsApp.
5. **`OrderTransition.jsx` y el flujo de envío:**
   - Si el error trae `code` `LIMITE_TELEFONO` o `SIN_STOCK`, mostrar el mensaje de D9 y el botón de WhatsApp de contacto directo. No mostrar «Consultar próxima tanda» ni un error técnico. El carrito **no** se vacía (H-1).
   - En éxito, mostrar el `message` del backend, que menciona la reserva de 24 h.
6. Solo para este flujo, cambiar el texto «Consultar próxima tanda» por «Contactar al vendedor».

**Validaciones de la fase:**
- [ ] `npm run build` (raíz) compila sin errores nuevos. Los warnings de tamaño ya existían.
- [ ] `grep -rn "1000" src/components/Sections.jsx` ya no muestra el tope de encargo.
- [ ] `grep -rn "Para un pedido así, ponte en contacto directo con el vendedor." src backend` aparece en el backend (D9) y en los dos puntos del front: carrito y encargo. Sin variantes de redacción.

---

## 6. Fase 7 — Frontend: panel admin (agente `frontend`)

En `AdminDashboard.jsx`:

1. **`VentasTab`**, bloque superior **«Por confirmar (N)»**, con los pedidos `review === 'por_confirmar'` ordenados por `expires_at` ascendente. Cada fila muestra:
   - cliente, teléfono, hallacas, entrega/retiro;
   - cuenta regresiva «vence en Xh Ym» (se recalcula cada minuto con `setInterval`, limpiado en el cleanup);
   - botón **WhatsApp** al cliente (`https://wa.me/` + teléfono sin `+`);
   - **Confirmar** → `PATCH { confirm: true }`;
   - **Rechazar** → `PATCH { status: 'cancelado' }`, con `window.confirm` previo.
2. **Bloque «Vencidos (N)»**, plegable:
   - Botón **Reactivar** → `PATCH { confirm: true }`.
   - Si responde 409 `STOCK_INSUFICIENTE`, mostrar `window.confirm('Esto deja el stock en X. ¿Registrar igual?')`. Si se acepta, reenviar con `force: true`.
3. **Mismo manejo de `STOCK_INSUFICIENTE` + `force`** en:
   - el select de estado (reactivar cancelado);
   - la edición de cantidad;
   - `ManualSaleForm`.
   - Un error de acción **no** reemplaza la tabla: se muestra en un banner (`actionError`) sobre ella.
4. **Badges** con el número de pedidos por confirmar:
   - en la pestaña «Ventas»;
   - en el botón «Panel» de la nav (`Sections.jsx` ~86).
   - Se refrescan cada 60 s mientras el panel está abierto, y al volver el foco a la pestaña (`visibilitychange`).
5. **`ManualSaleForm`:** checkbox **«Encargo para próxima tanda (no descuenta stock ahora)»** → `encargo: true`. Con el checkbox marcado, el total es opcional.
6. **`ProduccionTab`:** tras crear una tanda, si hay encargos (`encargos_por_coordinar > 0` en reportes), mostrar el aviso «Tienes N encargos (X hallacas) esperando; concrétalos desde Ventas» con enlace al filtro existente (`onViewStockExemptOrders`).
7. **`ResumenTab`:** tarjetas «Por confirmar» y «Vencidos» con `n` y `hallacas`.
8. **Accesibilidad mínima:** los botones nuevos con texto visible o `aria-label`, y un área táctil ≥ 44 px en móvil.

**Validaciones de la fase:**
- [ ] `npm run build` OK.
- [ ] A 375 px, el bloque «Por confirmar» se lee sin scroll horizontal (formato tarjeta, no tabla).

---

## 7. Fase 8 — Revisión cruzada (agente `architect`, solo lectura)

Revisa el diff completo (`git diff main...HEAD`) contra este prompt y responde punto por punto, con archivo:línea:
- [ ] D1–D13 implementados tal cual. El único canal de notificación es Telegram, sin código muerto de otros canales.
- [ ] No queda ningún `status != 'cancelado'` fuera de `orderState.js` en consultas de stock, kardex o reportes (`grep -rn "status != 'cancelado'" backend`).
- [ ] Toda operación que aumenta la reserva pasa por el chequeo dentro de una transacción `.immediate()`.
- [ ] El backfill usa exactamente `WHERE confirmed_at IS NULL AND expires_at IS NULL`, y todo INSERT de `orders` cumple la invariante.
- [ ] `server.js`: `trust proxy` se fija **antes** de `app.use('/api', apiLimiter)` (hoy en la línea ~41), y el barrido arranca dentro del callback de `app.listen`.
- [ ] La lógica de cada endpoint (validación de pedidos) no depende de que corra el barrido de notificaciones.
- [ ] No se agregaron dependencias npm.
- [ ] `.env`, `*.db` y secretos no están en el diff.
- [ ] Ningún test fue desactivado ni marcado `skip`.

---

## 8. Fase 9 — Prueba E2E en navegador (agente `general-purpose` con Playwright)

1. Levantar el backend con BD temporal y las variables de prueba (`ORDER_HOLD_HOURS=24`, sin Telegram) y el frontend (`npm start`). Capturas en una carpeta temporal fuera del repo.
2. Escenarios, a 375 px y 1280 px:
   - a) Cliente sin cuenta pide 10 hallacas → éxito con mensaje de 24 h. En el admin aparece en «Por confirmar» con la cuenta regresiva y el badge.
   - b) Mismo teléfono intenta 11 más → mensaje exacto de contacto directo + botón WhatsApp. El carrito se conserva.
   - c) Carrito de 21 → el botón de confirmar queda deshabilitado con el mensaje.
   - d) Encargo `pXL` de 21 → mensaje de contacto directo.
   - e) Admin confirma (a) → sale de «Por confirmar». Rechazar otro → libera stock.
   - f) Vencer un pedido por SQL → aparece en «Vencidos». «Reactivar» sin stock → diálogo de forzar.
   - g) Venta manual «Encargo para próxima tanda» → no mueve el stock. Crear tanda → aviso de encargos pendientes. Concretar → descuenta.
   - h) Notas con `O'Higgins & "x"` se ven tal cual en el admin.
   - i) Sin errores de consola ni overflow horizontal en ninguna vista.
3. **Telegram real** (solo si el usuario dio `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` en `backend/.env`): crear un pedido y confirmar que llega el mensaje con los enlaces. Bajar temporalmente `ORDER_HOLD_HOURS=1` y `ORDER_REMINDER_HOURS_BEFORE=1` para ver el aviso «por vencer» en el siguiente barrido.

---

## 9. Configurar el bot de Telegram (lo hace el dueño, 5 minutos)

1. En Telegram, abre **@BotFather** → `/newbot` → elige nombre y usuario. Copia el **token**.
2. Abre el chat con tu bot nuevo y envíale cualquier mensaje.
3. Abre en el navegador `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia `message.chat.id`.
4. Guarda `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` en `backend/.env` (local) y en las variables de entorno de Render (producción). **Nunca en el repo.**

---

## 10. Cierre y entrega

- [ ] `cd backend && npm test` → 0 fallos (adjuntar salida).
- [ ] `npm run build` → OK.
- [ ] E2E de la Fase 9 → todos los escenarios OK (adjuntar lista ✅/❌).
- [ ] `docs/adr/ADR-4-pedidos-por-confirmar.md` creado.
- [ ] `backend/.env.example` actualizado.
- [ ] En el resumen final, una sección **«Variables a configurar en Render»**: `ORDER_HOLD_HOURS`, `ORDER_REMINDER_HOURS_BEFORE`, `MAX_HALLACAS_POR_TELEFONO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `PUBLIC_ADMIN_URL`, `TRUST_PROXY=1`, `TZ=America/Santiago`.
- [ ] Nota sobre el plan de Render: el barrido de avisos necesita que el servicio esté siempre encendido. Con disco persistente lo está. En un plan que se duerme, los avisos «por vencer» y «vencido» llegan con retraso; el vencimiento del stock **no** se ve afectado, porque se calcula en cada consulta.
- [ ] Commits por fase en `feature/pedidos-por-confirmar`. **No hacer merge a `main` ni push sin que el usuario lo pida.**
- [ ] Al terminar, lanza `deploy-verificador` solo **después** del deploy, para comprobar las variables nuevas y un pedido real end-to-end.
