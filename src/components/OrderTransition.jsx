import { useEffect, useRef, useState } from 'react';
import { IconCheck } from './Icons';
import ContactSellerNotice from './ContactSellerNotice';

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
  // PLAN-11: tipo de falla ('contact' = límite/sin stock → D9; 'timeout' = el pedido
  // pudo guardarse igual; 'other').
  const [failKind, setFailKind] = useState('other');
  const [successMsg, setSuccessMsg] = useState('');
  const [consulting, setConsulting] = useState(false);
  const consultingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const minWait = new Promise((resolve) => setTimeout(resolve, 2500));

    Promise.allSettled([placeOrderPromise, minWait]).then(([orderResult]) => {
      if (cancelled) return;
      if (orderResult.status === 'rejected') {
        console.error('placeOrder falló:', orderResult.reason);
        const reason = orderResult.reason;
        const code = reason?.code;
        if (code === 'LIMITE_TELEFONO' || code === 'SIN_STOCK') setFailKind('contact');
        else if (code === 'TIMEOUT') setFailKind('timeout');
        else setFailKind('other');
        // api.js ya entrega mensajes humanos (red, timeout, 5xx); respaldo por si no.
        setFailMsg(reason?.message || 'No pudimos registrar tu pedido.');
        // La pestaña se abrió durante el clic para evitar el bloqueador de
        // popups. Si el pedido falla no la navegamos: la cerramos y dejamos
        // WhatsApp como una decisión explícita del cliente.
        if (waTab && !waTab.closed) waTab.close();
      } else {
        // PLAN-11: el backend informa la reserva de 24 h en `message`.
        setSuccessMsg(orderResult.value?.message || '');
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
            {failKind === 'contact' ?
            /* PLAN-11 (D9): sin «consultar próxima tanda» ni error técnico; el carrito se conserva (H-1). */
            <>
                <ContactSellerNotice waUrl={waUrl} />
                <div className="order-transition__actions">
                  <button className="btn btn--glass" onClick={onAdjust || onClose}>Ajustar pedido</button>
                </div>
              </> :
            <>
                <p style={{ marginTop: 16, fontSize: 17, fontWeight: 600, color: 'var(--onoto-crimson, #880D1E)' }} role="alert">
                  {failKind === 'timeout' ? 'El servidor no respondió a tiempo' : 'No pudimos registrar tu pedido'}
                </p>
                <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>
                  {failMsg}
                </p>
                <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>
                  {failKind === 'timeout' ?
                'Tu pedido pudo haberse registrado igual. Antes de reintentar, escríbenos por WhatsApp para confirmarlo y evitar duplicados.' :
                'Tu selección quedó tal cual. Puedes ajustarla o escribir al vendedor.'}
                </p>
                <div className="order-transition__actions">
                  <button className="btn btn--glass" onClick={onAdjust || onClose}>Ajustar pedido</button>
                  <button className="btn btn--primary" onClick={consultNextBatch} disabled={consulting}>
                    {consulting ? 'WhatsApp abierto' : 'Contactar al vendedor'}
                  </button>
                </div>
              </>}
          </> :

        <>
            <span className="toast__check" style={{ margin: "0 auto", width: 32, height: 32 }}>
              <IconCheck size={16} />
            </span>
            <p style={{ marginTop: 16, fontSize: 17, fontWeight: 600 }}>¡Listo! Te llevamos a WhatsApp.</p>
            {successMsg && <p style={{ marginTop: 6, fontSize: 13.5 }}>{successMsg}</p>}
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
