# 🚀 Instrucciones para crear el Pull Request

## 1. Clona el repo y crea la rama

```bash
git clone https://github.com/anthonyArellano1923/onoto-y-sazon.git
cd onoto-y-sazon

# Crear rama nueva desde main (no toca producción)
git checkout -b redesign/liquid-glass
```

## 2. Copia los archivos del rediseño

Descarga el folder `redesign/` de este proyecto (o cópialo manualmente) a la raíz del repo. La estructura debería quedar así:

```
onoto-y-sazon/
├── public/                  # original (déjalo como está por ahora)
├── src/                     # original
├── redesign/                # ← NUEVO
│   ├── index.html
│   ├── README.md
│   └── src/
│       ├── app.jsx
│       ├── styles/styles.css
│       ├── components/...
│       ├── data/packs.js
│       └── lib/tweaks-panel.jsx
└── ...
```

> 💡 También puedes mover el rediseño directamente a `public/` reemplazando lo viejo. En ese caso, borra `public/index.html` y `src/css/style.css` antes de copiar y ajusta los paths en `index.html`.

## 3. Verifica localmente

```bash
cd redesign
npx live-server   # o python -m http.server 8000
```

Abre `http://localhost:8080` y revisa que todo funcione.

## 4. Commit y push

```bash
cd ..   # volver a la raíz del repo
git add redesign/
git status   # revisa que solo se agreguen los archivos nuevos

git commit -m "feat: rediseño Liquid Glass mobile-first

- Hero a sangre completa con nav flotante en vidrio
- Tarjetas de menú con backdrop-filter sobre foto del pack
- Modal de detalle con selector de cantidad y total dinámico
- Carrito flotante persistente + checkout 2 pasos a WhatsApp
- Modo claro/oscuro con tokens oklch
- Tweaks panel: intensidad de blur configurable
- Sistema BEM, accesible (AA), respeta prefers-reduced-motion
- Tipografía: Fraunces (display) + Inter (UI)"

git push -u origin redesign/liquid-glass
```

## 5. Abre el Pull Request

Después del push, GitHub te imprimirá un link directo en la terminal:

```
remote: Create a pull request for 'redesign/liquid-glass' on GitHub by visiting:
remote:      https://github.com/anthonyArellano1923/onoto-y-sazon/pull/new/redesign/liquid-glass
```

Cópialo en el navegador, o ve manualmente a:
**https://github.com/anthonyArellano1923/onoto-y-sazon/compare/main...redesign/liquid-glass**

### Sugerencia de descripción del PR

```markdown
## 🎨 Rediseño Liquid Glass

Rediseño completo aplicando el lenguaje visual Liquid Glass: paneles translúcidos, controles flotantes, fotografía a sangre completa.

### Cambios
- ✅ Mobile-first responsive (320px → desktop)
- ✅ Modo claro/oscuro
- ✅ Carrito + checkout funcional → WhatsApp
- ✅ Accesibilidad WCAG AA
- ✅ Metodología BEM en CSS
- ✅ Tipografía: Fraunces + Inter
- ✅ Tweaks panel para ajustar blur en vivo

### Pendiente antes de merge
- [ ] Reemplazar placeholders por fotos reales de las hallacas
- [ ] Cambiar número de WhatsApp `+56900000000` por el real
- [ ] Decidir si reemplazamos `public/index.html` viejo o mantenemos ambos

### Cómo probar
\`\`\`bash
cd redesign
npx live-server
\`\`\`

Ver `redesign/README.md` para detalles del sistema de diseño.
```

## 6. (Opcional) Después del merge

Cuando el PR se apruebe y mergee, puedes eliminar la rama local:

```bash
git checkout main
git pull
git branch -d redesign/liquid-glass
```

---

## 🔄 Si quieres iterar antes del merge

Cualquier cambio adicional que pidas, lo aplico y luego haces:

```bash
git add .
git commit -m "fix: <descripción>"
git push
```

El PR se actualiza automáticamente.
