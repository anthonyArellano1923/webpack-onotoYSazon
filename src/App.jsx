/**
 * @fileoverview Componente principal de la aplicación OnotoYSazón.
 * Orquesta tema, carrito, favoritos, modales y tweaks panel.
 * @module App
 */
import { useState, useEffect, useCallback } from 'react';
import packs from './data/packs';
import { WHATSAPP_URL } from './data/socials';
import { IconCart, IconWhatsapp, IconCheck } from './components/Icons';
import {
  formatCLP, Nav, Hero, MenuSection, PackModal,
  CartModal, CheckoutModal, Tradition, Contact, Footer,
} from './components/Sections';
import {
  useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle,
} from './lib/TweaksPanel';
import AuthModal from './components/AuthModal';
import { getStoredUser, clearAuth } from './services/api';

/* ---- Hooks ---- */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('oys-theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('oys-theme', theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle, setTheme];
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('reveal--visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('reveal--visible');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function useActiveSection() {
  const [active, setActive] = useState('');
  useEffect(() => {
    const ids = ['menu', 'tradition', 'contact'];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { threshold: [0.2, 0.5, 0.8] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

/* ---- App ---- */
export default function App() {
  const TWEAK_DEFAULTS = { blur: 28, darkMode: false };
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [theme, toggleTheme, setTheme] = useTheme();

  useEffect(() => { setTheme(tweaks.darkMode ? 'dark' : 'light'); }, [tweaks.darkMode]);
  useEffect(() => { document.documentElement.style.setProperty('--glass-blur', `${tweaks.blur}px`); }, [tweaks.blur]);

  const handleToggleTheme = () => { setTweak('darkMode', theme !== 'dark'); };

  /* Cart */
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('oys-cart') || '[]'); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('oys-cart', JSON.stringify(cart)); }, [cart]);

  const cartCount = cart.reduce((s, it) => s + it.qty, 0);
  const cartTotal = cart.reduce((s, it) => {
    const p = packs.find((x) => x.id === it.id);
    return s + (p?.price || 0) * it.qty;
  }, 0);

  const addToCart = (pack, qty = 1) => {
    if (pack.price == null) return;
    setCart((c) => {
      const ex = c.find((it) => it.id === pack.id);
      if (ex) return c.map((it) => (it.id === pack.id ? { ...it, qty: it.qty + qty } : it));
      return [...c, { id: pack.id, qty }];
    });
    showToast(`${pack.name} añadido`);
  };
  const changeQty = (id, qty) => {
    if (qty <= 0) return setCart((c) => c.filter((it) => it.id !== id));
    setCart((c) => c.map((it) => (it.id === id ? { ...it, qty: Math.min(99, qty) } : it)));
  };
  const removeFromCart = (id) => setCart((c) => c.filter((it) => it.id !== id));

  /* Favorites */
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('oys-favs') || '[]'); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('oys-favs', JSON.stringify(favs)); }, [favs]);
  const toggleFav = (id) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  /* Auth */
  const [user, setUser] = useState(() => getStoredUser());
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const handleLogout = () => {
    clearAuth();
    setUser(null);
    showToast('Sesión cerrada');
  };

  /* Modals */
  const [openPack, setOpenPack] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    const anyOpen = openPack || cartOpen || checkoutOpen || authModalOpen;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [openPack, cartOpen, checkoutOpen, authModalOpen]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (authModalOpen) setAuthModalOpen(false);
      else if (checkoutOpen) setCheckoutOpen(false);
      else if (cartOpen) setCartOpen(false);
      else if (openPack) setOpenPack(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPack, cartOpen, checkoutOpen, authModalOpen]);

  /* Toast */
  const [toast, setToast] = useState({ visible: false, msg: '' });
  const showToast = useCallback((msg) => {
    setToast({ visible: true, msg });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2200);
  }, []);

  useReveal();
  const activeSection = useActiveSection();

  const handleCheckoutFromCart = () => {
    setCartOpen(false);
    if (!user) {
      setAuthModalOpen(true);
    } else {
      setCheckoutOpen(true);
    }
  };

  return (
    <div className="app">
      <a href="#menu" className="skip-link">Saltar al menú</a>
      <div className="app__ambient" aria-hidden="true"></div>

      <Nav cartCount={cartCount} onOpenCart={() => setCartOpen(true)}
           theme={theme} onToggleTheme={handleToggleTheme} activeSection={activeSection}
           user={user} onOpenAuth={() => setAuthModalOpen(true)} onLogout={handleLogout} />

      <main>
        <Hero onShopClick={() => {
          document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }} />
        <div className="reveal"><MenuSection packs={packs} onOpenPack={setOpenPack}
          onAddToCart={addToCart} favs={favs} onToggleFav={toggleFav} /></div>
        <div className="reveal"><Tradition /></div>
        <div className="reveal"><Contact /></div>
      </main>

      <Footer />

      {/* Floating cart pill */}
      <button className={`cart-fab${cartCount === 0 ? ' cart-fab--hidden' : ''}`}
              onClick={() => setCartOpen(true)}
              aria-label={`Ver carrito · ${cartCount} packs · ${formatCLP(cartTotal)}`}>
        <span className="cart-fab__icon" aria-hidden="true"><IconCart size={16} /></span>
        <span className="cart-fab__count-bubble" aria-hidden="true">{cartCount}</span>
        <span className="cart-fab__text">
          <span className="cart-fab__label">Tu carrito</span>
          <span className="cart-fab__total">{formatCLP(cartTotal)}</span>
        </span>
      </button>

      {/* Floating WhatsApp */}
      <a className="wa-fab" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"
         aria-label="Escribir por WhatsApp">
        <IconWhatsapp size={24} />
      </a>

      {/* Toast */}
      <div className={`toast${toast.visible ? ' toast--visible' : ''}`} role="status" aria-live="polite">
        <span className="toast__check"><IconCheck size={12} /></span>
        {toast.msg}
      </div>

      {/* Modals */}
      {openPack && <PackModal pack={openPack} onClose={() => setOpenPack(null)} onAdd={addToCart} />}
      {cartOpen && <CartModal items={cart} packs={packs} onClose={() => setCartOpen(false)}
        onChangeQty={changeQty} onRemove={removeFromCart} onCheckout={handleCheckoutFromCart} />}
      {checkoutOpen && (
        <CheckoutModal
          items={cart}
          packs={packs}
          user={user}
          onClose={() => setCheckoutOpen(false)}
          onOrderSuccess={() => setCart([])}
        />
      )}
      {authModalOpen && (
        <AuthModal
          onClose={() => setAuthModalOpen(false)}
          onSuccess={(loggedUser) => {
            setUser(loggedUser);
            setAuthModalOpen(false);
            setCheckoutOpen(true);
          }}
        />
      )}

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Vidrio">
          <TweakSlider label="Intensidad del blur" value={tweaks.blur}
                       min={0} max={48} step={2} onChange={(v) => setTweak('blur', v)} suffix="px" />
        </TweakSection>
        <TweakSection label="Apariencia">
          <TweakToggle label="Modo oscuro" checked={tweaks.darkMode}
                       onChange={(v) => setTweak('darkMode', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}
