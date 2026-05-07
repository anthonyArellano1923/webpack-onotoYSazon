# Onoto y Sazón — Liquid Glass Redesign

Rediseño completo de la interfaz aplicando el lenguaje visual **Liquid Glass**: paneles translúcidos con `backdrop-filter`, controles flotantes, fotografía a sangre completa, y microinteracciones suaves. Mobile-first, responsive, accesible (WCAG AA), y construido con metodología BEM.

## ✨ Qué hay de nuevo

- **Hero a sangre completa** con foto detrás y nav flotante en vidrio
- **4 packs de menú** en tarjetas con bottom-card de vidrio sobre la foto del producto
- **Modal de detalle** con selector de cantidad y total dinámico
- **Carrito flotante** persistente (localStorage) en píldora de vidrio
- **Checkout en 2 pasos** que arma el mensaje y abre WhatsApp directamente
- **Sección Tradición** con cita destacada y mosaico editorial
- **Modo claro / oscuro** automático (respeta `prefers-color-scheme`) y togglable
- **Tweaks panel**: intensidad del blur del vidrio + toggle de tema
- **Botón flotante de WhatsApp** con anillo pulsante
- **Accesibilidad**: skip-link, focus visible, ARIA en modales, hit targets ≥44px, respeta `prefers-reduced-motion`

## 🗂 Estructura

```
redesign/
├── index.html                    # Punto de entrada
└── src/
    ├── app.jsx                   # Root del app + estado global
    ├── styles/
    │   └── styles.css            # Tokens (color/type/glass) + BEM
    ├── components/
    │   ├── icons.jsx             # Set SVG inline
    │   └── sections.jsx          # Nav, Hero, Menu, Modales, Tradición, Contacto
    ├── data/
    │   └── packs.js              # Datos de los 4 packs
    └── lib/
        └── tweaks-panel.jsx      # Panel de ajustes en vivo
```

Sin build step. React + Babel se cargan por CDN — abre `index.html` con cualquier servidor estático (`live-server`, `python -m http.server`, GitHub Pages, etc.).

## 🎨 Sistema de diseño

**Tipografía**
- *Fraunces* — display, hero y números (italic para acentos editoriales)
- *Inter* — UI, legible

**Paleta** (definida con `oklch` para consistencia perceptual)
- `--onoto-green` · `--onoto-xanthous` · `--onoto-crimson` · `--onoto-coral`
- Modo claro: cremas cálidas
- Modo oscuro: negro cálido con acentos onoto/xanthous

**Glass tokens**
- `--glass-blur` (28px default, ajustable vía Tweaks)
- `--glass-saturate` (1.9)
- `--glass-tint` y `--glass-border` con tinte cálido en claro, oscuro en dark

**BEM** en todo el CSS: `.bloque__elemento--modificador`.

## 📱 Responsive

Mobile-first. Breakpoints:
- `<600px` — 1 columna de packs, modales como bottom-sheet
- `≥600px` — 2 columnas
- `≥720px` — nav muestra enlaces, hero más espaciado, modales centrados
- `≥1000px` — 4 columnas escalonadas en el menú
- `≥900px` (Tradición/Contacto) — layout 2 columnas

## 🚀 Para correr local

```bash
cd redesign
npx live-server
# o
python -m http.server 8000
```

## 📋 Pendiente (placeholders)

Estas piezas usan placeholders rayados — reemplazar con foto real:

| Slot | Archivo / posición |
|---|---|
| Hero (background) | `Hero` en `sections.jsx` |
| 4 packs (uno por pack) | `data/packs.js` → campo `image` (a agregar) |
| Tradición — manos armando hallaca | Foto grande del mosaico |
| Tradición — guiso | Foto chica top |
| Tradición — hoja de plátano | Foto chica bottom |
| Contacto — retrato Anthony | `Contact` en `sections.jsx` |

También cambiar el número de WhatsApp en:
- `src/app.jsx` — FAB y enlace de contacto
- `src/components/sections.jsx` — `wa.me/56900000000` (búsqueda global)

## 🌐 Despliegue

Compatible directo con **GitHub Pages**:

1. Settings → Pages → Source: `Deploy from branch`
2. Branch: `main` (o la que sea), `/redesign` o `/` raíz si mueves el contenido
3. Listo — `Inicio` servirá `redesign/index.html`
