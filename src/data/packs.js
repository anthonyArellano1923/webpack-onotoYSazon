/**
 * @fileoverview Datos del catálogo de packs de hallacas.
 *
 * Cada pack contiene la información necesaria para renderizar las tarjetas
 * del menú, los modales de detalle y los mensajes de checkout a WhatsApp.
 * Las imágenes son assets locales (webp) empaquetados por Webpack. La BD
 * guarda solo una clave (`pack-<id>`); `resolvePackImage` la traduce a la URL
 * del asset.
 *
 * @module data/packs
 */

import imgP1 from '../assets/images/pack-p1.webp';
import imgP4 from '../assets/images/pack-p4.webp';
import imgP10 from '../assets/images/pack-p10.webp';
import imgPXL from '../assets/images/pack-pXL.webp';

const PACK_IMAGES = { 'pack-p1': imgP1, 'pack-p4': imgP4, 'pack-p10': imgP10, 'pack-pXL': imgPXL };

/**
 * Traduce la clave de imagen guardada en la BD al asset empaquetado.
 * Si no es una clave conocida (p. ej. una URL absoluta) la deja intacta.
 * @param {string|null|undefined} image
 * @returns {string|null|undefined}
 */
export const resolvePackImage = (image) => PACK_IMAGES[image] || image;

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
    image: PACK_IMAGES['pack-p1'],
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
    image: PACK_IMAGES['pack-p4'],
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
    image: PACK_IMAGES['pack-p10'],
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
      'Pedido grande — más de 10 hallacas. Cuéntanos cuántas necesitas y coordinamos contigo cantidad, retiro o despacho y precio. Ideal para encuentros familiares grandes, fiestas de fin de año o regalos para tu gente. Pedido con 1 semana de anticipación.',
    ingredients: ['10+ hallacas', 'Misma receta tradicional', 'Coordinación directa', 'Entrega o retiro'],
    image: PACK_IMAGES['pack-pXL'],
  },
];

export default packs;
