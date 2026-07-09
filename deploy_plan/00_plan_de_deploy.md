# 00 — Plan de Deploy: Onoto y Sazón

> **Guía completa para alguien que nunca ha hecho un deploy.**
> Sigue cada paso en orden. Marca `[X]` cuando completes cada tarea.

---

## Arquitectura final

```
Usuario
   │
   ▼
www.onotoysazon.cl  ──────────────►  Vercel (Frontend React)
                                        │
                                        │ fetch a la API
                                        ▼
api.onotoysazon.cl  ──────────────►  Render (Backend Express + SQLite)
                                        │
                                        ▼
                                   /data/onoto.db  (disco persistente)
```

---

## Costos estimados

| Servicio | Plan | Costo |
|---|---|---|
| Vercel | Free (Hobby) | $0 / mes |
| Render — Web Service | **Starter** (requerido, ver nota) | $7 USD / mes |
| Render — Persistent Disk | 1 GB | ~$0.25 / mes |
| Dominio `.cl` (nic.cl) o `.com` (Cloudflare) | | ~$10–15 USD / año |
| **Total inicial** | | **~$8–9 USD / mes** |

> **⚠️ Por qué NO sirve el plan Free de Render:** los discos persistentes **solo están disponibles en instancias de pago** (Starter o superior). Sin disco persistente, el archivo SQLite (`onoto.db`) vive en el sistema de archivos efímero: **cada redeploy o reinicio borra todos los usuarios y pedidos**. Para una app con base de datos SQLite, Starter es el mínimo real.
>
> **Beneficio extra del Starter:** el servidor nunca "duerme" (en Free, tras 15 min sin visitas, la primera petición tardaba ~30 s).
>
> **Alternativa $0/mes (futuro):** migrar la base de datos a [Turso](https://turso.tech) (SQLite gestionado, plan free generoso) y dejar el backend en Render Free. Requiere cambios de código en `backend/database/db.js` — no lo hagas en este primer deploy; anótalo como mejora posterior.

---

## FASE 0 — Crear cuentas (30 min)

### Cuentas requeridas

- [ ] **GitHub** — [github.com/signup](https://github.com)
  > Ya deberías tener una. Ahí está el código fuente del proyecto.

- [ ] **Vercel** — [vercel.com/signup](https://vercel.com/signup)
  > Usa la opción "Continue with GitHub" para conectarlos automáticamente.

- [ ] **Render** — [render.com](https://render.com)
  > Usa la opción "Connect GitHub" al registrarte.

- [X] **Cloudflare** (para el dominio) — [cloudflare.com](https://cloudflare.com)
  > Crea una cuenta. Cloudflare ofrece dominios al precio de costo (sin markup).

---

## FASE 1 — Comprar el dominio (15 min)

> **⚠️ Importante:** Cloudflare Registrar **no vende dominios `.cl`**. Elige según la extensión:

**Si quieres `.cl` (ej. `onotosazon.cl`):**
- [X] Regístralo en [nic.cl](https://www.nic.cl) — registro oficial chileno (~$10.000 CLP/año)
- [X] Luego, en Cloudflare, usa **"Add a site"** para gestionar el DNS del dominio: Cloudflare te dará 2 nameservers que debes configurar en nic.cl (sección "Servidores de nombre" del dominio) — verificado por whois: `kianchau.ns.cloudflare.com` / `sonia.ns.cloudflare.com` guardados en nic.cl, propagación DNS en curso

**Si quieres `.com` (ej. `onotosazon.com`):**
- [ ] Cómpralo directamente en [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (precio de costo, sin markup) — el DNS queda en Cloudflare automáticamente
- [ ] Alternativa: [Namecheap](https://www.namecheap.com)

- [X] Anota el nombre exacto del dominio que compraste:
  > **Mi dominio:** `onotoysazon.cl`

---

## FASE 2 — Preparar el código (10 min)

- [X] Pedir al **agente frontend** que ejecute `01_modificaciones_frontend.md` ✓ (aplicado y verificado)
- [X] Pedir al **agente backend** que ejecute `02_modificaciones_backend.md` ✓ (aplicado y verificado)

### 2.1 — Subir el código a GitHub ⚠️ PASO CRÍTICO PENDIENTE

> **Estado actual (verificado 2026-07-07):** todo el trabajo (backend completo + cambios de deploy) vive en la rama local `redesign_agents`, **11 commits por delante de `main`**. En GitHub, `main` ni siquiera tiene la carpeta `backend/`. Render y Vercel despliegan desde GitHub — sin este paso, nada de lo anterior sirve.

- [X] Fusionar `redesign_agents` en `main` y subir:
  ```bash
  git checkout main
  git merge redesign_agents
  git push origin main
  ```
- [X] Verificar en GitHub que `main` ahora contiene:
  - La carpeta `backend/` (con `server.js`, `controllers/`, etc.)
  - El archivo `vercel.json` en la raíz
  - La carpeta `deploy_plan/`
- [X] Confirmar que `backend/.env` y `backend/onoto.db` **NO** aparecen en GitHub (están en `.gitignore` — contienen secretos y datos locales)

> **Nota:** el repositorio en GitHub se llama **`webpack-onotoYSazon`** (no `onotoYSazon`). Usa ese nombre cuando Render y Vercel te pidan elegir el repo. Si quieres renombrarlo a `onotoYSazon`, hazlo en GitHub → Settings → Rename **antes** de conectar Render/Vercel; GitHub redirige el nombre viejo, pero es más limpio conectar los servicios con el nombre definitivo.

---

## FASE 3 — Deploy del Backend en Render (25 min)

### 3.1 — Crear el Web Service

- [ ] Entra a [dashboard.render.com](https://dashboard.render.com)
- [ ] Clic en **"New +"** → **"Web Service"**
- [ ] Conecta tu repositorio de GitHub (elige `webpack-onotoYSazon`)
- [ ] Configura el servicio:

  | Campo | Valor |
  |---|---|
  | **Name** | `onoto-backend` |
  | **Root Directory** | `backend` |
  | **Runtime** | `Node` |
  | **Build Command** | `npm install` |
  | **Start Command** | `npm start` |
  | **Instance Type** | **Starter ($7/mes)** — obligatorio: el plan Free no permite discos persistentes y sin disco la base de datos se borra en cada deploy |

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
  | `JWT_SECRET` | *(ver instrucción abajo para generar)* |
  | `JWT_EXPIRES_IN` | `7d` |
  | `CORS_ORIGIN` | `https://www.onotoysazon.cl,https://onotoysazon.cl` *(pon tu dominio real)* |
  | `ADMIN_EMAIL` | `tu@email.com` |
  | `ADMIN_PASSWORD` | *(una contraseña segura que no olvides)* |
  | `ADMIN_NAME` | `Admin` |
  | `DB_PATH` | `/data/onoto.db` |

  **Cómo generar el JWT_SECRET** (en tu terminal):
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
  Copia el resultado y pégalo como valor de `JWT_SECRET`.

  > No configures `PORT`: Render la inyecta automáticamente y el servidor ya la lee con `process.env.PORT`.

- [ ] Clic en **"Save Changes"** — Render volverá a deployar

### 3.4 — Verificar que el backend funciona

- [ ] Abre en el navegador: `https://TU-URL.onrender.com/health`
- [ ] Debes ver: `{"status":"ok"}`
- [ ] En Render → **Logs**, verifica que no hay errores y que aparece el mensaje de arranque del servidor. En el primer arranque, el backend crea las tablas (desde `schema.sql`) y siembra el usuario admin con `ADMIN_EMAIL` / `ADMIN_PASSWORD` — si cambiaste esas variables después, el admin ya existente NO se actualiza.

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
- [ ] Clic en **"Add"** y escribe `www.onotoysazon.cl`
- [ ] Vercel te dará un registro DNS para agregar. Anótalo.
- [ ] También agrega `onotoysazon.cl` (sin www) — Vercel lo redirigirá al www

### 5.2 — Crear subdominio para el backend (Render)

- [ ] En Render → tu servicio → **Settings** → **Custom Domains**
- [ ] Clic en **"Add Custom Domain"** y escribe `api.onotoysazon.cl`
- [ ] Render te dará un valor CNAME para agregar. Anótalo.

### 5.3 — Configurar DNS en Cloudflare

- [ ] Entra a [dash.cloudflare.com](https://dash.cloudflare.com)
- [ ] Selecciona tu dominio → **DNS** → **Records**
- [ ] Agrega estos registros:

  | Tipo | Nombre | Contenido | Proxy |
  |---|---|---|---|
  | `CNAME` | `www` | *(el valor que dio Vercel, normalmente `cname.vercel-dns.com`)* | **Desactivado** (nube gris) |
  | `A` | `@` | `76.76.21.21` *(o el valor que indique Vercel para el apex)* | **Desactivado** (nube gris) |
  | `CNAME` | `api` | *(el valor que dio Render)* | **Desactivado** (nube gris) |

  > **Importante:** Deja los TRES registros con el proxy **desactivado** (nube gris / "DNS only"):
  > - `api`: si está proxied, Render no puede verificar el dominio ni emitir el certificado SSL.
  > - `www` y `@`: Vercel ya incluye CDN y SSL propios; el proxy de Cloudflare encima puede causar bucles de redirección o errores de certificado. Si más adelante quieres activarlo, primero cambia en Cloudflare → SSL/TLS el modo a **Full (strict)** — nunca "Flexible".

- [ ] Guarda los cambios

### 5.4 — Esperar propagación DNS

- [ ] Espera entre 5–30 minutos para que los DNS se propaguen
- [ ] Verifica en Vercel y Render que el dominio aparece como ✓ Verified

### 5.5 — Actualizar la URL de la API en Vercel

- [ ] En Vercel → tu proyecto → **Settings** → **Environment Variables**
- [ ] Edita `API_URL` y cambia el valor a `https://api.onotoysazon.cl`
- [ ] Vercel redesplegará automáticamente

---

## FASE 6 — Prueba final (10 min)

- [ ] Abre `https://www.onotoysazon.cl` — debe cargar la web
- [ ] Prueba **registrar una cuenta nueva**
- [ ] Prueba **iniciar sesión**
- [ ] Prueba **agregar hallacas al carrito y confirmar un pedido**
- [ ] Prueba el **modo oscuro**
- [ ] Abre `https://api.onotoysazon.cl/health` — debe responder `{"status":"ok"}`
- [ ] Prueba **iniciar sesión como admin** (con `ADMIN_EMAIL` / `ADMIN_PASSWORD` configurados en Render)
- [ ] Verifica que el **candado SSL** (HTTPS) aparece en el navegador en ambas URLs

---

## FASE 7 — Después del deploy (mantenimiento mínimo)

- [ ] **Respaldo de la base de datos:** el archivo `/data/onoto.db` contiene todos los usuarios y pedidos. Render ofrece *snapshots* diarios del disco (retención ~7 días) en Settings → Disks. Además, una vez al mes descarga una copia manual: en Render → tu servicio → **Shell**, o configura un endpoint/cron más adelante.
- [ ] **Monitoreo gratis:** crea una cuenta en [UptimeRobot](https://uptimerobot.com) y agrega un monitor HTTP a `https://api.onotoysazon.cl/health` — te avisa por email si el backend se cae.
- [ ] **Mejora futura (opcional, $0/mes):** migrar la DB a Turso y bajar Render a Free — anotado en la sección de costos.

---

## Solución de problemas comunes

| Problema | Causa probable | Solución |
|---|---|---|
| La web carga pero las peticiones al backend fallan (CORS) | `CORS_ORIGIN` no incluye tu dominio | Verifica que `CORS_ORIGIN` en Render tenga exactamente `https://www.onotoysazon.cl,https://onotoysazon.cl` |
| El backend responde pero la DB da error | Disco no montado en `/data` | Verifica que el disco está montado en Render y que `DB_PATH=/data/onoto.db` |
| Los datos (usuarios/pedidos) desaparecen tras un deploy | La app está escribiendo fuera del disco persistente | Verifica que `DB_PATH=/data/onoto.db` está configurado y el disco montado en `/data` |
| Render no permite agregar el disco | Instancia en plan Free | Los discos requieren instancia Starter o superior — cambia el Instance Type |
| Vercel/Render dan error de SSL o bucle de redirección | Proxy de Cloudflare activado (nube naranja) | Pon los registros DNS en "DNS only" (nube gris) |
| Dominio no resuelve | DNS propagándose | Espera hasta 24 horas (normalmente 5–30 min) |
| Vercel falla en build | Error en el código | Revisa los logs en Vercel → Deployments → clic en el deployment fallido |
