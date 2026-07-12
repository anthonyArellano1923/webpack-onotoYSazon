const BASE = process.env.API_URL || '/api';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('oys-token');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

export const registerUser = (body) =>
  apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(body) });

export const loginUser = (body) =>
  apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(body) });

export const placeOrder = (body) =>
  apiFetch('/orders', { method: 'POST', body: JSON.stringify(body) });

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
export const adminGetUsers = () => apiFetch('/admin/users');
export const adminGetPacks = () => apiFetch('/admin/packs');
export const adminUpdatePack = (id, body) =>
  apiFetch(`/admin/packs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const adminGetSettings = () => apiFetch('/admin/settings');
export const adminUpdateSettings = (body) =>
  apiFetch('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
export const adminGetReports = () => apiFetch('/admin/reports');

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
