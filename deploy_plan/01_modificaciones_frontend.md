# 01 — Modificaciones Frontend

> **Para el agente frontend.** Aplica cada cambio en orden y marca `[X]` al completar.
> El dominio final es un placeholder — usa `onotosazon.cl` como valor por defecto hasta que el usuario confirme el dominio real.

---

## Resumen de cambios

| Archivo | Tipo de cambio |
|---|---|
| `.env` | Corregir `PUBLIC_PATH` |
| `vercel.json` | Crear nuevo (configuración de build para Vercel) |
| `public/index.html` | Actualizar URLs de GitHub Pages al dominio real |
| `public/sitemap.xml` | Actualizar URL base |
| `public/robots.txt` | Actualizar URL del sitemap |

---

## Tarea 1 — Corregir `.env`

**Archivo:** `.env` (raíz del proyecto)

**Problema:** `PUBLIC_PATH` apunta a `/webpack-onotoYSazon/` que era el sub-path de GitHub Pages. Con dominio propio la app vive en la raíz `/`.

- [X] Cambiar el contenido del archivo:

```diff
- NODE_ENV=production
- PUBLIC_PATH=/webpack-onotoYSazon/
+ NODE_ENV=production
+ PUBLIC_PATH=/
```

> `API_URL` NO debe estar en este archivo. Se inyecta como variable de entorno en Vercel.

---

## Tarea 2 — Crear `vercel.json`

**Archivo:** `vercel.json` (raíz del proyecto — archivo nuevo)

**Por qué:** Vercel necesita saber cómo construir el proyecto y cómo manejar las rutas de la SPA.

- [X] Crear el archivo con este contenido exacto:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

## Tarea 3 — Actualizar URLs en `public/index.html`

**Archivo:** `public/index.html`

Las siguientes líneas aún apuntan a GitHub Pages. Deben actualizarse al dominio real.

### 3.1 — Open Graph URL (línea 19)

- [X] Buscar:
```html
<meta property="og:url" content="https://anthonyarellano1923.github.io/onotoYSazon/" />
```

- [X] Reemplazar con:
```html
<meta property="og:url" content="https://www.onotosazon.cl/" />
```

### 3.2 — Canonical link (línea 29)

- [X] Buscar:
```html
<link rel="canonical" href="https://anthonyarellano1923.github.io/onotoYSazon/" />
```

- [X] Reemplazar con:
```html
<link rel="canonical" href="https://www.onotosazon.cl/" />
```

### 3.3 — Structured Data Schema.org (línea 43)

- [X] Buscar dentro del `<script type="application/ld+json">`:
```json
"url": "https://anthonyarellano1923.github.io/onotoYSazon/",
```

- [X] Reemplazar con:
```json
"url": "https://www.onotosazon.cl/",
```

---

## Tarea 4 — Actualizar `public/sitemap.xml`

**Archivo:** `public/sitemap.xml`

- [X] Buscar:
```xml
<loc>https://anthonyarellano1923.github.io/onotoYSazon/</loc>
```

- [X] Reemplazar con:
```xml
<loc>https://www.onotosazon.cl/</loc>
```

- [X] Actualizar la fecha:
```xml
<lastmod>2026-06-04</lastmod>
```

---

## Tarea 5 — Actualizar `public/robots.txt`

**Archivo:** `public/robots.txt`

- [X] Leer el archivo actual y verificar si tiene una línea `Sitemap:`.
- [X] Si existe, reemplazar la URL de GitHub Pages por:
```
Sitemap: https://www.onotosazon.cl/sitemap.xml
```

---

## Verificación final (agente)

Después de aplicar todos los cambios:

- [X] Ejecutar `npm run build` y verificar que termina sin errores
- [X] Confirmar que `dist/index.html` no contiene referencias a `anthonyarellano1923.github.io`
- [X] Hacer commit con todos los cambios:
  ```bash
  git add .env vercel.json public/index.html public/sitemap.xml public/robots.txt
  git commit -m "feat: prepare frontend for custom domain deploy"
  git push origin main
  ```
