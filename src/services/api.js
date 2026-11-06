const BASE = process.env.API_URL || '/api';

// PLAN-11: timeout por defecto de las llamadas (cold start de Render incluido).
const DEFAULT_TIMEOUT_MS = 15000;
const MSG_NETWORK = 'No pudimos conectar con el servidor. Intenta de nuevo.';
const MSG_TIMEOUT = 'El servidor tardó demasiado en responder. Intenta de nuevo.';
const MSG_SERVER = 'El servidor tuvo un problema. Intenta de nuevo en unos minutos.';
const MSG_SESSION = 'Tu sesión expiró. Inicia sesión nuevamente.';

// PLAN-11: suscriptores del cierre de sesión forzado (401 con token presente).
const unauthorizedListeners = new Set();

/**
 * Subscribes to forced logouts (a 401 received while a token was stored).
 * @param {() => void} fn Callback invoked after the token has been cleared.
 * @returns {() => void} Unsubscribe function.
 */
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

/** Builds an Error carrying status/code/data so callers can branch on them. */
function apiError(message, status, code, data) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.data = data || {};
  return err;
}

/**
 * Thin fetch wrapper. PLAN-11 hardening:
 * - aborts after `timeoutMs` (default 15 s) with a clear message;
 * - never leaks raw parser/network errors ("Unexpected token…") to the UI;
 * - a 401 on a request that carried a token clears the session and notifies
 *   subscribers (not for /auth/*, where 401 means wrong credentials);
 * - every failure is an Error with `status`, `code` and `data`.
 */
async function apiFetch(path, { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const token = localStorage.getItem('oys-token');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    clearTimeout(timer);
    // status 0 = nunca hubo respuesta. TIMEOUT se distingue porque un POST
    // pudo haberse procesado igualmente en el servidor.
    throw timedOut
      ? apiError(MSG_TIMEOUT, 0, 'TIMEOUT')
      : apiError(MSG_NETWORK, 0, 'NETWORK');
  }

  // El cuerpo también cuenta para el timeout: se lee antes de limpiar el timer.
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {}; // cuerpo vacío o no-JSON (p. ej. HTML de un proxy): sin error crudo
  } finally {
    clearTimeout(timer);
  }
  if (data === null || typeof data !== 'object') data = {};

  if (res.ok) return data;

  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    // Solo si el token guardado sigue siendo el enviado: evita cerrar una
    // sesión nueva si el usuario volvió a entrar mientras la petición volaba.
    if (localStorage.getItem('oys-token') === token) {
      clearAuth();
      unauthorizedListeners.forEach((fn) => { try { fn(); } catch { /* no crítico */ } });
    }
    throw apiError(MSG_SESSION, 401, 'SESSION_EXPIRED', data);
  }

  if (res.status >= 500 && res.status !== 503) {
    throw apiError(MSG_SERVER, res.status, data.code, data);
  }
  const msg = (typeof data.error === 'string' && data.error)
    || data.errors?.[0]?.msg
    || (res.status >= 500 ? MSG_SERVER : MSG_NETWORK);
  throw apiError(msg, res.status, data.code, data);
}

export const registerUser = (body) =>
  apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(body) });

export const loginUser = (body) =>
  apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(body) });

// PLAN-11: timeout más holgado para crear pedidos (no es idempotente: abortar
// antes de tiempo podría dejar un pedido creado sin que el cliente lo sepa).
export const placeOrder = (body) =>
  apiFetch('/orders', { method: 'POST', body: JSON.stringify(body), timeoutMs: 25000 });

export const getMyOrders = () => apiFetch('/orders/mine');

// Catálogo público: la BD es la fuente de verdad (precios/disponibilidad
// editables desde el admin); packs.js queda como fallback si la API no responde.
export const getPacks = () => apiFetch('/packs');

/* ---- Panel admin (todas requieren token con role=admin) ---- */
export const adminGetOrders = () => apiFetch('/admin/orders');
export const adminCreateSale = (body) =>
  apiFetch('/admin/orders', { method: 'POST', body: JSON.stringify(body) });
export const adminUpdateOrder = (id, body) =>
  apiFetch(`/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
// QA-12: borrado físico de venta.
export const adminDeleteOrder = (id) => apiFetch(`/admin/orders/${id}`, { method: 'DELETE' });
export const adminGetUsers = () => apiFetch('/admin/users');
// QA-12 (ampliado): borrado físico de usuario (403 si es admin, lo maneja el backend).
export const adminDeleteUser = (id) => apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
export const adminGetPacks = () => apiFetch('/admin/packs');
export const adminUpdatePack = (id, body) =>
  apiFetch(`/admin/packs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const adminGetSettings = () => apiFetch('/admin/settings');
export const adminUpdateSettings = (body) =>
  apiFetch('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
export const adminGetReports = () => apiFetch('/admin/reports');
// QA-16: lotes de producción (ADR-2 — eventos históricos, divisor de ventas).
export const adminGetBatches = () => apiFetch('/admin/batches');
export const adminCreateBatch = (body) =>
  apiFetch('/admin/batches', { method: 'POST', body: JSON.stringify(body) });
export const adminUpdateBatch = (id, body) =>
  apiFetch(`/admin/batches/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const adminDeleteBatch = (id) => apiFetch(`/admin/batches/${id}`, { method: 'DELETE' });
// ADR-3 (plan 09): el stock es un dato propio (movimientos), no una fórmula
// sobre las tandas. El kardex mezcla movimientos y ventas vivas por fecha.
export const adminGetKardex = () => apiFetch('/admin/stock/kardex');
export const adminCreateMovement = (body) =>
  apiFetch('/admin/stock/movements', { method: 'POST', body: JSON.stringify(body) });
export const adminDeleteMovement = (id) =>
  apiFetch(`/admin/stock/movements/${id}`, { method: 'DELETE' });

// Gestión del estado de autenticación en localStorage
export function saveAuth(accessToken, user) {
  localStorage.setItem('oys-token', accessToken);
  localStorage.setItem('oys-user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('oys-token');
  localStorage.removeItem('oys-user');
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('oys-user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
