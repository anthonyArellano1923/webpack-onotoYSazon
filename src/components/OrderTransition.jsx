import { useEffect, useState } from 'react';
import { IconCheck } from './Icons';

/**
 * Pantalla de transición mientras se guarda el pedido y se abre WhatsApp.
 *
 * La pestaña de WhatsApp (`waTab`) se abre SINCRÓNICAMENTE en el clic de
 * "Pedir" (antes de este componente montar) — si se abre después de un
 * `await`, deja de ser resultado directo del gesto del usuario y el
 * navegador puede bloquearla o abrirla sin el `?text=` precargado. Acá solo
 * la navegamos una vez que el pedido terminó de guardarse (o al menos 2.5s,
 * lo que tarde más), para que la animación no se sienta instantánea.
 */
function OrderTransition({ waTab, waUrl, placeOrderPromise, onClose, onOpenAuth }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const minWait = new Promise((resolve) => setTimeout(resolve, 2500));

    Promise.allSettled([placeOrderPromise, minWait]).then(([orderResult]) => {
      if (cancelled) return;
      if (orderResult.status === 'rejected') {
        // No perdemos la venta para el cliente aunque falle el guardado.
        console.error('placeOrder falló, abriendo WhatsApp de todos modos:', orderResult.reason);
      }
      if (waTab && !waTab.closed) {
        waTab.location.href = waUrl;
      } else {
        // Bloqueada o cerrada por el usuario: reintentamos como navegación directa.
        window.open(waUrl, '_blank', 'noopener,noreferrer');
      }
      setReady(true);
    });

    return () => { cancelled = true; };
  }, [placeOrderPromise, waTab, waUrl]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Preparando tu pedido">
      <div className="modal" style={{ maxWidth: 420, textAlign: 'center', padding: '48px 32px' }}>
        {!ready ?
        <>
            <div className="spinner" aria-hidden="true" />
            <p style={{ marginTop: 20, fontSize: 17, fontWeight: 600 }}>Preparando tu pedido…</p>
            <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>Ya casi te llevamos a WhatsApp.</p>
          </> :

        <>
            <span className="toast__check" style={{ margin: "0 auto", width: 32, height: 32 }}>
              <IconCheck size={16} />
            </span>
            <p style={{ marginTop: 16, fontSize: 17, fontWeight: 600 }}>¡Listo! Te llevamos a WhatsApp.</p>
            <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fg-muted)" }}>
              Crea una cuenta para que tu próximo pedido sea aún más rápido.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "center" }}>
              <button className="btn btn--glass" onClick={onClose}>Cerrar</button>
              <button className="btn btn--primary" onClick={onOpenAuth}>Crear cuenta</button>
            </div>
          </>
        }
      </div>
    </div>);

}

export default OrderTransition;
