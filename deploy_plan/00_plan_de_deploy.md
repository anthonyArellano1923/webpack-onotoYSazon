# 00 — Plan de Deploy: Onoto y Sazón

> **Guía completa para alguien que nunca ha hecho un deploy.**
> Sigue cada paso en orden. Marca `[X]` cuando completes cada tarea.

---

## Arquitectura final

```
Usuario
   │
   ▼
www.tudominio.cl  ──────────────►  Vercel (Frontend React)
                                        │
                                        │ fetch a la API
                                        ▼
api.tudominio.cl  ──────────────►  Render (Backend Express + SQLite)
                                        │
                                        ▼
                                   /data/onoto.db  (disco persistente)
```

---

## Costos estimados

| Servicio | Plan | Costo |
|---|---|---|
| Vercel | Free (Hobby) | $0 / mes |
| Render — Web Service | Free (750 h/mes) | $0 / mes |
| Render — Persistent Disk | 1 GB | ~$0.25 / mes |
| Dominio (.cl o .com) | Cloudflare Registrar | ~$10–15 USD / año |
| **Total inicial** | | **~$3–5 USD / mes** |

> **Nota:** El plan Free de Render hace que el servidor "duerma" si no recibe visitas en 15 minutos. La primera petición tras el sueño tarda ~30 segundos. Si quieres que siempre esté rápido, el plan **Starter de Render cuesta $7 USD/mes** y elimina ese comportamiento.

---

## FASE 0 — Crear cuentas (30 min)

### Cuentas requeridas

- [ ] **GitHub** — [github.com/signup](https://github.com)
  > Ya deberías tener una. Ahí está el código fuente del proyecto.

- [ ] **Vercel** — [vercel.com/signup](https://vercel.com/signup)
  > Usa la opción "Continue with GitHub" para conectarlos automáticamente.

- [ ] **Render** — [render.com](https://render.com)
  > Usa la opción "Connect GitHub" al registrarte.

- [ ] **Cloudflare** (para el dominio) — [cloudflare.com](https://cloudflare.com)
  > Crea una cuenta. Cloudflare ofrece dominios al precio de costo (sin markup).

---

## FASE 1 — Comprar el dominio (15 min)

- [ ] Entra a [cloudflare.com/products/registrar](https://www.cloudflare.com/products/registrar/)
- [ ] Busca el nombre que quieres (ej. `onotosazon.cl`, `onotosazon.com`)
- [ ] Agrega al carrito y completa el pago (necesitas tarjeta de crédito/débito)
- [ ] Anota el nombre exacto del dominio que compraste:
  > **Mi dominio:** `_______________________`

> **Alternativas si no quieres Cloudflare:**
> - [Namecheap](https://www.namecheap.com) — popular y confiable
> - [nic.cl](https://www.nic.cl) — registro oficial de dominios `.cl` en Chile

---

## FASE 2 — Preparar el código (10 min)

> Esta fase la realizan los **agentes frontend y backend**. Tú solo necesitas verificar que los cambios estén en el repositorio.

- [ ] Pedir al **agente frontend** que ejecute `01_modificaciones_frontend.md`
- [ ] Pedir al **agente backend** que ejecute `02_modificaciones_backend.md`
- [ ] Verificar que los cambios aparecen en GitHub (rama `main`):
  - Abre tu repositorio en GitHub
  - Confirma que los archivos modificados están actualizados

---

## FASE 3 — Deploy del Backend en Render (25 min)

### 3.1 — Crear el Web Service

- [ ] Entra a [dashboard.render.com](https://dashboard.render.com)
- [ ] Clic en **"New +"** → **"Web Service"**
- [ ] Conecta tu repositorio de GitHub (elige `onotoYSazon`)
- [ ] Configura el servicio:

  | Campo | Valor |
  |---|---|
  | **Name** | `onoto-backend` |
  | **Root Directory** | `backend` |
  | **Runtime** | `Node` |
  | **Build Command** | `npm install` |
  | **Start Command** | `npm start` |
  | **Instance Type** | Free (o Starter si quieres sin sleep) |

- [ ] Clic en **"Create Web Service"**
- [ ] Espera que aparezca `Deploy live ✓` (puede tardar 3–5 min)
- [ ] Anota la URL que Render asignó:
  > **URL del backend:** `https://______________________.onrender.com`

### 3.2 — Agregar el disco persistente (para SQLite)

- [ ] En el panel de tu servicio, ve a **"Disks"** (menú lateral)
- [ ] Clic en **"Add Disk"**
- [ ] Configura:

  | Campo | Valor |
  |---|---|
  | **Name** | `onoto-db` |
  | **Mount Path** | `/data` |
  | **Size** | `1 GB` |

- [ ] Clic en **"Save"** — Render reiniciará el servicio

### 3.3 — Configurar variables de entorno

- [ ] En el panel de tu servicio, ve a **"Environment"** (menú lateral)
- [ ] Agrega cada variable clic en **"Add Environment Variable"**:

  | Key | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `PORT` | `10000` |
  | `JWT_SECRET` | *(ver instrucción abajo para generar)* |
  | `JWT_EXPIRES_IN` | `7d` |
  | `CORS_ORIGIN` | `https://www.tudominio.cl,https://tudominio.cl` *(pon tu dominio real)* |
  | `ADMIN_EMAIL` | `tu@email.com` |
  | `ADMIN_PASSWORD` | *(una contraseña segura que no olvides)* |
  | `ADMIN_NAME` | `Admin` |
  | `DB_PATH` | `/data/onoto.db` |

  **Cómo generar el JWT_SECRET** (en tu terminal):
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
  Copia el resultado y pégalo como valor de `JWT_SECRET`.

- [ ] Clic en **"Save Changes"** — Render volverá a deployar

### 3.4 — Verificar que el backend funciona

- [ ] Abre en el navegador: `https://TU-URL.onrender.com/health`
- [ ] Debes ver: `{"status":"ok"}`

---

## FASE 4 — Deploy del Frontend en Vercel (20 min)

### 4.1 — Importar el proyecto

- [ ] Entra a [vercel.com/new](https://vercel.com/new)
- [ ] Clic en **"Import Git Repository"**
- [ ] Selecciona el repositorio `onotoYSazon`
- [ ] Configura el proyecto:

  | Campo | Valor |
  |---|---|
  | **Framework Preset** | `Other` |
  | **Root Directory** | *(dejar vacío — la raíz)* |
  | **Build Command** | `npm run build` |
  | **Output Directory** | `dist` |
  | **Install Command** | `npm install` |

### 4.2 — Agregar variable de entorno

- [ ] Antes de hacer clic en "Deploy", expande **"Environment Variables"**
- [ ] Agrega:

  | Key | Value |
  |---|---|
  | `API_URL` | `https://TU-URL.onrender.com` *(la URL del paso 3.1)* |

- [ ] Clic en **"Deploy"**
- [ ] Espera que diga `Production Deployment` ✓ (2–4 min)
- [ ] Abre la URL de Vercel y prueba que la web carga correctamente

---

## FASE 5 — Conectar el dominio propio (30 min)

### 5.1 — Apuntar el dominio al frontend (Vercel)

- [ ] En Vercel → tu proyecto → **Settings** → **Domains**
- [ ] Clic en **"Add"** y escribe `www.tudominio.cl`
- [ ] Vercel te dará un registro DNS para agregar. Anótalo.
- [ ] También agrega `tudominio.cl` (sin www) — Vercel lo redirigirá al www

### 5.2 — Crear subdominio para el backend (Render)

- [ ] En Render → tu servicio → **Settings** → **Custom Domains**
- [ ] Clic en **"Add Custom Domain"** y escribe `api.tudominio.cl`
- [ ] Render te dará un valor CNAME para agregar. Anótalo.

### 5.3 — Configurar DNS en Cloudflare

- [ ] Entra a [dash.cloudflare.com](https://dash.cloudflare.com)
- [ ] Selecciona tu dominio → **DNS** → **Records**
- [ ] Agrega estos registros:

  | Tipo | Nombre | Contenido | Proxy |
  |---|---|---|---|
  | `CNAME` | `www` | *(el valor que dio Vercel)* | Activado (nube naranja) |
  | `CNAME` | `@` | *(el valor de redirección de Vercel)* | Activado |
  | `CNAME` | `api` | *(el valor que dio Render)* | **Desactivado** (nube gris) |

  > **Importante:** El registro `api` DEBE estar con el proxy desactivado (nube gris), de lo contrario Render no puede verificar el dominio.

- [ ] Guarda los cambios

### 5.4 — Esperar propagación DNS

- [ ] Espera entre 5–30 minutos para que los DNS se propaguen
- [ ] Verifica en Vercel y Render que el dominio aparece como ✓ Verified

### 5.5 — Actualizar la URL de la API en Vercel

- [ ] En Vercel → tu proyecto → **Settings** → **Environment Variables**
- [ ] Edita `API_URL` y cambia el valor a `https://api.tudominio.cl`
- [ ] Vercel redesplegará automáticamente

---

## FASE 6 — Prueba final (10 min)

- [ ] Abre `https://www.tudominio.cl` — debe cargar la web
- [ ] Prueba **registrar una cuenta nueva**
- [ ] Prueba **iniciar sesión**
- [ ] Prueba **agregar hallacas al carrito y confirmar un pedido**
- [ ] Prueba el **modo oscuro**
- [ ] Abre `https://api.tudominio.cl/health` — debe responder `{"status":"ok"}`
- [ ] Verifica que el **candado SSL** (HTTPS) aparece en el navegador en ambas URLs

---

## Solución de problemas comunes

| Problema | Causa probable | Solución |
|---|---|---|
| La web carga pero las peticiones al backend fallan (CORS) | `CORS_ORIGIN` no incluye tu dominio | Verifica que `CORS_ORIGIN` en Render tenga exactamente `https://www.tudominio.cl,https://tudominio.cl` |
| El backend responde pero la DB da error | Disco no montado en `/data` | Verifica que el disco está montado en Render y que `DB_PATH=/data/onoto.db` |
| Primera petición tarda 30 segundos | Render Free en modo "sleep" | Normal en free tier — considera upgrade a Starter ($7/mes) |
| Dominio no resuelve | DNS propagándose | Espera hasta 24 horas (normalmente 5–30 min) |
| Vercel falla en build | Error en el código | Revisa los logs en Vercel → Deployments → clic en el deployment fallido |
