/**
 * @fileoverview URLs reales de redes sociales y contacto del negocio.
 *
 * Centraliza todos los enlaces a plataformas sociales en un solo lugar
 * para que los componentes Contact, Footer y los CTAs de WhatsApp
 * los consuman de forma consistente.
 *
 * @module data/socials
 */

/**
 * URL corta de WhatsApp con código de mensaje pre-configurado. Úsala SOLO
 * para botones genéricos (FAB flotante, sección Contacto): este formato
 * `wa.me/message/...` ignora el parámetro `?text=`, así que sirve para abrir
 * un chat pero no para prellenar un mensaje.
 */
export const WHATSAPP_URL = 'https://wa.me/message/T6P5RENJ5MNOO1';

/**
 * Número real de WhatsApp (`+56 9 2018 4981`) sin símbolos, para enlaces
 * `https://wa.me/<WHATSAPP_PHONE>?text=<mensaje>`. Úsalo para el pedido del
 * carrito, donde sí necesitamos prellenar el mensaje con el detalle de la compra.
 */
export const WHATSAPP_PHONE = '56920184981';

const socials = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://wa.me/message/T6P5RENJ5MNOO1',
    icon: 'Whatsapp',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://t.me/gglyon23',
    icon: 'Telegram',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com/yn0ht/profilecard/?igsh=Z3I2d2hxdjc3eW5m',
    icon: 'Instagram',
  },
  {
    id: 'x',
    name: 'X',
    url: 'https://x.com/yn0ht?s=21',
    icon: 'XLogo',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    url: 'https://www.facebook.com/share/tnSHU9qJosMEo5zP/?mibextid=LQQJ4d',
    icon: 'Facebook',
  },
];

export default socials;
