/**
 * @fileoverview URLs reales de redes sociales y contacto del negocio.
 *
 * Centraliza todos los enlaces a plataformas sociales en un solo lugar
 * para que los componentes Contact, Footer y los CTAs de WhatsApp
 * los consuman de forma consistente.
 *
 * @module data/socials
 */

/** URL del link de WhatsApp con código de mensaje pre-configurado. */
export const WHATSAPP_URL = 'https://wa.me/message/T6P5RENJ5MNOO1';

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
