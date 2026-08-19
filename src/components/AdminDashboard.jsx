import { Fragment, useState, useEffect, useCallback } from 'react';
import {
  adminGetOrders, adminCreateSale, adminUpdateOrder, adminDeleteOrder,
  adminGetUsers, adminDeleteUser, adminGetPacks, adminUpdatePack,
  adminGetSettings, adminUpdateSettings, adminGetReports,
  adminGetBatches, adminCreateBatch, adminUpdateBatch, adminDeleteBatch,
  adminGetKardex, adminCreateMovement, adminDeleteMovement,
} from '../services/api';
import { formatCLP } from './Sections';
import { normalizePhone, phoneToDigits } from '../utils/phone';
import { IconClose, IconTrash } from './Icons';

// QA-16: 'entregado'/'pendiente_entrega' salieron del enum de estado — la
// entrega es ahora su propia columna (delivered_at), no un estado de pago.
const STATUS_LABELS = {
  pagado: 'Pagado',
  pendiente_pago: 'Pendiente pago',
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

// QA-16: pestaña "Producción" nueva, entre Ventas y Usuarios.
const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'produccion', label: 'Producción' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'packs', label: 'Packs y precios' },
  { id: 'ajustes', label: 'Ajustes' },
];

/**
 * Panel de administración: réplica del Excel de control de ventas del dueño.
 * Pantalla completa (no modal) porque las tablas necesitan espacio.
 */
export default function AdminDashboard({ onClose, onCatalogChange }) {
  const [tab, setTab] = useState('resumen');
  const [showStockExemptOnly, setShowStockExemptOnly] = useState(false);

  function openStockExemptOrders() {
    setShowStockExemptOnly(true);
    setTab('ventas');
  }

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
            onClick={() => {
              setTab(t.id);
              if (t.id === 'ventas') setShowStockExemptOnly(false);
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab />}
      {tab === 'ventas' && <VentasTab onCatalogChange={onCatalogChange}
        showStockExemptOnly={showStockExemptOnly}
        onClearStockExemptFilter={() => setShowStockExemptOnly(false)} />}
      {tab === 'produccion' && <ProduccionTab onCatalogChange={onCatalogChange}
        onViewStockExemptOrders={openStockExemptOrders} />}
      {tab === 'usuarios' && <UsuariosTab />}
      {tab === 'packs' && <PacksTab onCatalogChange={onCatalogChange} />}
      {tab === 'ajustes' && <AjustesTab onCatalogChange={onCatalogChange} />}
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
  // QA-17: "Total de ventas" ahora trae debajo el desglose pagado/adeudado.
  const cards = [
    {
      label: 'Total de ventas',
      value: formatCLP(reports.total_de_ventas),
      sub: `Pagado: ${formatCLP(reports.monto_pagado)} · Adeudado: ${formatCLP(reports.monto_adeudado)}`,
    },
    { label: 'Cuenta vista', value: formatCLP(metodo.cuenta_vista || 0) },
    { label: 'Efectivo', value: formatCLP(metodo.efectivo || 0) },
    { label: 'Inversión', value: formatCLP(reports.inversion) },
    // QA-19: dos tarjetas de ganancia — neta de temporada y margen sobre lo ya vendido.
    { label: 'Ganancia neta', value: formatCLP(reports.ganancia_neta) },
    { label: 'Margen de lo vendido', value: formatCLP(reports.margen_vendido) },
    { label: 'Hallacas vendidas', value: reports.hallacas_vendidas },
    {
      label: 'Hallacas regaladas',
      value: reports.hallacas_cortesia ?? 0,
      sub: `${reports.cantidad_cortesias ?? 0} cortesías registradas`,
    },
    // ADR-3 (plan 09): el stock es un entero propio, nunca null — ya no hay
    // "modo sin lotes" que permitiera vender sin existencias.
    { label: 'Hallacas en stock', value: reports.stock },
    { label: 'Ticket promedio', value: formatCLP(reports.ticket_promedio) },
    { label: 'Ventas de hoy', value: `${reports.ventas_hoy.n} · ${formatCLP(reports.ventas_hoy.total)}` },
  ];

  return (
    <>
      {reports.monto_adeudado > 0 &&
        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)', margin: '0 0 12px' }}>
          Las ventas "a coordinar" (total sin definir) no suman en pagado ni adeudado.
        </p>
      }
      <div className="admin-cards">
        {cards.map((c) => (
          <div key={c.label} className="admin-card">
            <p className="admin-card__label">{c.label}</p>
            <p className="admin-card__value">{c.value}</p>
            {c.sub && <p className="admin-card__label" style={{ marginTop: 4 }}>{c.sub}</p>}
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

function VentasTab({ onCatalogChange, showStockExemptOnly, onClearStockExemptFilter }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingEncargoId, setEditingEncargoId] = useState(null);

  const load = useCallback(() => {
    adminGetOrders().then((d) => setOrders(d.orders)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function patchOrder(id, body) {
    try {
      await adminUpdateOrder(id, body);
      load();
      // QA-13: cambiar el estado de una venta (cancelar/restaurar) o marcarla
      // entregada mueve el stock comprometido/físico — refrescar la web pública.
      onCatalogChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeOrder(o) {
    // QA-12: borrado físico de una venta (errores/pruebas del admin).
    if (!window.confirm(`¿Borrar definitivamente la venta de ${o.customer.name || 'cliente sin nombre'} (${o.quantity_hallacas} hallacas)? Esta acción no se puede deshacer.`)) return;
    try {
      await adminDeleteOrder(o.id);
      load();
      // QA-13: borrar una venta libera el stock comprometido.
      onCatalogChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function confirmEncargo(o, values) {
    await adminUpdateOrder(o.id, {
      confirmStock: true,
      quantityHallacas: values.quantityHallacas,
      totalClp: values.totalClp,
    });
    setEditingEncargoId(null);
    load();
    onCatalogChange?.();
  }

  if (error) return <ErrorMsg msg={error} onRetry={() => { setError(''); load(); }} />;
  if (!orders) return <p>Cargando…</p>;

  const visibleOrders = showStockExemptOnly
    ? orders.filter((o) => (o.stock_exempt === true || o.stock_exempt === 1) && o.status !== 'cancelado')
    : orders;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn--primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Ocultar formulario' : '+ Añadir venta manual'}
        </button>
      </div>
      {showForm && <ManualSaleForm onCreated={() => { setShowForm(false); load(); onCatalogChange?.(); }} />}

      {showStockExemptOnly &&
        <div role="status" style={{
          margin: '0 0 16px', padding: 12, borderRadius: 10,
          border: '1px solid var(--onoto-gold, #B7791F)',
          background: 'rgba(183, 121, 31, 0.1)',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{ fontSize: 13.5 }}>
            Mostrando sólo encargos que todavía no reservan stock.
          </span>
          <button className="btn btn--glass" style={{ minHeight: 34, padding: '4px 12px' }}
            onClick={onClearStockExemptFilter}>
            Ver todas las ventas
          </button>
        </div>
      }

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Cant.</th><th>Total</th>
              <th>Método</th><th>Estado</th><th>Entregado</th><th>Origen</th><th>Entrega</th><th>Comentarios</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((o) => {
              const isStockExempt = (o.stock_exempt === true || o.stock_exempt === 1) && o.status !== 'cancelado';
              return (
              <Fragment key={o.id}>
              <tr style={isStockExempt ? { background: 'rgba(183, 121, 31, 0.1)' } : undefined}>
                <td>{formatLocalDate(o.created_at)}</td>
                <td>
                  {o.customer.name || '—'}
                  {isStockExempt &&
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, fontWeight: 700, color: 'var(--onoto-crimson, #880D1E)' }}>
                      Encargo por confirmar
                    </span>
                  }
                </td>
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
                {/* QA-16: "Entregado" deja de ser un estado y pasa a checkbox propio (delivered_at) */}
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!o.delivered_at}
                    onChange={(e) => patchOrder(o.id, { delivered: e.target.checked })}
                    disabled={isStockExempt}
                    title={isStockExempt ? 'Confirma el encargo y reserva su stock antes de marcarlo como entregado.' : undefined}
                    aria-label={isStockExempt
                      ? `Confirma primero el encargo de ${o.customer.name || 'cliente'}`
                      : `Marcar entregada la venta de ${o.customer.name || 'cliente'}`}
                    style={{ cursor: isStockExempt ? 'not-allowed' : 'pointer', width: 18, height: 18 }} />
                </td>
                <td>{o.source}</td>
                <td>{o.delivery}{o.address ? ` · ${o.address}` : ''}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{o.notes || '—'}</td>
                {/* QA-12: borrar venta (errores/pruebas) */}
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {isStockExempt &&
                      <button className="btn btn--primary" style={{ minHeight: 34, padding: '4px 10px', whiteSpace: 'nowrap' }}
                        onClick={() => setEditingEncargoId((id) => id === o.id ? null : o.id)}
                        aria-expanded={editingEncargoId === o.id} aria-controls={`confirmar-encargo-${o.id}`}>
                        Confirmar encargo
                      </button>
                    }
                    <button className="btn btn--glass" style={{ minHeight: 34, padding: '4px 10px' }}
                      onClick={() => removeOrder(o)} aria-label={`Borrar venta de ${o.customer.name || 'cliente'}`}>
                      <IconTrash size={15} />
                    </button>
                  </div>
                </td>
              </tr>
              {editingEncargoId === o.id &&
                <tr>
                  <td colSpan={12} style={{ whiteSpace: 'normal', padding: 14 }}>
                    <ConfirmEncargoForm order={o} onConfirm={(values) => confirmEncargo(o, values)}
                      onCancel={() => setEditingEncargoId(null)} />
                  </td>
                </tr>
              }
              </Fragment>
              );
            })}
            {visibleOrders.length === 0 && (
              <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>
                {showStockExemptOnly ? 'No hay encargos pendientes de confirmación.' : 'Sin ventas todavía.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ConfirmEncargoForm({ order, onConfirm, onCancel }) {
  const [quantity, setQuantity] = useState(String(order.quantity_hallacas ?? ''));
  const [total, setTotal] = useState(order.total_clp == null ? '' : String(order.total_clp));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const quantityNumber = Number(quantity);
  const totalNumber = Number(total);
  const quantityOk = quantity !== '' && Number.isInteger(quantityNumber) && quantityNumber > 0 && quantityNumber <= 10000;
  const totalOk = total !== '' && Number.isInteger(totalNumber) && totalNumber >= 0;
  const canSave = quantityOk && totalOk && !saving;

  async function save(e) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm({ quantityHallacas: quantityNumber, totalClp: totalNumber });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form id={`confirmar-encargo-${order.id}`} onSubmit={save} aria-label={`Confirmar encargo de ${order.customer.name || 'cliente'}`}>
      <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Confirmar encargo</h4>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        Al confirmar, esta cantidad reserva y descuenta stock una sola vez. Pagar o entregar después no vuelve a descontar. La confirmación requiere stock disponible.
      </p>
      <div className="admin-form" style={{ margin: 0 }}>
        <label>Cantidad final de hallacas *
          <input className="form-input" type="number" min="1" max="10000" step="1" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} />
          {quantity !== '' && !quantityOk &&
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
              La cantidad debe ser un entero entre 1 y 10.000.
            </p>
          }
        </label>
        <label>Total acordado CLP *
          <input className="form-input" type="number" min="0" step="1" value={total}
            onChange={(e) => setTotal(e.target.value)} placeholder="Ej: 200000" />
          {total !== '' && !totalOk &&
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
              El total debe ser un número entero igual o mayor que 0.
            </p>
          }
        </label>
        {error && <ErrorMsg msg={error} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn--primary" type="submit" disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5 }}>
            {saving ? 'Confirmando…' : 'Reservar stock y confirmar'}
          </button>
          <button className="btn btn--glass" type="button" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </form>
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

  const qtyNum = Number(qty);
  const totalNum = Number(total);
  const isCortesia = status === 'cortesia';
  const canSave = name.trim() && Number.isInteger(qtyNum) && qtyNum > 0
    && (isCortesia || total === '' || (Number.isInteger(totalNum) && totalNum >= 0))
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
        totalClp: isCortesia ? 0 : (total === '' ? null : totalNum),
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
        {/* QA-09: mismo patrón del alert de teléfono del carrito (Sections.jsx) */}
        {phone.length > 0 && !normalizePhone(phone) &&
          <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
            Número inválido: 9 dígitos empezando con 9 (ej. 912345678).
          </p>
        }
      </label>
      <label>Hallacas *
        <input className="form-input" type="number" min="1" step="1" value={qty}
          onChange={(e) => setQty(e.target.value)} placeholder="Ej: 50" />
        {/* QA-10: cantidad ≤ 0 el botón se deshabilitaba sin explicar por qué */}
        {qty !== '' && (!Number.isInteger(qtyNum) || qtyNum <= 0) &&
          <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
            La cantidad debe ser un número entero mayor que 0.
          </p>
        }
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

/* ============================== Producción (QA-16 · ADR-3) ============================== */

/**
 * ADR-3 (plan 09): EL STOCK ES UN DATO PROPIO, no una fórmula sobre las tandas.
 * La pestaña son dos bloques que no se cruzan:
 * - "Stock": el número real de hallacas (Σ movimientos − ventas vivas) con su
 *   kardex. Es lo único que decide el "Agotado" de la web, y se corrige a mano
 *   con ingresos/egresos de motivo obligatorio.
 * - "Tandas de producción": registros de COSTO (inversión, costo por hallaca).
 *   Nunca se consultan para calcular el stock: borrar o editar una tanda no lo
 *   mueve (invariante I-1). Crear una tanda sí genera un ingreso INDEPENDIENTE,
 *   que después vive por su cuenta en el kardex.
 */
function ProduccionTab({ onCatalogChange, onViewStockExemptOrders }) {
  const [batches, setBatches] = useState(null);
  const [totals, setTotals] = useState(null);
  const [kardex, setKardex] = useState(null);
  const [error, setError] = useState('');
  const [editingBatchId, setEditingBatchId] = useState(null);

  const load = useCallback(() => {
    adminGetBatches().then((d) => { setBatches(d.batches); setTotals(d.totals); }).catch((e) => setError(e.message));
    adminGetKardex().then(setKardex).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function removeBatch(b) {
    // ADR-3/I-1: borrar una tanda se lleva sus COSTOS de los informes; el stock
    // vive en stock_movements y no se entera (el ingreso que creó sigue ahí).
    if (!window.confirm(`¿Borrar la tanda del ${b.produced_at} (${b.quantity} hallacas)? Se van sus costos de los informes. El stock NO cambia. Las ventas atribuidas quedan "sin tanda".`)) return;
    try {
      await adminDeleteBatch(b.id);
      load();
      onCatalogChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeMovement(m) {
    // El backend avisa distinto si el movimiento lo creó una tanda: borrarlo baja
    // el stock pero deja la tanda (y sus costos) intacta.
    const cantidad = `${m.delta > 0 ? '+' : '−'}${Math.abs(m.delta)}`;
    const msg = m.kind === 'tanda'
      ? `Este ingreso de ${cantidad} lo creó una tanda. Borrarlo baja el stock; la tanda y sus costos siguen en la tabla de abajo. ¿Continuar?`
      : `¿Borrar el movimiento de ${cantidad} (${m.motivo})? El stock se recalcula al instante.`;
    if (!window.confirm(msg)) return;
    try {
      await adminDeleteMovement(m.id);
      load();
      // QA-13: un movimiento cambia la disponibilidad de la web pública.
      onCatalogChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  // H-8 (auditoría 10): la guarda miraba sólo `batches`, así que si fallaba el
  // kardex la pestaña se quedaba en "Cargando…" para siempre, con el error mudo.
  if (error && (!batches || !kardex)) return <ErrorMsg msg={error} onRetry={() => { setError(''); load(); }} />;
  if (!batches || !kardex) return <p>Cargando…</p>;

  const stock = kardex.stock;
  const stockNegativo = stock < 0;
  // Las dos únicas situaciones en que el número necesita explicarse solo.
  const leyenda = stockNegativo
    ? 'registraste más ventas que hallacas — haz un ingreso para cuadrar'
    : (stock === 0 ? 'nadie puede comprar hasta que ingreses hallacas' : null);
  const movimientos = kardex.movimientos || [];

  return (
    <>
      {/* ---------------- Bloque 1: STOCK (el número) ---------------- */}
      <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>Stock</h3>
      <div className="admin-cards">
        <div className="admin-card">
          <p className="admin-card__label">Hallacas en stock</p>
          <p className="admin-card__value"
            style={stockNegativo ? { color: 'var(--onoto-crimson, #880D1E)' } : undefined}>
            {stock}
          </p>
          {leyenda &&
            <p className="admin-card__label" role={stockNegativo ? 'alert' : undefined}
              style={{ marginTop: 4, color: stockNegativo ? 'var(--onoto-crimson, #880D1E)' : undefined }}>
              {leyenda}
            </p>
          }
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        Ingresos +{Math.abs(kardex.ingresos)} · Egresos −{Math.abs(kardex.egresos)} · Comprometidas por ventas −{Math.abs(kardex.comprometidas)}
      </p>
      {kardex.encargos_por_coordinar > 0 &&
        <div role="alert" style={{
          margin: '12px 0 0', padding: 14, borderRadius: 10,
          border: '1px solid var(--onoto-gold, #B7791F)',
          background: 'rgba(183, 121, 31, 0.1)',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <strong style={{ display: 'block', fontSize: 14 }}>Encargos por coordinar</strong>
            <span style={{ fontSize: 12.5 }}>
              {kardex.encargos_por_coordinar} hallacas todavía están fuera del stock. Confírmalas cuando acuerdes la cantidad final y el total.
            </span>
          </div>
          <button className="btn btn--primary" style={{ minHeight: 36, padding: '5px 14px' }}
            onClick={onViewStockExemptOrders}>
            Ver encargos
          </button>
        </div>}

      <div style={{ marginTop: 16 }}>
        <MovementForm onCreated={() => { load(); onCatalogChange?.(); }} />
      </div>

      {error && <ErrorMsg msg={error} />}

      <p style={{ margin: '16px 0 0', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        Cada pedido reserva stock al registrarse. Marcarlo como pagado o entregado no vuelve a descontar; el saldo sólo cambia otra vez si cancelas, restauras, editas o borras la venta.
      </p>

      <div className="admin-table-wrap" style={{ marginTop: 10 }}>
        <table className="admin-table">
          <thead>
            <tr><th>Fecha</th><th>Movimiento</th><th>Cantidad</th><th>Motivo</th><th>Saldo</th><th></th></tr>
          </thead>
          <tbody>
            {movimientos.map((m) => {
              // Papelera sólo en los movimientos: las ventas se corrigen en su
              // pestaña, porque el stock las descuenta derivadas de `orders`.
              const esMovimiento = m.kind === 'ajuste' || m.kind === 'tanda';
              const etiqueta = m.kind === 'venta'
                ? (m.delivered_at ? 'Pedido entregado' : (m.status === 'pendiente_pago' ? 'Pedido reservado' : 'Venta'))
                : m.kind === 'tanda' ? 'Tanda'
                : (m.delta > 0 ? 'Ingreso' : 'Egreso');
              return (
                <tr key={`${m.kind || 'venta'}-${m.id}`}>
                  <td>{m.fecha}</td>
                  <td>{etiqueta}</td>
                  <td>{m.delta > 0 ? '+' : '−'}{Math.abs(m.delta)}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{m.motivo || '—'}</td>
                  <td>{m.saldo}</td>
                  <td>
                    {esMovimiento &&
                      <button className="btn btn--glass" style={{ minHeight: 34, padding: '4px 10px' }}
                        onClick={() => removeMovement(m)} aria-label={`Borrar movimiento del ${m.fecha}`}>
                        <IconTrash size={15} />
                      </button>
                    }
                  </td>
                </tr>
              );
            })}
            {movimientos.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>Sin movimientos todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- Bloque 2: TANDAS (el costo) ---------------- */}
      <h3 style={{ margin: '28px 0 4px', fontSize: 15, fontWeight: 700 }}>Tandas de producción (costos)</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        Las tandas registran cuánto produjiste y cuánto te costó. El stock se maneja arriba; borrar o editar una tanda no lo mueve.
      </p>
      <div className="admin-cards">
        <div className="admin-card">
          <p className="admin-card__label">Inversión total</p>
          <p className="admin-card__value">{formatCLP(totals.cost_total_clp)}</p>
        </div>
        <div className="admin-card">
          <p className="admin-card__label">Costo promedio por hallaca</p>
          <p className="admin-card__value">{formatCLP(totals.costo_promedio)}</p>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <BatchForm onCreated={() => { load(); onCatalogChange?.(); }} />
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 16 }}>
        <table className="admin-table">
          <thead>
            <tr><th>Fecha</th><th>Cantidad</th><th>Costo total</th><th>Costo/hallaca</th><th>Notas</th><th></th></tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <Fragment key={b.id}>
              <tr>
                <td>{b.produced_at}</td>
                <td>{b.quantity}</td>
                <td>{formatCLP(b.cost_total_clp)}</td>
                <td>{formatCLP(b.quantity > 0 ? Math.round(b.cost_total_clp / b.quantity) : 0)}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{b.notes || '—'}</td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button className="btn btn--glass" style={{ minHeight: 34, padding: '4px 10px' }}
                      onClick={() => setEditingBatchId((id) => id === b.id ? null : b.id)}
                      aria-expanded={editingBatchId === b.id} aria-controls={`editar-tanda-${b.id}`}>
                      Editar
                    </button>
                    <button className="btn btn--glass" style={{ minHeight: 34, padding: '4px 10px' }}
                      onClick={() => removeBatch(b)} aria-label={`Borrar tanda del ${b.produced_at}`}>
                      <IconTrash size={15} />
                    </button>
                  </div>
                </td>
              </tr>
              {editingBatchId === b.id &&
                <tr>
                  <td colSpan={6} style={{ whiteSpace: 'normal', padding: 14 }}>
                    <BatchEditForm batch={b} onCancel={() => setEditingBatchId(null)}
                      onUpdated={() => { setEditingBatchId(null); load(); }} />
                  </td>
                </tr>
              }
              </Fragment>
            ))}
            {batches.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>Sin tandas registradas todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Movimiento de stock (ADR-3): la palanca manual que faltaba. El motivo es
 * obligatorio a nivel de esquema, así que el botón se deshabilita sin él y se
 * explica por qué (mismo patrón de alert inline de QA-09/QA-10).
 */
function MovementForm({ onCreated }) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD en hora local
  const [tipo, setTipo] = useState('ingreso');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [occurredAt, setOccurredAt] = useState(today);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const qtyNum = Number(quantity);
  const qtyOk = Number.isInteger(qtyNum) && qtyNum > 0;
  const reasonOk = reason.trim().length >= 3;
  const canSave = qtyOk && reasonOk && !!occurredAt && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      // El signo lo pone el selector: el backend recibe un delta entero ≠ 0.
      await adminCreateMovement({
        delta: tipo === 'egreso' ? -qtyNum : qtyNum,
        reason: reason.trim(),
        occurredAt,
      });
      setQuantity(''); setReason(''); setReasonTouched(false);
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Movimiento de stock</h4>
      <div className="admin-form">
        <label>Tipo *
          <select className="form-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="ingreso">Ingreso (+)</option>
            <option value="egreso">Egreso (−)</option>
          </select>
        </label>
        <label>Cantidad *
          <input className="form-input" type="number" min="1" step="1" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} placeholder="Ej: 30" />
          {/* QA-10: la cantidad inválida deshabilitaba el botón sin explicar por qué */}
          {quantity !== '' && !qtyOk &&
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
              La cantidad debe ser un número entero mayor que 0.
            </p>
          }
        </label>
        <label>Fecha *
          <input className="form-input" type="date" value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>Motivo *
          <input className="form-input" value={reason}
            onChange={(e) => { setReasonTouched(true); setReason(e.target.value); }}
            onBlur={() => setReasonTouched(true)}
            placeholder="Ej: se rompieron 6 al trasladarlas" />
          {reasonTouched && !reasonOk &&
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
              El motivo es obligatorio: al menos 3 caracteres explicando el movimiento.
            </p>
          }
        </label>
        {error && <ErrorMsg msg={error} />}
        <div>
          <button className="btn btn--primary" onClick={save} disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }}>
            {saving ? 'Guardando…' : (tipo === 'egreso' ? 'Registrar egreso' : 'Registrar ingreso')}
          </button>
        </div>
      </div>
    </>
  );
}

/** Formulario "Añadir tanda" — mismo patrón visual de ManualSaleForm. */
function BatchForm({ onCreated }) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD en hora local
  const [producedAt, setProducedAt] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [costTotal, setCostTotal] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const qtyNum = Number(quantity);
  const costNum = Number(costTotal);
  const qtyOk = quantity !== '' && Number.isInteger(qtyNum) && qtyNum > 0;
  const costOk = costTotal === '' || (Number.isInteger(costNum) && costNum >= 0);
  const canSave = producedAt && qtyOk && costOk && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await adminCreateBatch({
        producedAt,
        quantity: qtyNum,
        costTotalClp: costTotal === '' ? 0 : costNum,
        notes: notes.trim() || undefined,
      });
      setQuantity(''); setCostTotal(''); setNotes('');
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-form">
      <label>Fecha *
        <input className="form-input" type="date" value={producedAt} onChange={(e) => setProducedAt(e.target.value)} />
      </label>
      <label>Cantidad de hallacas *
        <input className="form-input" type="number" min="1" step="1" value={quantity}
          onChange={(e) => setQuantity(e.target.value)} placeholder="Ej: 300" />
        {quantity !== '' && !qtyOk &&
          <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
            La cantidad debe ser un número entero mayor que 0.
          </p>
        }
      </label>
      <label>Costo total CLP
        <input className="form-input" type="number" min="0" step="1" value={costTotal}
          onChange={(e) => setCostTotal(e.target.value)} placeholder="Ej: 450000" />
        {costTotal !== '' && !costOk &&
          <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
            El costo debe ser un número entero igual o mayor que 0.
          </p>
        }
      </label>
      <label style={{ gridColumn: '1 / -1' }}>Notas
        <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>
      {error && <ErrorMsg msg={error} />}
      <div>
        <button className="btn btn--primary" onClick={save} disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }}>
          {saving ? 'Guardando…' : '+ Añadir tanda'}
        </button>
      </div>
    </div>
  );
}

function BatchEditForm({ batch, onUpdated, onCancel }) {
  const [producedAt, setProducedAt] = useState(batch.produced_at || '');
  const [quantity, setQuantity] = useState(String(batch.quantity ?? ''));
  const [costTotal, setCostTotal] = useState(String(batch.cost_total_clp ?? 0));
  const [notes, setNotes] = useState(batch.notes || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const quantityNumber = Number(quantity);
  const costNumber = Number(costTotal);
  const quantityOk = quantity !== '' && Number.isInteger(quantityNumber) && quantityNumber > 0 && quantityNumber <= 10000;
  const costOk = costTotal !== '' && Number.isInteger(costNumber) && costNumber >= 0;
  const canSave = !!producedAt && quantityOk && costOk && !saving;

  async function save(e) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await adminUpdateBatch(batch.id, {
        producedAt,
        quantity: quantityNumber,
        costTotalClp: costNumber,
        notes: notes.trim(),
      });
      onUpdated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form id={`editar-tanda-${batch.id}`} onSubmit={save} aria-label={`Editar tanda del ${batch.produced_at}`}>
      <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Editar tanda</h4>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        Editar la fecha, cantidad, costos o notas actualiza únicamente los datos de producción. No cambia el stock ni modifica el ingreso histórico de esta tanda.
      </p>
      <div className="admin-form" style={{ margin: 0 }}>
        <label>Fecha *
          <input className="form-input" type="date" value={producedAt}
            onChange={(e) => setProducedAt(e.target.value)} />
        </label>
        <label>Cantidad de hallacas *
          <input className="form-input" type="number" min="1" max="10000" step="1" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} />
          {quantity !== '' && !quantityOk &&
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
              La cantidad debe ser un entero entre 1 y 10.000.
            </p>
          }
        </label>
        <label>Costo total CLP *
          <input className="form-input" type="number" min="0" step="1" value={costTotal}
            onChange={(e) => setCostTotal(e.target.value)} />
          {costTotal !== '' && !costOk &&
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
              El costo debe ser un número entero igual o mayor que 0.
            </p>
          }
        </label>
        <label style={{ gridColumn: '1 / -1' }}>Notas
          <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </label>
        {error && <ErrorMsg msg={error} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn--primary" type="submit" disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5 }}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button className="btn btn--glass" type="button" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </form>
  );
}

/* ============================== Usuarios ============================== */

function UsuariosTab() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    adminGetUsers().then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function removeUser(u) {
    // QA-12 (ampliado): borrado físico de usuario. Sus ventas se conservan
    // como anónimas (customer_name/phone desnormalizados en la propia venta).
    if (!window.confirm(`¿Borrar la cuenta de ${u.name}? Sus ventas se conservan como anónimas. Esta acción no se puede deshacer.`)) return;
    try {
      await adminDeleteUser(u.id);
      load();
      // No dispara onCatalogChange: borrar un usuario no toca stock (sus ventas siguen vivas).
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <ErrorMsg msg={error} onRetry={() => { setError(''); load(); }} />;
  if (!users) return <p>Cargando…</p>;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Dirección</th><th>Rol</th><th>Creado</th><th></th></tr>
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
              <td>
                {/* QA-12: no se puede borrar una cuenta admin desde el panel (el backend igual responde 403 — defensa en ambas capas) */}
                {u.role !== 'admin' &&
                  <button className="btn btn--glass" style={{ minHeight: 34, padding: '4px 10px' }}
                    onClick={() => removeUser(u)} aria-label={`Borrar cuenta de ${u.name}`}>
                    <IconTrash size={15} />
                  </button>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== Packs ============================== */

function PacksTab({ onCatalogChange }) {
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
      // QA-13: la web pública lee el catálogo una sola vez al montar — hay
      // que avisarle a App que refresque tras cada cambio del panel.
      onCatalogChange?.();
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

function AjustesTab({ onCatalogChange }) {
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
      // QA-18: la producción y los costos ahora se gestionan en la pestaña
      // Producción (lotes) — Ajustes solo maneja el precio de venta.
      const body = {
        price_per_hallaca: parseInt(settings.price_per_hallaca, 10) || 0,
      };
      const d = await adminUpdateSettings(body);
      setSettings(d.settings);
      setSaved(true);
      // QA-13: el precio de venta afecta el catálogo público.
      onCatalogChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) return <ErrorMsg msg={error} />;
  if (!settings) return <p>Cargando…</p>;

  // QA-18: campos de costo/producción eliminados — ese contenido vive en la
  // pestaña Producción (lotes). Solo queda el precio de venta.
  const FIELDS = [
    { key: 'price_per_hallaca', label: 'Precio de venta por hallaca (CLP)' },
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
          La producción y los costos se gestionan en la pestaña Producción.
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
