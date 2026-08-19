import { useEffect, useRef, useState } from 'react';
import { IconCheck } from './Icons';

/**
 * Pantalla de transición mientras se guarda el pedido y se abre WhatsApp.
 *
 * La pestaña de WhatsApp (`waTab`) se abre SINCRÓNICAMENTE en el clic de
 * "Pedir" (antes de este componente montar) — si se abre después de un
 * `await`, deja de ser resultado directo del gesto del usuario y el
 * navegador puede bloquearla o abrirla sin el `?text=` precargado. Acá solo
 * la navegamos una vez que el pedido terminó de guardarse (o al menos 2.5s,
 * lo que tarde más), para que la animación no se sienta instantánea. Si el
 * guardado falla, cerramos esa pestaña y WhatsApp queda como acción explícita.
 */
function OrderTransition({ waTab, waUrl, placeOrderPromise, user, onClose, onAdjust, onOpenAuth }) {
  const [ready, setReady] = useState(false);
  const [failMsg, setFailMsg] = useState('');
  const [consulting, setConsulting] = useState(false);
  const consultingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const minWait = new Promise((resolve) => setTimeout(resolve, 2500));

    Promise.allSettled([placeOrderPromise, minWait]).then(([orderResult]) => {
      if (cancelled) return;
      if (orderResult.status === 'rejected') {
        console.error('placeOrder falló:', orderResult.reason);
        setFailMsg(orderResult.reason?.message || 'No pudimos registrar tu pedido.');
        // La pestaña se abrió durante el clic para evitar el bloqueador de
        // popups. Si el pedido falla no la navegamos: la cerramos y dejamos
        // WhatsApp como una decisión explícita del cliente.
        if (waTab && !waTab.closed) waTab.close();
      } else {
        if (waTab && !waTab.closed) {
          waTab.location.href = waUrl;
        } else {
          // Bloqueada o cerrada por el usuario: reintentamos como navegación directa.
          window.open(waUrl, '_blank', 'noopener,noreferrer');
        }
      }
      setReady(true);
    });

    return () => { cancelled = true; };
  }, [placeOrderPromise, waTab, waUrl]);

  const consultNextBatch = () => {
    if (consultingRef.current) return;
    consultingRef.current = true;
    setConsulting(true);
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Preparando tu pedido">
      <div className="modal" style={{ maxWidth: 420, textAlign: 'center', padding: '48px 32px' }}>
        {!ready ?
        <>
            <div className="spinner" aria-hidden="true" />
            <p style={{ marginTop: 20, fontSize: 17, fontWeight: 600 }}>Preparando tu pedido…</p>
            <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>Ya casi te llevamos a WhatsApp.</p>
          </> :

        failMsg ?
        /* El pedido NO se guardó y WhatsApp no se abre sin confirmación. */
        <>
            <p style={{ marginTop: 16, fontSize: 17, fontWeight: 600, color: 'var(--onoto-crimson, #880D1E)' }} role="alert">
              No pudimos registrar tu pedido
            </p>
            <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>
              {failMsg}
            </p>
            <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>
              Tu selección quedó tal cual. Puedes ajustarla o consultar cuándo estará disponible la próxima tanda.
            </p>
            <div className="order-transition__actions">
              <button className="btn btn--glass" onClick={onAdjust || onClose}>Ajustar pedido</button>
              <button className="btn btn--primary" onClick={consultNextBatch} disabled={consulting}>
                {consulting ? 'WhatsApp abierto' : 'Consultar próxima tanda'}
              </button>
            </div>
          </> :

        <>
            <span className="toast__check" style={{ margin: "0 auto", width: 32, height: 32 }}>
              <IconCheck size={16} />
            </span>
            <p style={{ marginTop: 16, fontSize: 17, fontWeight: 600 }}>¡Listo! Te llevamos a WhatsApp.</p>
            {/* QA-08: con sesión iniciada no tiene sentido sugerir "Crear cuenta" — solo Cerrar */}
            <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>
              {user
                ? 'Tu pedido quedó registrado en tu cuenta.'
                : 'Crea una cuenta para que tu próximo pedido sea aún más rápido.'}
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "center" }}>
              <button className="btn btn--glass" onClick={onClose}>Cerrar</button>
              {/* QA-04: el CTA abre directo la pestaña de registro (onOpenAuth ya viene parametrizado como 'register') */}
              {!user && <button className="btn btn--primary" onClick={onOpenAuth}>Crear cuenta</button>}
            </div>
          </>
        }
      </div>
    </div>);

}

export default OrderTransition;
