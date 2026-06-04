# 02 — Modificaciones Backend

> **Para el agente backend.** Aplica cada cambio en orden y marca `[X]` al completar.
> Las credenciales de producción (JWT_SECRET, contraseñas) NO van en el código — se configuran como variables de entorno en el dashboard de Render (ver `00_plan_de_deploy.md`, Fase 3.3).

---

## Resumen de cambios

| Archivo | Tipo de cambio |
|---|---|
| `backend/database/db.js` | Usar variable de entorno `DB_PATH` para la ruta de SQLite |
| `backend/server.js` | Soportar múltiples orígenes en CORS |
| `backend/.env.example` | Documentar nueva variable `DB_PATH` |

---

## Tarea 1 — Ruta dinámica para la base de datos SQLite

**Archivo:** `backend/database/db.js`

**Problema:** La ruta del archivo SQLite está hardcodeada en la línea 6:
```js
const DB_PATH = path.join(__dirname, '..', 'onoto.db');
```
En Render, la base de datos debe vivir en el disco persistente montado en `/data`. Si se deja hardcodeada, cada redeploy borra la base de datos.

**Solución:** Leer la ruta desde la variable de entorno `DB_PATH`.

- [X] En `backend/database/db.js`, línea 6, buscar:
```js
const DB_PATH = path.join(__dirname, '..', 'onoto.db');
```

- [X] Reemplazar con:
```js
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'onoto.db');
```

> Con este cambio:
> - **En local (desarrollo):** sigue usando `backend/onoto.db` como antes (no hay `DB_PATH` en `.env` local).
> - **En Render (producción):** usa `/data/onoto.db` (disco persistente), porque `DB_PATH=/data/onoto.db` estará configurado en las variables de entorno de Render.

---

## Tarea 2 — CORS con múltiples orígenes

**Archivo:** `backend/server.js`

**Problema:** La configuración de CORS en la línea 21 solo acepta un único string como origen:
```js
origin: process.env.CORS_ORIGIN || 'http://localhost:3006',
```
En producción necesitamos aceptar tanto `https://www.onotosazon.cl` como `https://onotosazon.cl` (con y sin `www`). Si solo hay uno configurado y el usuario entra sin `www`, el navegador bloqueará las peticiones.

**Solución:** Parsear `CORS_ORIGIN` como lista separada por comas.

- [X] En `backend/server.js`, localizar el bloque `app.use(cors({...}))` (líneas 20–25):
```js
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3006',
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));
```

- [X] Reemplazar con:
```js
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3006')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));
```

> Con este cambio, `CORS_ORIGIN=https://www.onotosazon.cl,https://onotosazon.cl` acepta ambos orígenes. En local sigue funcionando igual con `http://localhost:3006`.

---

## Tarea 3 — Documentar `DB_PATH` en `.env.example`

**Archivo:** `backend/.env.example`

- [X] Leer el archivo actual
- [X] Agregar la variable `DB_PATH` con comentario explicativo, debajo de `NODE_ENV`:

```env
# Ruta del archivo SQLite.
# En producción (Render): /data/onoto.db  (disco persistente montado en /data)
# En desarrollo: dejar vacío para usar backend/onoto.db por defecto
DB_PATH=
```

---

## Verificación final (agente)

Después de aplicar todos los cambios:

- [X] Ejecutar el servidor en local y verificar que arranca sin errores:
  ```bash
  cd backend && npm run dev
  ```
- [X] Verificar que `GET http://localhost:4000/health` responde `{"status":"ok"}`
- [ ] Verificar que el login funciona desde el frontend en local (`npm start` en la raíz)
- [X] Hacer commit con todos los cambios:
  ```bash
  git add backend/database/db.js backend/server.js backend/.env.example
  git commit -m "feat: prepare backend for production deploy on Render"
  git push origin main
  ```
