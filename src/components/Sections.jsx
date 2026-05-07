/* Sections.jsx — all section components for the Liquid Glass redesign */
import { useState, useEffect, useRef } from 'react';
import imgHeroMobile from '../assets/images/hero-mobile.webp';
import imgHeroDesktop from '../assets/images/hero-desktop.webp';
import imgTraditionBig from '../assets/images/tradition-big.jpeg';
import imgTraditionHands from '../assets/images/tradition-hands.jpeg';
import imgTraditionMaking from '../assets/images/tradition-making.jpeg';
import imgContactMobile from '../assets/images/contact-mobile.webp';
import imgContactDesktop from '../assets/images/contact-desktop.webp';
import { placeOrder } from '../services/api';
import {
  IconSparkle, IconHeart, IconPlus, IconMinus, IconClose, IconArrow,
  IconWhatsapp, IconCheck, IconTrash, IconSun, IconMoon, IconCart,
  IconPhone, IconMapPin, IconClock, IconInstagram, IconFacebook,
  IconXLogo, IconTelegram, IconMap,
} from './Icons';
import socials, { WHATSAPP_URL } from '../data/socials';

const formatCLP = (n) => {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
};

/* ---------- Placeholder ---------- */
function Placeholder({ variant, label }) {
  const cls = variant && variant !== "default" ? `placeholder placeholder--${variant}` : "placeholder";
  return (
    <div className={cls} role="img" aria-label={`Placeholder: ${label}`}>
      <span style={{ whiteSpace: "pre-line", lineHeight: 1.4 }}>{label}</span>
    </div>);

}

/* ---------- Nav ---------- */
function Nav({ cartCount, onOpenCart, theme, onToggleTheme, activeSection, user, onOpenAuth, onLogout }) {
  const links = [
  { id: "menu", label: "Menú" },
  { id: "tradition", label: "Tradición" },
  { id: "contact", label: "Contacto" }];

  return (
    <nav className="nav glass glass--pill" aria-label="Principal">
      <a href="#top" className="nav__brand" aria-label="Onoto y Sazón, inicio">
        <span className="nav__brand-mark" aria-hidden="true"></span>
        <span className="nav__brand-name">Onoto&nbsp;y&nbsp;Sazón</span>
      </a>
      <ul className="nav__links" role="list">
        {links.map((l) =>
        <li key={l.id} role="listitem">
            <a href={`#${l.id}`} className={`nav__link${activeSection === l.id ? " nav__link--active" : ""}`}>
              {l.label}
            </a>
          </li>
        )}
      </ul>
      <div className="nav__actions">
        <button className="icon-btn" onClick={onToggleTheme} aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}>
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        {user ? (
          <button
            className="icon-btn"
            onClick={onLogout}
            title={`Sesión: ${user.name} · Cerrar sesión`}
            aria-label={`Cerrar sesión (${user.name})`}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {user.name.split(' ')[0]}
          </button>
        ) : (
          <button
            className="icon-btn"
            onClick={onOpenAuth}
            aria-label="Iniciar sesión"
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Entrar
          </button>
        )}
        <button className="icon-btn" onClick={onOpenCart} aria-label={`Abrir carrito (${cartCount} artículos)`}>
          <IconCart />
          {cartCount > 0 && <span className="icon-btn__badge" aria-hidden="true">{cartCount}</span>}
        </button>
      </div>
    </nav>);

}

/* ---------- Hero ---------- */
function Hero({ onShopClick }) {
  return (
    <section className="hero" id="top" data-screen-label="01 Hero">
      <div className="hero__media" aria-hidden="true">
        <picture className="hero__media-picture">
          <source media="(min-width: 720px)" srcSet={imgHeroDesktop} />
          <img
            src={imgHeroMobile}
            alt="Hallacas venezolanas Onoto y Sazón"
            className="hero__media-img"
            fetchpriority="high"
            decoding="sync"
          />
        </picture>
      </div>
      <span className="hero__eyebrow">
        <span className="hero__eyebrow-dot" aria-hidden="true"></span>
        Pedidos abiertos · Diciembre 2025
      </span>
      <h1 className="hero__title">
        Hallacas hechas <span className="hero__title-em">a&nbsp;mano</span>,<br />con sazón de casa.
      </h1>
      <p className="hero__subtitle">
        Receta venezolana tradicional. Masa con onoto, guiso lento de tres carnes y hoja de plátano. Para tu mesa, en Santiago.
      </p>
      <div className="hero__cta-row">
        <button className="btn btn--primary btn--lg" onClick={onShopClick}>
          Ver el menú <IconArrow size={16} />
        </button>
        <a href="#tradition" className="btn btn--glass-on-photo btn--lg">
          La historia
        </a>
      </div>
      <div className="hero__stats glass">
        <div className="hero__stat">
          <div className="hero__stat-value">100<span className="hero__stat-value-em">%</span></div>
          <span className="hero__stat-label">Receta de la abuela</span>
        </div>
        <div className="hero__stat">
          <div className="hero__stat-value">3<span className="hero__stat-value-em">+1</span></div>
          <span className="hero__stat-label">Carnes en el guiso</span>
        </div>
        <div className="hero__stat">
          <div className="hero__stat-value">48<span className="hero__stat-value-em">h</span></div>
          <span className="hero__stat-label">Anticipación mínima</span>
        </div>
      </div>
    </section>);

}

/* ---------- Menu Card ---------- */
function MenuCard({ pack, onOpen, onAdd, isFav, onToggleFav }) {
  const handleAdd = (e) => {
    e.stopPropagation();
    onAdd(pack);
  };
  return (
    <article
      className="menu-card"
      onClick={() => onOpen(pack)}
      tabIndex={0}
      role="button"
      aria-label={`Ver detalle: ${pack.name}, ${pack.qtyLabel}, ${formatCLP(pack.price)}`}
      onKeyDown={(e) => {if (e.key === "Enter" || e.key === " ") {e.preventDefault();onOpen(pack);}}}>
      
      <div className="menu-card__media" aria-hidden="true">
        {pack.image ? <img className="menu-card__media-img" src={pack.image} alt={pack.name} loading="lazy" /> : <Placeholder variant="default" label={pack.name} />}
      </div>
      <div className="menu-card__top">
        <span className="menu-card__tag">
          <IconSparkle size={11} /> {pack.tag}
        </span>
        <button
          className={`menu-card__fav${isFav ? " menu-card__fav--active" : ""}`}
          onClick={(e) => {e.stopPropagation();onToggleFav(pack.id);}}
          aria-label={isFav ? "Quitar de favoritos" : "Añadir a favoritos"}
          aria-pressed={isFav}>
          
          <IconHeart size={16} filled={isFav} />
        </button>
      </div>
      <div className="menu-card__bottom">
        <div className="menu-card__bottom-glass">
          <p className="menu-card__qty">{pack.qtyLabel}</p>
          <h3 className="menu-card__name">{pack.name}</h3>
          <div className="menu-card__row">
            <div className="menu-card__price">
              {pack.price ? formatCLP(pack.price) : "Consulta"}
            </div>
            <button
              className="menu-card__add"
              onClick={handleAdd}
              aria-label={`Añadir ${pack.name} al carrito`}>
              
              <IconPlus size={20} />
            </button>
          </div>
        </div>
      </div>
    </article>);

}

/* ---------- Menu Section ---------- */
function MenuSection({ packs, onOpenPack, onAddToCart, favs, onToggleFav }) {
  return (
    <section className="section menu" id="menu" data-screen-label="02 Menú">
      <div className="section__inner">
        <header className="menu__header">
          <span className="section__eyebrow">El menú</span>
          <h2 className="section__title">
            Cuatro packs, <span className="section__title-em">una&nbsp;sola receta.</span>
          </h2>
          <p className="section__lede">
            Desde una probadita para conocer el sabor, hasta tu cena familiar de diciembre lista para servir.
          </p>
        </header>
        <div className="menu__grid">
          {packs.map((p) =>
          <MenuCard
            key={p.id}
            pack={p}
            onOpen={onOpenPack}
            onAdd={onAddToCart}
            isFav={favs.includes(p.id)}
            onToggleFav={onToggleFav} />

          )}
        </div>
      </div>
    </section>);

}

/* ---------- Pack Detail Modal ---------- */
function PackModal({ pack, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  useEffect(() => {setQty(1);}, [pack?.id]);
  if (!pack) return null;

  const isCustom = pack.price == null;
  const total = isCustom ? null : pack.price * qty;

  const dec = () => setQty((q) => Math.max(1, q - 1));
  const inc = () => setQty((q) => Math.min(99, q + 1));
  const add = () => {onAdd(pack, qty);onClose();};

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="pack-modal-title">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__handle" aria-hidden="true"></div>
        <button className="modal__close" onClick={onClose} aria-label="Cerrar">
          <IconClose />
        </button>
        <div className="modal__hero" aria-hidden="true">
          {pack.image ? <img className="modal__hero-img" src={pack.image} alt={pack.name} /> : <Placeholder variant="default" label={pack.name} />}
          <span className="modal__hero-tag">{pack.tag}</span>
        </div>
        <div className="modal__body">
          <div>
            <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: 14, fontStyle: "italic", fontFamily: "var(--font-display)" }}>
              {pack.qtyLabel}
            </p>
            <h2 id="pack-modal-title" className="modal__title">
              {pack.name.split(" ").length > 1 ?
              <>
                  {pack.name.split(" ")[0]}{" "}
                  <span className="modal__title-em">{pack.name.split(" ").slice(1).join(" ")}</span>
                </> :
              pack.name}
            </h2>
          </div>
          <p className="modal__desc">{pack.description}</p>
          <div>
            <p className="contact-info__label" style={{ marginBottom: 10 }}>Incluye</p>
            <div className="ingredients">
              {pack.ingredients.map((i) =>
              <span key={i} className="ingredients__chip">
                  <IconCheck size={11} /> {i}
                </span>
              )}
            </div>
          </div>
          {!isCustom &&
          <div className="qty">
              <span className="qty__label">Cantidad de packs</span>
              <div className="qty__controls">
                <button className="qty__btn" onClick={dec} disabled={qty <= 1} aria-label="Disminuir">
                  <IconMinus size={14} />
                </button>
                <span className="qty__value" aria-live="polite">{qty}</span>
                <button className="qty__btn" onClick={inc} aria-label="Aumentar">
                  <IconPlus size={14} />
                </button>
              </div>
            </div>
          }
        </div>
        <div className="modal__footer">
          {!isCustom ?
          <>
              <div className="modal__total">
                <span className="modal__total-label">Total</span>
                <span className="modal__total-value">{formatCLP(total)}</span>
              </div>
              <button className="btn btn--primary modal__cta" onClick={add}>
                Añadir al carrito
              </button>
            </> :

          <a
            className="btn btn--primary modal__cta"
            style={{ flex: 1 }}
            href={`${WHATSAPP_URL}?text=${encodeURIComponent("Hola Anthony, me interesa el pack +15 hallacas para coordinar.")}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}>
            
              <IconWhatsapp size={18} /> Hablar por WhatsApp
            </a>
          }
        </div>
      </div>
    </div>);

}

/* ---------- Cart Modal ---------- */
function CartModal({ items, packs, onClose, onChangeQty, onRemove, onCheckout }) {
  const total = items.reduce((s, it) => {
    const p = packs.find((x) => x.id === it.id);
    return s + (p?.price || 0) * it.qty;
  }, 0);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="cart-modal-title">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal__handle" aria-hidden="true"></div>
        <button className="modal__close" onClick={onClose} aria-label="Cerrar carrito">
          <IconClose />
        </button>
        <div className="modal__body" style={{ paddingTop: 28 }}>
          <div>
            <span className="section__eyebrow">Tu pedido</span>
            <h2 id="cart-modal-title" className="modal__title">
              Carrito <span className="modal__title-em">de hallacas</span>
            </h2>
          </div>
          {items.length === 0 ?
          <div className="cart__empty">
              <span className="cart__empty-icon" aria-hidden="true">🌿</span>
              <p style={{ margin: 0 }}>Tu carrito está vacío.</p>
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>Elige un pack y empieza tu pedido.</p>
            </div> :

          <div className="cart-list">
              {items.map((it) => {
              const p = packs.find((x) => x.id === it.id);
              if (!p) return null;
              return (
                <div key={it.id} className="cart-item">
                    <div className="cart-item__thumb">
                      {p.image ? <img src={p.image} alt={p.name} /> : <Placeholder variant="default" label="" />}
                    </div>
                    <div className="cart-item__body">
                      <h4 className="cart-item__name">{p.name}</h4>
                      <div className="cart-item__meta">{p.qtyLabel} · {formatCLP(p.price)}</div>
                      <div className="qty__controls" style={{ marginTop: 8 }}>
                        <button className="qty__btn" style={{ width: 28, height: 28 }} onClick={() => onChangeQty(it.id, it.qty - 1)} aria-label="Menos">
                          <IconMinus size={12} />
                        </button>
                        <span className="qty__value" style={{ fontSize: 16, minWidth: 24 }}>{it.qty}</span>
                        <button className="qty__btn" style={{ width: 28, height: 28 }} onClick={() => onChangeQty(it.id, it.qty + 1)} aria-label="Más">
                          <IconPlus size={12} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                      <span className="cart-item__price">{formatCLP(p.price * it.qty)}</span>
                      <button className="cart-item__remove" onClick={() => onRemove(it.id)} aria-label={`Eliminar ${p.name}`}>
                        <IconTrash />
                      </button>
                    </div>
                  </div>);

            })}
            </div>
          }
        </div>
        {items.length > 0 &&
        <div className="modal__footer">
            <div className="modal__total">
              <span className="modal__total-label">Total</span>
              <span className="modal__total-value">{formatCLP(total)}</span>
            </div>
            <button className="btn btn--primary modal__cta" onClick={onCheckout}>
              <IconWhatsapp size={16} /> Pedir
            </button>
          </div>
        }
      </div>
    </div>);

}

/* ---------- Checkout Modal ---------- */
function CheckoutModal({ items, packs, user, onClose, onOrderSuccess }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [delivery, setDelivery] = useState("retiro");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const total = items.reduce((s, it) => {
    const p = packs.find((x) => x.id === it.id);
    return s + (p?.price || 0) * it.qty;
  }, 0);

  const buildMessage = () => {
    const lines = [
    "¡Hola Anthony! Quiero hacer un pedido en Onoto y Sazón:",
    "",
    ...items.map((it) => {
      const p = packs.find((x) => x.id === it.id);
      return `• ${it.qty}× ${p.name} (${p.qtyLabel}) — ${formatCLP(p.price * it.qty)}`;
    }),
    "",
    `Total: ${formatCLP(total)}`,
    `Modalidad: ${delivery === "retiro" ? "Retiro" : "Despacho a domicilio"}`,
    `Fecha tentativa: ${date || "por coordinar"}`,
    `Nombre: ${name}`,
    `Teléfono: ${phone}`,
    notes ? `Notas: ${notes}` : null].
    filter(Boolean);
    return lines.join("\n");
  };

  const canSubmit = name.trim() && phone.trim();
  const waUrl = `${WHATSAPP_URL}?text=${encodeURIComponent(buildMessage())}`;

  async function handleConfirm() {
    setApiError("");
    setLoading(true);
    try {
      await placeOrder({
        items: items.map((it) => {
          const p = packs.find((x) => x.id === it.id);
          return { packId: p.id, packName: p.name, qty: it.qty, priceAtTime: p.price ?? null };
        }),
        delivery,
        dateHint: date || null,
        notes: notes || null,
        total: total || null,
      });
      // Pedido guardado — ahora abrimos WhatsApp y limpiamos el carrito
      window.open(waUrl, '_blank', 'noopener,noreferrer');
      onOrderSuccess?.();
      onClose();
    } catch (err) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal__handle" aria-hidden="true"></div>
        <button className="modal__close" onClick={onClose} aria-label="Cerrar">
          <IconClose />
        </button>
        <div className="modal__body" style={{ paddingTop: 28 }}>
          <div>
            <span className="section__eyebrow">Paso {step} de 2</span>
            <h2 id="checkout-title" className="modal__title">
              {step === 1 ? <>Tus <span className="modal__title-em">datos</span></> : <>Confirmemos <span className="modal__title-em">por WhatsApp</span></>}
            </h2>
          </div>

          {step === 1 ?
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Nombre" id="ck-name">
                <input id="ck-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="¿Cómo te llamas?" />
              </Field>
              <Field label="Teléfono" id="ck-phone">
                <input id="ck-phone" className="form-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+56 9 ..." />
              </Field>
              <Field label="Fecha tentativa" id="ck-date">
                <input id="ck-date" className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Modalidad">
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                { v: "retiro", l: "Retiro" },
                { v: "despacho", l: "Despacho" }].
                map((o) =>
                <button
                  key={o.v}
                  type="button"
                  className={`btn ${delivery === o.v ? "btn--primary" : "btn--glass"}`}
                  style={{ flex: 1, minHeight: 44, fontSize: 14 }}
                  onClick={() => setDelivery(o.v)}
                  aria-pressed={delivery === o.v}>

                      {o.l}
                    </button>
                )}
                </div>
              </Field>
              <Field label="Notas (opcional)" id="ck-notes">
                <textarea id="ck-notes" className="form-input" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Picante, sin pasitas, alergias..." />
              </Field>
            </div> :

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ padding: 16, background: "var(--surface-tint)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-line", color: "var(--fg-muted)", fontFamily: "ui-monospace, Menlo, monospace" }}>
                {buildMessage()}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--fg-muted)" }}>
                Al confirmar, guardaremos tu pedido y abriremos WhatsApp con este mensaje listo. Anthony te confirmará disponibilidad y cuenta para transferencia.
              </p>
              {apiError && (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--onoto-crimson, #880D1E)", fontWeight: 500 }}>
                  {apiError}
                </p>
              )}
            </div>
          }
        </div>

        <div className="modal__footer">
          {step === 1 ?
          <>
              <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
              <button
              className="btn btn--primary modal__cta"
              onClick={() => setStep(2)}
              disabled={!canSubmit}
              style={{ opacity: canSubmit ? 1 : 0.5 }}>

                Revisar pedido <IconArrow size={14} />
              </button>
            </> :

          <>
              <button className="btn btn--ghost" onClick={() => setStep(1)} disabled={loading}>Atrás</button>
              <button
                className="btn btn--primary modal__cta"
                onClick={handleConfirm}
                disabled={loading}
              >
                <IconWhatsapp size={16} />
                {loading ? 'Guardando…' : 'Confirmar y enviar'}
              </button>
            </>
          }
        </div>
      </div>
    </div>);

}

function Field({ label, id, children }) {
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-subtle)" }}>{label}</span>
      {children}
    </label>);

}

/* ---------- Tradition ---------- */
function Tradition() {
  return (
    <section className="section tradition" id="tradition" data-screen-label="03 Tradición">
      <div className="section__inner">
        <div className="tradition__inner">
          <div className="tradition__media">
            <div className="tradition__photo tradition__photo--big">
              <img src={imgTraditionBig} alt="Familia venezolana haciendo hallacas" className="tradition__photo-img" loading="lazy" decoding="async" />
              <span className="tradition__photo-glass">Armado a mano</span>
            </div>
            <div className="tradition__photo">
              <img src={imgTraditionHands} alt="Manos armando una hallaca sobre hoja de plátano" className="tradition__photo-img" loading="lazy" decoding="async" />
            </div>
            <div className="tradition__photo">
              <img src={imgTraditionMaking} alt="Familia preparando hallacas juntos" className="tradition__photo-img" loading="lazy" decoding="async" />
            </div>
          </div>
          <div className="tradition__content">
            <span className="section__eyebrow">La historia</span>
            <h2 className="section__title" style={{ fontSize: "clamp(32px, 5vw, 56px)" }}>
              Un plato que <span className="section__title-em">cuenta&nbsp;una&nbsp;historia.</span>
            </h2>
            <blockquote className="tradition__pull">
              "Estás lejos, pero al abrir la hoja de plátano vuelves a casa por un rato. Eso es lo que cocinamos."
            </blockquote>
            <div className="tradition__body">
              <p>
                Para quienes dejamos Venezuela y echamos raíces en Chile, hay sabores que no se reemplazan. La hallaca es uno de ellos. Es la mesa de la abuela, el ruido de la cocina en diciembre, los hermanos amarrando con pabilo, el olor del guiso entrando por debajo de las puertas.
              </p>
              <p>
                Sabemos lo que cuesta encontrar ese sabor acá. Por eso hacemos las hallacas como en casa: masa con onoto, guiso lento de tres carnes, hoja de plátano curada a mano. Sin atajos.
              </p>
              <p>
                En <em>Onoto y Sazón</em> cocinamos para que tu mesa en Santiago tenga, aunque sea por una noche, el sabor del país que llevas adentro. Para que tus hijos prueben lo que tú probabas, y tus amigos chilenos entiendan de qué hablas cuando dices "diciembre".
              </p>
            </div>
            <div className="tradition__ingredients">
              <span className="tradition__ing-chip tradition__ing-chip--accent">Onoto</span>
              <span className="tradition__ing-chip">Maíz</span>
              <span className="tradition__ing-chip">Res</span>
              <span className="tradition__ing-chip">Cerdo</span>
              <span className="tradition__ing-chip">Pollo</span>
              <span className="tradition__ing-chip">Aceitunas</span>
              <span className="tradition__ing-chip">Alcaparras</span>
              <span className="tradition__ing-chip">Pasitas</span>
              <span className="tradition__ing-chip">Hoja de plátano</span>
            </div>
          </div>
        </div>
      </div>
    </section>);

}

/* ---------- Contact ---------- */
function Contact() {
  return (
    <section className="section contact" id="contact" data-screen-label="04 Contacto">
      <div className="section__inner">
        <header style={{ marginBottom: 32 }}>
          <span className="section__eyebrow">Pedidos</span>
          <h2 className="section__title">
            Habla <span className="section__title-em">conmigo.</span>
          </h2>
          <p className="section__lede">
            Cada pedido se coordina directo. Sin intermediarios, sin apps, sin algoritmos.
          </p>
        </header>
        <div className="contact__inner">
          <div className="contact-card">
            <div className="contact-card__media" aria-hidden="true">
              <picture className="contact-card__media-picture">
                <source media="(min-width: 720px)" srcSet={imgContactDesktop} />
                <img src={imgContactMobile} alt="Anthony Arellano en la cocina preparando hallacas" className="contact-card__media-img" loading="lazy" decoding="async" />
              </picture>
            </div>
            <h3 className="contact-card__name">Anthony Arellano</h3>
            <p className="contact-card__role">Cocinero · Onoto y Sazón</p>
            <div className="contact-card__socials">
              {socials.filter(s => s.id !== 'whatsapp').map(s => {
                const SocialIcon = IconMap[s.icon];
                return (
                  <a key={s.id} className="social-pill" href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`${s.name} de Onoto y Sazón`}>
                    {SocialIcon && <SocialIcon size={15} />} {s.name}
                  </a>
                );
              })}
            </div>
          </div>
          <div className="contact-info">
            <div className="contact-info__row">
              <span className="contact-info__icon"><IconPhone /></span>
              <div>
                <p className="contact-info__label">WhatsApp directo</p>
                <p className="contact-info__value">+56 9 2018 4981</p>
              </div>
            </div>
            <div className="contact-info__row">
              <span className="contact-info__icon"><IconMapPin /></span>
              <div>
                <p className="contact-info__label">Retiro</p>
                <p className="contact-info__value">Providencia, Santiago</p>
              </div>
            </div>
            <div className="contact-info__row">
              <span className="contact-info__icon"><IconClock /></span>
              <div>
                <p className="contact-info__label">Anticipación</p>
                <p className="contact-info__value">48h mínimo · 5 días para packs grandes</p>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <a className="btn btn--primary btn--lg" style={{ width: "100%" }} href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                <IconWhatsapp size={18} /> Escribir por WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>);

}

/* ---------- Footer ---------- */
function Footer() {
  return (
    <footer className="footer">
      <p className="footer__line footer__line--em">Delia, la negra y cabez'e mango.</p>
      <p className="footer__line">Esta página existe gracias a ellos.</p>
      <p className="footer__line" style={{ marginTop: 12, fontSize: 12, color: "var(--fg-subtle)" }}>
        © 2026 Onoto y Sazón · Hecho con sazón en Santiago
      </p>
    </footer>);

}

export {
  formatCLP, Placeholder, Nav, Hero, MenuCard, MenuSection,
  PackModal, CartModal, CheckoutModal, Field, Tradition, Contact, Footer,
};