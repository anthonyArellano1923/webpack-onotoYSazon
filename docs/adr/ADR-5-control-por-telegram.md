# ADR-5 — Control de pedidos desde Telegram

- **Estado:** aceptado
- **Fecha:** 2026-11-06
- **Plan:** PLAN-12
- **Extiende:** ADR-4 (D11, D13: Telegram como único canal de avisos)

---

## 1. Contexto

Desde ADR-4, el bot de Telegram solo **envía** avisos: pedido web nuevo, por vencer y vencido. El dueño sigue llevando sus pedidos en Notas de Mac. Sus notas muestran qué datos maneja de cada pedido (nombre, cantidad de hallacas, estado de pago y estado de entrega):

```
Tanda prueba:
  Elías: 4. Por entregar. Pagado.
  Bryan Toloza: 2. Pendiente pago. Por entregar.
  Leonel Landaeta: 3. Pendiente de pago.
  Elvis Pacheco: 1. Pagada. Entregada.
```

Quiere operar desde el mismo chat en que recibe los avisos:

- registrar pedidos;
- confirmar pedidos web;
- marcar pagado, pendiente de pago y entregado.

Así deja de mantener una segunda lista a mano. El formato de las notas solo ilustra esos datos: **no** es un formato de entrada para el bot (ver D7).

## 2. Decisiones

- **D1. Webhook, no long polling.** Endpoint: `POST /api/telegram/webhook`, registrado con `setWebhook` y `secret_token`.
  - Long polling no expone ningún endpoint, pero exige un proceso que consulte `getUpdates` en bucle. En Render, una instancia dormida no consulta y el dueño no tendría respuesta hasta que algo la despierte.
  - Con webhook, el propio mensaje despierta la instancia.
  - El costo del webhook es exponer un endpoint, y se mitiga con D2 y D3.
- **D2. Autenticación por secreto.** Cada request trae `X-Telegram-Bot-Api-Secret-Token`.
  - El valor se compara en tiempo constante (`timingSafeEqual`, con chequeo previo del largo) contra `TELEGRAM_WEBHOOK_SECRET`.
  - Si falta, no coincide o el bot no está configurado (sin `TELEGRAM_BOT_TOKEN` o sin secreto), la respuesta es `401` y no se procesa nada.
- **D3. Lista blanca de chats.** Se aceptan `TELEGRAM_CHAT_ID` ∪ `TELEGRAM_ADMIN_CHAT_IDS`, comparados como texto.
  - Se unen ambos para que los botones del aviso, que llega a `TELEGRAM_CHAT_ID`, sigan funcionando aunque se configure la lista.
  - Cualquier otro chat recibe `200` y silencio total: sin respuesta, sin `answerCallbackQuery` y sin escritura. Así no se confirma que el bot exista.
- **D4. El webhook va antes del `apiLimiter`.** Un `429` haría que Telegram reintentara el update. Telegram reintenta también si no se responde a tiempo, así que se descartan los `update_id` repetidos (últimos 500, en memoria).
- **D5. Una sola fuente de reglas.**
  - La lógica de `createManualSale` y `updateOrder` se extrae, sin cambiar mensajes ni reglas, a `backend/services/orders.service.js` (`createSale`, `updateSale`).
  - El panel y el bot llaman a esas mismas funciones. El bot no tiene chequeo de stock propio: `STOCK_INSUFICIENTE`, `force`, `PEDIDO_NO_CONFIRMADO` y la confirmación implícita al marcar pagado salen de ADR-4 tal cual.
- **D6. Revalidación bajo el lock.**
  - El `callback_data` lleva solo `acción:id`, más `:f` cuando se reenvía con `force`.
  - `updateSale` acepta una `precondition` que corre sobre la fila releída **dentro** de la transacción `.immediate()`. El bot la usa para no aplicar nada sobre un pedido cancelado ni repetir un estado que ya tiene.
  - Chequear fuera de la transacción y escribir después dejaría una carrera: por ejemplo, un «Pagado» viejo sobre un pedido cancelado lo reactivaría, porque `updateOrder` permite `cancelado → pagado`.
  - Tras cada acción se responde `answerCallbackQuery` y se edita el mensaje con el resultado y los botones que siguen teniendo sentido.
- **D7. Registro guiado, sin texto libre.**
  - `/nuevo` pide paso a paso: nombre, cantidad, teléfono (opcional, botón «Sin teléfono»), pagado o pendiente (botones) y encargo sí/no (botones). Al final muestra un resumen con **Confirmar/Cancelar**; nada se escribe antes.
  - Atajo: `/nuevo <nombre> <cantidad>` salta a la pregunta del teléfono; el último argumento debe ser la cantidad.
  - El bot solo lee texto escrito como respuesta al paso activo (nombre, cantidad, teléfono), y valida cada campo por separado: si no sirve, lo vuelve a preguntar. Fuera de un `/nuevo`, el texto libre recibe «usa /nuevo» y no se interpreta.
  - Se descartó aceptar el formato de Notas pegado: interpretar frases obliga a adivinar variantes y un error de lectura registra un pedido equivocado.
  - Un nombre igual al de un pedido vivo genera en el resumen un aviso «Ojo: ya existe #ID».
  - Cualquier otro comando descarta el `/nuevo` en curso, para que un texto posterior no se tome como respuesta a una pregunta vieja. `/cancelar` lo descarta explícitamente.
- **D8. Estado en memoria.**
  - El `callback_data` admite 64 bytes. Los botones del flujo llevan `n:<token>:<opción>` y la pregunta de stock `d:<token>:ok|no`, con un token de 12 caracteres hex. El flujo (uno por chat) y la venta pendiente de `force` viven en `Map` del proceso, con TTL de 30 minutos.
  - El token del flujo cambia en cada `/nuevo`: un botón de un flujo anterior responde «Este paso ya no está activo» y no hace nada.
  - El flujo y la venta pendiente se **sacan antes de escribir**: un doble toque en Confirmar o en «Registrar igual» no registra dos veces.
  - Si Render reinicia o redeploya, se pierde el `/nuevo` a medias. El botón responde «ya no está activo» o «expiró»; no se pierde ningún pedido, porque nada se había escrito.
  - Se descartó una tabla nueva porque añadiría una migración para un estado de pocos minutos.
- **D9. Ventas desde el bot = venta manual del panel.**
  - Nacen con `source='admin'`, confirmadas, sin límite por teléfono y con teléfono opcional (`createSale`).
  - «Encargo: sí» equivale a `encargo: true` (`stock_exempt = 1`): no descuenta stock y no pregunta por él.
  - La entrega no se pregunta en `/nuevo`: el resultado trae el botón «Entregado», que pasa por `updateSale` como cualquier otro cambio.
- **D10. Operar por `#ID`.**
  - `/pedidos` es solo salida: una línea legible por pedido (`#12 Elías — 4 hallacas — Pagado — por entregar`) y una fila de botones por pedido (`✅ #12`, `✖️ #12`, `💰 #12`, `📦 #12`, según su estado; máximo 30 filas).
  - Esos botones llevan el sufijo `:l`: tras aplicar la acción, el mensaje se redibuja con la lista actualizada.
  - Los comandos de estado reciben el `#ID` (`/pagado 12`). Con nombres repetidos, el `#ID` es la única forma inequívoca de operar; el bot nunca busca pedidos por nombre.
- **D11. Fuera del bot:** borrar pedidos, usuarios, precios y ajustes. Tampoco se anula desde el bot un pedido ya confirmado: «Rechazar» es solo para pedidos web sin validar.
- **D12. Sin dependencias nuevas.** El bot usa el `fetch` nativo, en texto plano, sin `parse_mode`, igual que `notify.js`. Ahora `notify.callApi` es el único cliente de la Bot API. La respuesta 400 «message is not modified» se trata como no-op.

## 3. Comandos y botones

**Comandos:**

- `/nuevo` y `/nuevo <nombre> <cantidad>`: registro guiado (D7). `/cancelar` descarta el registro en curso.
- `/pedidos`: pedidos vivos y no cerrados, agrupados en «Por confirmar» y «Confirmados», con botones por pedido. Un pedido cerrado es uno entregado y pagado, o una cortesía.
- `/pendientes`: pedidos web por confirmar, más los vencidos de los últimos 7 días.
- `/stock`: el desglose del panel (ADR-3).
- `/confirmar <id>`, `/pagado <id>`, `/entregado <id>` y `/rechazar <id>`.
- `/porpagar <id>`: vuelve el pedido a pendiente de pago. No se llama `/pendiente` para no confundirlo con `/pendientes`.
- `/ayuda`.

**Botones del aviso de pedido web nuevo:**

- `c:<id>`: Confirmar.
- `x:<id>`: Rechazar.
- `p:<id>`: Pagado.
- `e:<id>`: Entregado.

**`STOCK_INSUFICIENTE`.** El bot pregunta «Esto deja el stock en X. ¿Registrar igual?», donde X = `stock − requerido`. El botón reenvía la misma acción con `force`: en pedidos existentes, como `acción:id:f`; en ventas nuevas de `/nuevo`, como `d:<token>:ok`, que registra la misma venta con `force: true`.

## 4. Operación

**Variables nuevas:**

- `TELEGRAM_WEBHOOK_SECRET`: 16 a 256 caracteres, solo `A-Z a-z 0-9 _ -`.
- `TELEGRAM_ADMIN_CHAT_IDS`: opcional.
- `PUBLIC_API_URL`: solo la usa el script de registro.

**Registro del webhook.** Se ejecuta a mano tras configurar las variables, no en cada arranque, para que un deploy no dependa de que Telegram responda:

```
cd backend && npm run telegram:webhook
```

**Consultar o quitar el webhook:**

- `node scripts/telegram-webhook.js --info`: muestra el estado.
- `node scripts/telegram-webhook.js --delete`: lo quita.

Con el webhook activo, `getUpdates` deja de funcionar. El chat ID se obtiene antes, o tras `--delete`.

## 5. Riesgos

- **Secreto filtrado:** quien lo tenga puede fabricar updates con el chat ID del dueño, y la lista blanca no lo frena, porque el ID viaja en el cuerpo. El secreto vale lo mismo que el token del bot: solo vive en las variables de Render. Para rotarlo, se cambia la variable y se vuelve a correr el script.
- **Grupos:** si `TELEGRAM_CHAT_ID` es un grupo, cualquier miembro puede operar el bot. Debe ser el chat privado del dueño, o un grupo solo con personas autorizadas.
- **Estado en memoria:** un `/nuevo` a medias se pierde con un reinicio. Ver D8.
- **Varias instancias:** el flujo `/nuevo`, la venta pendiente de `force` y los `update_id` vistos son por proceso. Hoy Render corre una sola instancia, porque SQLite está en un disco local. Si eso cambia, hay que mover ese estado a la BD.
- **Límite de 4096 caracteres:** los listados largos se dividen en varios mensajes por línea.
