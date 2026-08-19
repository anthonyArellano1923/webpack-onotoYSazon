/**
 * @fileoverview Componente principal de la aplicación OnotoYSazón.
 * Orquesta tema, carrito, favoritos, modales y tweaks panel.
 * @module App
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import staticPacks from './data/packs';
import { WHATSAPP_URL } from './data/socials';
import { IconCart, IconWhatsapp, IconCheck } from './components/Icons';
import {
  formatCLP, Nav, Hero, MenuSection, PackModal,
  CartModal, Tradition, Contact, Footer,
} from './components/Sections';
import {
  useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle,
} from './lib/TweaksPanel';
import AuthModal from './components/AuthModal';
import AdminDashboard from './components/AdminDashboard';
import { getStoredUser, clearAuth, getPacks } from './services/api';

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

  /* Packs: la BD es la fuente de verdad (precios y disponibilidad editables
     desde el admin). packs.js queda como fallback visual si la API no
     responde (sin flag `available` ⇒ todo se muestra disponible). */
  const [packs, setPacks] = useState(staticPacks);
  const [stockAvailable, setStockAvailable] = useState(null);
  // QA-13: extraído a función reutilizable para poder refrescar el catálogo
  // desde el panel de admin tras cada guardado (packs, ajustes, ventas).
  const refreshPacks = useCallback(() => {
    return getPacks()
      .then((data) => {
        if (data.packs?.length) setPacks(data.packs);
        if (Number.isFinite(data.stock_available)) {
          setStockAvailable(Math.max(0, Math.trunc(data.stock_available)));
        }
      })
      .catch((err) => console.warn('No se pudo cargar el catálogo desde la API, usando fallback:', err.message));
  }, []);
  useEffect(() => { refreshPacks(); }, [refreshPacks]);

  /* Cart */
  const [cart, setCart] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('oys-cart') || '[]');
      if (!Array.isArray(stored)) return [];
      return stored
        .filter((item) => item && typeof item.id === 'string')
        .map((item) => ({ ...item, qty: Math.trunc(Number(item.qty)) }))
        .filter((item) => Number.isFinite(item.qty) && item.qty > 0);
    } catch { return []; }
  });
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  useEffect(() => { localStorage.setItem('oys-cart', JSON.stringify(cart)); }, [cart]);

  const cartCount = cart.reduce((s, it) => s + (Number.isFinite(it.qty) ? it.qty : 0), 0);
  const cartTotal = cart.reduce((s, it) => {
    const p = packs.find((x) => x.id === it.id);
    return s + (p?.price || 0) * (Number.isFinite(it.qty) ? it.qty : 0);
  }, 0);
  const countCartHallacas = (items) => items.reduce((sum, item) => {
    const pack = packs.find((candidate) => candidate.id === item.id);
    if (pack?.price == null || !Number.isFinite(pack.qty) || !Number.isFinite(item.qty)) return sum;
    return sum + pack.qty * item.qty;
  }, 0);
  const cartHallacas = countCartHallacas(cart);
  const stockKnown = Number.isFinite(stockAvailable);
  const stockExceeded = stockKnown && cartHallacas > stockAvailable;

  const commitCart = (nextCart) => {
    cartRef.current = nextCart;
    setCart(nextCart);
  };

  const addToCart = (pack, qty = 1) => {
    const amount = Math.max(1, Math.min(99, Math.trunc(Number(qty) || 1)));
    if (pack.price == null) return false;
    if (pack.available === false) { showToast(`${pack.name} está agotado`); return false; }
    const currentCart = cartRef.current;
    const projectedHallacas = countCartHallacas(currentCart) + (pack.qty * amount);
    if (stockKnown && projectedHallacas > stockAvailable) {
      showToast('Stock máximo alcanzado. Ajusta tu pedido o consulta la próxima tanda.');
      return false;
    }
    const existing = currentCart.find((item) => item.id === pack.id);
    if (existing && Number(existing.qty) + amount > 99) {
      showToast(`Puedes añadir hasta 99 packs de ${pack.name}`);
      return false;
    }
    const nextCart = existing
      ? currentCart.map((item) => (item.id === pack.id ? { ...item, qty: Number(item.qty) + amount } : item))
      : [...currentCart, { id: pack.id, qty: amount }];
    commitCart(nextCart);
    showToast(`${pack.name} añadido`);
    return true;
  };
  const changeQty = (id, qty) => {
    const currentCart = cartRef.current;
    const currentItem = currentCart.find((item) => item.id === id);
    if (!currentItem) return false;
    const requestedQty = Math.trunc(Number(qty));
    if (!Number.isFinite(requestedQty)) return false;
    if (requestedQty <= 0) {
      commitCart(currentCart.filter((item) => item.id !== id));
      return true;
    }

    // Una selección persistida puede haber quedado sobre el stock actual. En
    // ese caso siempre permitimos disminuir; sólo bloqueamos incrementos.
    if (requestedQty > currentItem.qty && currentItem.qty >= 99) return false;
    const nextQty = requestedQty > currentItem.qty ? Math.min(99, requestedQty) : requestedQty;
    const pack = packs.find((candidate) => candidate.id === id);
    if (nextQty > currentItem.qty && pack?.available === false) {
      showToast(`${pack.name} está agotado`);
      return false;
    }
    if (nextQty > currentItem.qty && pack?.price != null && stockKnown) {
      const projectedHallacas = countCartHallacas(currentCart)
        + (nextQty - currentItem.qty) * pack.qty;
      if (projectedHallacas > stockAvailable) {
        showToast('Stock máximo alcanzado. Ajusta tu pedido o consulta la próxima tanda.');
        return false;
      }
    }
    commitCart(currentCart.map((item) => (item.id === id ? { ...item, qty: nextQty } : item)));
    return true;
  };
  const removeFromCart = (id) => commitCart(cartRef.current.filter((item) => item.id !== id));
  const clearCart = () => commitCart([]);

  /* Favorites */
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('oys-favs') || '[]'); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('oys-favs', JSON.stringify(favs)); }, [favs]);
  const toggleFav = (id) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  /* Auth */
  const [user, setUser] = useState(() => getStoredUser());
  // QA-04: null | 'login' | 'register' — reemplaza el booleano para poder
  // pedir una pestaña específica al abrir el modal.
  const [authModal, setAuthModal] = useState(null);
  const openAuth = (tabName = 'login') => setAuthModal(tabName);

  const handleLogout = () => {
    // QA-03: confirmación antes de cerrar sesión — el botón del nav ejecutaba
    // el logout al primer clic, sin fricción.
    if (!window.confirm(`¿Cerrar la sesión de ${user?.name}?`)) return;
    clearAuth();
    setUser(null);
    showToast('Sesión cerrada');
  };

  /* Modals */
  const [openPack, setOpenPack] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    const anyOpen = openPack || cartOpen || authModal;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [openPack, cartOpen, authModal]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (authModal) setAuthModal(null);
      else if (cartOpen) setCartOpen(false);
      else if (openPack) setOpenPack(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPack, cartOpen, authModal]);

  /* Toast */
  const [toast, setToast] = useState({ visible: false, msg: '' });
  const showToast = useCallback((msg) => {
    setToast({ visible: true, msg });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2200);
  }, []);

  useReveal();
  const activeSection = useActiveSection();

  return (
    <div className="app">
      <a href="#menu" className="skip-link">Saltar al menú</a>
      <div className="app__ambient" aria-hidden="true"></div>

      <Nav cartCount={cartCount} onOpenCart={() => setCartOpen(true)}
           theme={theme} onToggleTheme={handleToggleTheme} activeSection={activeSection}
           user={user} onOpenAuth={() => openAuth('login')} onLogout={handleLogout}
           onOpenAdmin={() => setAdminOpen(true)} />

      <main>
        <Hero onShopClick={() => {
          document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }} />
        <div className="reveal"><MenuSection packs={packs} onOpenPack={setOpenPack}
          onAddToCart={addToCart} favs={favs} onToggleFav={toggleFav}
          stockAvailable={stockAvailable} cartHallacas={cartHallacas} /></div>
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
      {openPack && <PackModal pack={openPack} user={user} onClose={() => setOpenPack(null)} onAdd={addToCart}
        onOpenAuth={openAuth} stockAvailable={stockAvailable} cartHallacas={cartHallacas} />}
      {cartOpen && <CartModal items={cart} packs={packs} user={user} onClose={() => setCartOpen(false)}
        onChangeQty={changeQty} onRemove={removeFromCart}
        onOrderSuccess={() => { clearCart(); refreshPacks(); }} onOrderFailure={refreshPacks}
        onOpenAuth={openAuth} stockAvailable={stockAvailable} cartHallacas={cartHallacas}
        stockExceeded={stockExceeded} />}
      {authModal && (
        <AuthModal
          initialTab={authModal}
          onClose={() => setAuthModal(null)}
          onSuccess={(loggedUser) => {
            setUser(loggedUser);
            setAuthModal(null);
          }}
        />
      )}
      {adminOpen && user?.role === 'admin' && (
        <AdminDashboard onClose={() => setAdminOpen(false)} onCatalogChange={refreshPacks} />
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
