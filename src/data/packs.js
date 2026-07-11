/**
 * @fileoverview Datos del catálogo de packs de hallacas.
 *
 * Cada pack contiene la información necesaria para renderizar las tarjetas
 * del menú, los modales de detalle y los mensajes de checkout a WhatsApp.
 * Las imágenes provienen del hosting original del proyecto en ibb.co.
 *
 * @module data/packs
 */

const packs = [
  {
    id: 'p1',
    name: 'Una probadita',
    qty: 1,
    qtyLabel: '1 hallaca',
    price: 3500,
    tag: 'Para ti',
    tagline: 'Perfecta para conocer el sabor.',
    description:
      'Una hallaca tradicional venezolana, hecha a mano con masa de maíz teñida con onoto, guiso de res, cerdo y pollo, aceitunas, alcaparras, pasitas y aliños frescos. Envuelta en hoja de plátano y amarrada con pabilo, como manda la tradición.',
    ingredients: ['Masa de maíz', 'Onoto', 'Guiso mixto', 'Aceitunas', 'Pasitas', 'Hoja de plátano'],
    image: 'https://i.ibb.co/v62n8w2B/b064c458a44e20aeda58f5ae48a2e546.jpg',
  },
  {
    id: 'p4',
    name: 'Cena íntima',
    qty: 4,
    qtyLabel: '4 hallacas',
    price: 13000,
    tag: 'Popular',
    tagline: 'Para una cena en pareja o entre dos.',
    description:
      'Cuatro hallacas envueltas en hoja de plátano, listas para calentar al baño maría. Vienen con pan de jamón en porción y un toque de ensalada de gallina si lo pides extra. Suficiente para una cena sentada para dos personas con sobras al día siguiente.',
    ingredients: ['4 hallacas', 'Pan de jamón', 'Hoja de plátano', 'Pabilo tradicional'],
    image: 'https://i.ibb.co/m5xVgYsW/60194f47fd48bb2bc2fefe1c651d412e.jpg',
  },
  {
    id: 'p10',
    name: 'Cena familiar',
    qty: 10,
    qtyLabel: '10 hallacas',
    price: 32000,
    tag: 'Mejor valor',
    tagline: 'El plato fuerte de la mesa familiar.',
    description:
      'Diez hallacas para una mesa de familia. Incluye pan de jamón completo, ensalada de gallina y un pernil pequeño para acompañar — la cena navideña venezolana clásica, lista para servir. Ideal para 5–6 personas con segundo plato al día siguiente.',
    ingredients: ['10 hallacas', 'Pan de jamón entero', 'Ensalada de gallina', 'Pernil pequeño'],
    image: 'https://i.ibb.co/JF8jdwxg/f06f9930c92b0ff9b5f0754d1464d89e.jpg',
  },
  {
    id: 'pXL',
    name: 'Diciembre completo',
    qty: 10,
    qtyLabel: '+10 hallacas',
    price: null,
    tag: 'Por encargo',
    tagline: 'Para que tu casa huela a Caracas en diciembre.',
    description:
      'Pedido grande — más de 10 hallacas. Cuéntanos cuántas necesitas y coordinamos contigo cantidad, retiro o despacho y precio. Ideal para encuentros familiares grandes, fiestas de fin de año o regalos para tu gente. Pedido con 5 días de anticipación.',
    ingredients: ['10+ hallacas', 'Misma receta tradicional', 'Coordinación directa', 'Entrega o retiro'],
    image: 'https://i.ibb.co/LdGZg9fN/a73918b40d264892fb9b81da7fce9846.jpg',
  },
];

export default packs;
