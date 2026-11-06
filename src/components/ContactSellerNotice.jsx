import { WHATSAPP_URL } from '../data/socials';
import { IconWhatsapp } from './Icons';

/**
 * PLAN-11 (D9): único lugar donde vive el texto de "contacto directo con el
 * vendedor". Se usa en el carrito, en el pedido por encargo y en
 * OrderTransition, para que la redacción nunca diverja del backend.
 * @param {object} props
 * @param {string} [props.id] DOM id (for aria-describedby).
 * @param {string} [props.waUrl] wa.me URL with a prefilled text; falls back to the generic short link.
 * @param {string} [props.label] Button label.
 */
export default function ContactSellerNotice({ id, waUrl, label = 'Contactar al vendedor' }) {
  return (
    <div className="stock-alert" id={id} role="alert"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
      <span>Para un pedido así, ponte en contacto directo con el vendedor.</span>
      <a className="btn btn--primary" href={waUrl || WHATSAPP_URL} target="_blank" rel="noopener noreferrer"
        style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <IconWhatsapp size={16} /> {label}
      </a>
    </div>
  );
}
