import { useState, useEffect, useCallback } from 'react';
import {
  adminGetOrders, adminCreateSale, adminUpdateOrder,
  adminGetUsers, adminGetPacks, adminUpdatePack,
  adminGetSettings, adminUpdateSettings, adminGetReports,
} from '../services/api';
import { formatCLP } from './Sections';
import { normalizePhone, phoneToDigits } from '../utils/phone';
import { IconClose } from './Icons';

// Vocabulario del Excel del dueño ('cancelado' es nuestro, para no borrar filas)
const STATUS_LABELS = {
  pagado: 'Pagado',
  pendiente_pago: 'Pendiente pago',
  pendiente_entrega: 'Pendiente entrega',
  entregado: 'Entregado',
  cortesia: 'Cortesía',
  cancelado: 'Cancelado',
};
const METHOD_LABELS = { cuenta_vista: 'Cuenta vista', efectivo: 'Efectivo' };

/** created_at viene de SQLite en UTC ("YYYY-MM-DD HH:MM:SS"); se muestra en hora local. */
function formatLocalDate(utc) {
  if (!utc) return '—';
  const date = new Date(utc.replace(' ', 'T') + 'Z');
  return date.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'packs', label: 'Packs y precios' },
  { id: 'ajustes', label: 'Ajustes' },
];

/**
 * Panel de administración: réplica del Excel de control de ventas del dueño.
 * Pantalla completa (no modal) porque las tablas necesitan espacio.
 */
export default function AdminDashboard({ onClose }) {
  const [tab, setTab] = useState('resumen');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="admin-panel" role="dialog" aria-modal="true" aria-label="Panel de administración">
      <div className="admin-panel__header">
        <h2 className="modal__title" style={{ margin: 0 }}>
          Panel <span className="modal__title-em">de administración</span>
        </h2>
        <button className="modal__close" style={{ position: 'static' }} onClick={onClose} aria-label="Cerrar panel">
          <IconClose />
        </button>
      </div>

      <div className="admin-panel__tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`admin-tab${tab === t.id ? ' admin-tab--active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab />}
      {tab === 'ventas' && <VentasTab />}
      {tab === 'usuarios' && <UsuariosTab />}
      {tab === 'packs' && <PacksTab />}
      {tab === 'ajustes' && <AjustesTab />}
    </div>
  );
}

/* ============================== Resumen ============================== */

function ResumenTab() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminGetReports().then((d) => setReports(d.reports)).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorMsg msg={error} />;
  if (!reports) return <p>Cargando…</p>;

  const metodo = reports.ingresos_por_metodo || {};
  const cards = [
    { label: 'Total de ventas', value: formatCLP(reports.total_de_ventas) },
    { label: 'Cuenta vista', value: formatCLP(metodo.cuenta_vista || 0) },
    { label: 'Efectivo', value: formatCLP(metodo.efectivo || 0) },
    { label: 'Inversión', value: formatCLP(reports.inversion) },
    { label: 'Ganancia neta', value: formatCLP(reports.ganancia_neta) },
    { label: 'Hallacas vendidas', value: reports.hallacas_vendidas },
    { label: 'Cortesías (hallacas)', value: reports.hallacas_cortesia },
    // por_vender null = contador de producción sin usar (hallacas_producidas en 0)
    { label: 'Por vender', value: reports.por_vender === null ? '— (sin contador)' : reports.por_vender },
    { label: 'Ticket promedio', value: formatCLP(reports.ticket_promedio) },
    { label: 'Ventas de hoy', value: `${reports.ventas_hoy.n} · ${formatCLP(reports.ventas_hoy.total)}` },
  ];

  return (
    <>
      <div className="admin-cards">
        {cards.map((c) => (
          <div key={c.label} className="admin-card">
            <p className="admin-card__label">{c.label}</p>
            <p className="admin-card__value">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="admin-cards">
        {Object.entries(reports.ventas_por_estado).map(([status, n]) => (
          <div key={status} className="admin-card">
            <p className="admin-card__label">{STATUS_LABELS[status] || status}</p>
            <p className="admin-card__value">{n}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/* ============================== Ventas ============================== */

function VentasTab() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    adminGetOrders().then((d) => setOrders(d.orders)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function patchOrder(id, body) {
    try {
      await adminUpdateOrder(id, body);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <ErrorMsg msg={error} onRetry={() => { setError(''); load(); }} />;
  if (!orders) return <p>Cargando…</p>;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn--primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Ocultar formulario' : '+ Añadir venta manual'}
        </button>
      </div>
      {showForm && <ManualSaleForm onCreated={() => { setShowForm(false); load(); }} />}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Cant.</th><th>Total</th>
              <th>Método</th><th>Estado</th><th>Origen</th><th>Entrega</th><th>Comentarios</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{formatLocalDate(o.created_at)}</td>
                <td>{o.customer.name || '—'}</td>
                <td>{o.customer.phone || '—'}</td>
                <td>{o.quantity_hallacas}</td>
                <td>{o.total_clp === null ? 'a coordinar' : formatCLP(o.total_clp)}</td>
                <td>
                  <select className="form-input" value={o.payment_method || ''}
                    onChange={(e) => patchOrder(o.id, { paymentMethod: e.target.value || null })}>
                    <option value="">—</option>
                    {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td>
                  <select className="form-input" value={o.status}
                    onChange={(e) => patchOrder(o.id, { status: e.target.value })}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td>{o.source}</td>
                <td>{o.delivery}{o.address ? ` · ${o.address}` : ''}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{o.notes || '—'}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>Sin ventas todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Ventas que no pasaron por la web: pedidos grandes, cortesías, WhatsApp directo. */
function ManualSaleForm({ onCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState('');
  const [total, setTotal] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('pendiente_pago');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const qtyNum = parseInt(qty, 10);
  const isCortesia = status === 'cortesia';
  const canSave = name.trim() && Number.isInteger(qtyNum) && qtyNum > 0
    && (!phone || normalizePhone(phone)) && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await adminCreateSale({
        customerName: name.trim(),
        customerPhone: phone ? normalizePhone(phone) : undefined,
        quantityHallacas: qtyNum,
        totalClp: isCortesia ? 0 : (total === '' ? null : parseInt(total, 10)),
        paymentMethod: method || undefined,
        status,
        notes: notes.trim() || undefined,
      });
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-form">
      <label>Cliente *
        <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
      </label>
      <label>Teléfono
        <input className="form-input" type="tel" inputMode="numeric" maxLength={9} value={phone}
          onChange={(e) => setPhone(phoneToDigits(e.target.value).slice(0, 9))} placeholder="9XXXXXXXX" />
      </label>
      <label>Hallacas *
        <input className="form-input" type="number" min="1" step="1" value={qty}
          onChange={(e) => setQty(e.target.value)} placeholder="Ej: 50" />
      </label>
      <label>Total CLP
        <input className="form-input" type="number" min="0" step="1" value={isCortesia ? '0' : total}
          disabled={isCortesia}
          onChange={(e) => setTotal(e.target.value)} placeholder="Ej: 200000" />
      </label>
      <label>Método
        <select className="form-input" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">—</option>
          {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>Estado
        <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label style={{ gridColumn: '1 / -1' }}>Comentarios
        <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>
      {error && <ErrorMsg msg={error} />}
      <div>
        <button className="btn btn--primary" onClick={save} disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }}>
          {saving ? 'Guardando…' : 'Registrar venta'}
        </button>
      </div>
    </div>
  );
}

/* ============================== Usuarios ============================== */

function UsuariosTab() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminGetUsers().then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorMsg msg={error} />;
  if (!users) return <p>Cargando…</p>;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Dirección</th><th>Rol</th><th>Creado</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.phone || '— (sin teléfono, cuenta legado)'}</td>
              <td>{u.email || '—'}</td>
              <td>{u.address || '—'}</td>
              <td>{u.role}</td>
              <td>{u.created_at?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== Packs ============================== */

function PacksTab() {
  const [packs, setPacks] = useState(null);
  const [error, setError] = useState('');
  const [prices, setPrices] = useState({});

  const load = useCallback(() => {
    adminGetPacks().then((d) => {
      setPacks(d.packs);
      setPrices(Object.fromEntries(d.packs.map((p) => [p.id, p.price_clp ?? ''])));
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function patchPack(id, body) {
    try {
      await adminUpdatePack(id, body);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <ErrorMsg msg={error} onRetry={() => { setError(''); load(); }} />;
  if (!packs) return <p>Cargando…</p>;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Pack</th><th>Hallacas</th><th>Precio CLP</th><th></th><th>Visible en la web</th></tr>
        </thead>
        <tbody>
          {packs.map((p) => (
            <tr key={p.id}>
              <td>{p.name} <span style={{ color: 'var(--fg-subtle)' }}>({p.qty_label})</span></td>
              <td>{p.qty}</td>
              <td>
                <input className="form-input" type="number" min="0" step="100" style={{ width: 110 }}
                  value={prices[p.id]}
                  placeholder="por encargo"
                  onChange={(e) => setPrices((s) => ({ ...s, [p.id]: e.target.value }))} />
              </td>
              <td>
                <button className="btn btn--glass" style={{ minHeight: 34, padding: '4px 14px', fontSize: 13 }}
                  onClick={() => patchPack(p.id, { priceClp: prices[p.id] === '' ? null : parseInt(prices[p.id], 10) })}>
                  Guardar precio
                </button>
              </td>
              <td>
                <button
                  className={`btn ${p.is_available ? 'btn--primary' : 'btn--glass'}`}
                  style={{ minHeight: 34, padding: '4px 14px', fontSize: 13 }}
                  onClick={() => patchPack(p.id, { isAvailable: !p.is_available })}
                  aria-pressed={!!p.is_available}
                >
                  {p.is_available ? 'Disponible' : 'Oculto/Agotado'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== Ajustes ============================== */

function AjustesTab() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminGetSettings().then((d) => setSettings(d.settings)).catch((e) => setError(e.message));
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const body = {
        price_per_hallaca: parseInt(settings.price_per_hallaca, 10) || 0,
        cost_per_hallaca: parseInt(settings.cost_per_hallaca, 10) || 0,
        hallacas_producidas: parseInt(settings.hallacas_producidas, 10) || 0,
      };
      const d = await adminUpdateSettings(body);
      setSettings(d.settings);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) return <ErrorMsg msg={error} />;
  if (!settings) return <p>Cargando…</p>;

  const FIELDS = [
    { key: 'price_per_hallaca', label: 'Precio por hallaca (CLP)' },
    { key: 'cost_per_hallaca', label: 'Costo por hallaca (CLP)' },
    { key: 'hallacas_producidas', label: 'Hallacas producidas (temporada)' },
  ];

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="admin-form" style={{ gridTemplateColumns: '1fr' }}>
        {FIELDS.map((f) => (
          <label key={f.key}>{f.label}
            <input className="form-input" type="number" min="0" step="1"
              value={settings[f.key]}
              onChange={(e) => { setSaved(false); setSettings((s) => ({ ...s, [f.key]: e.target.value })); }} />
          </label>
        ))}
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-muted)' }}>
          Con "Hallacas producidas" en 0 el contador de stock queda desactivado
          (ningún pack se marca agotado por falta de producción).
        </p>
        {error && <ErrorMsg msg={error} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar ajustes'}
          </button>
          {saved && <span style={{ fontSize: 13, color: 'var(--onoto-green, green)' }}>✓ Guardado</span>}
        </div>
      </div>
    </div>
  );
}

function ErrorMsg({ msg, onRetry }) {
  return (
    <p className="auth-modal__error" role="alert" style={{ margin: '8px 0' }}>
      {msg}{' '}
      {onRetry && <button className="btn btn--ghost" style={{ minHeight: 30, padding: '2px 10px' }} onClick={onRetry}>Reintentar</button>}
    </p>
  );
}
