/**
 * @fileoverview Reusable focus management for modal dialogs (no dependencies).
 * @module hooks/useModalFocus
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Stack of open modals so that only the topmost one reacts to Esc / Tab. */
const modalStack = [];

/**
 * Manages focus for a modal dialog:
 *  - on open, moves focus into the dialog;
 *  - traps Tab / Shift+Tab inside it;
 *  - closes on Escape (topmost modal only);
 *  - on close, returns focus to the element that opened it.
 *
 * @param {Function} [onClose] Called when Escape is pressed.
 * @returns {React.RefObject<HTMLElement>} Ref to attach to the dialog container.
 */
export default function useModalFocus(onClose) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const first0 = ref.current;
    if (!first0) return undefined;
    const trigger = document.activeElement;
    const token = {};
    modalStack.push(token);

    // The container itself is focusable as a fallback when it has no controls.
    // The dialog node is re-read on every event: some modals swap their root element while open.
    const getNode = () => ref.current;
    const items = () => Array.from(getNode()?.querySelectorAll(FOCUSABLE) || [])
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!first0.hasAttribute('tabindex')) first0.setAttribute('tabindex', '-1');
    // Skip the close button so the first field/action gets the focus when there is one.
    const first = items().find((el) => !el.classList.contains('modal__close')) || items()[0] || first0;
    first.focus({ preventScroll: true });

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = getNode();
      if (!node) return;
      const list = items();
      if (!list.length) { e.preventDefault(); node.focus(); return; }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (!node.contains(document.activeElement)) { e.preventDefault(); firstEl.focus(); }
      else if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === node)) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault(); firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
      if (trigger && trigger.isConnected && typeof trigger.focus === 'function') {
        trigger.focus({ preventScroll: true });
      }
    };
  }, []);

  return ref;
}
