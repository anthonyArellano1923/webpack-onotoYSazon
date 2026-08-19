# Guía de contenido editable

Este documento es para Anthony: dónde vive cada texto de la web que puede
querer cambiar, sin tener que buscarlo en todo el código.

**Importante:** todo esto es contenido **estático** (compilado en el JSX). No
está en la base de datos, así que después de editar un archivo hay que hacer
`npm run build` y volver a desplegar para que el cambio se vea en
www.onotoysazon.cl. Si en algún momento se quiere que un texto sea editable
desde el panel de admin sin redeploy, hay que pedírselo al arquitecto — es un
cambio de arquitectura, no de contenido.

| Texto | Ubicación actual | Notas |
|---|---|---|
| "Pedidos abiertos · Diciembre 2026" | `src/components/Sections.jsx`, componente `Hero`, dentro de `.hero__eyebrow` | Se actualiza cada temporada. |
| Celular de contacto "+56 9 2018 4981" | `src/components/Sections.jsx`, componente `Contact` | **OJO:** este es solo el texto que se muestra. El número REAL al que llegan los mensajes de los botones de WhatsApp vive en `src/data/socials.js` (`WHATSAPP_PHONE`). Si el número cambia, hay que tocar **ambos** archivos. |
| Dirección de retiro "Santiago Centro" | `src/components/Sections.jsx`, componente `Contact` | Actualizar también los datos estructurados en `public/index.html` si cambia. |
| Anticipación "48h mínimo · 1 semana para pedidos grandes" | `src/components/Sections.jsx`, componente `Contact` | El "48h" también aparece por separado en la tarjeta de estadísticas del Hero (mismo archivo, componente `Hero`, sección `.hero__stats`) — si cambia la anticipación mínima, revisar los dos lugares. |
| Ingredientes de la hallaca (chips de la sección "La historia") | `src/data/ingredients.js` | Ya no está hardcodeado en el JSX — es un array `{ name, accent? }`. Para agregar/quitar un ingrediente basta con editar este archivo (no hace falta tocar `Sections.jsx`). |

## Cómo buscar estos puntos en el código

Cada uno de los textos de arriba tiene un comentario `// QA-02` o `// QA-05`
justo encima en `Sections.jsx` para ubicarlo rápido con Ctrl+F / Cmd+F.
