import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconAlertTriangle, IconX } from './Icons';

const TONES = {
  danger: { badge: 'bg-rose-100 text-rose-600', confirm: 'bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-300' },
  primary: { badge: 'bg-blue-100 text-blue-600', confirm: 'bg-blue-600 hover:bg-blue-700 focus-visible:outline-blue-300' },
};

/**
 * Ventana de confirmación propia, en lugar del cuadro del navegador (window.confirm). Se pinta en
 * <body> para que ningún contenedor animado la recorte, atrapa el foco, se cierra con Escape o
 * pulsando fuera y devuelve el foco al botón que la abrió.
 */
export default function ConfirmDialog({
  open, title, children, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  icon: Icon = IconAlertTriangle, tone = 'danger', busy = false, onConfirm, onCancel,
}) {
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef(null);
  const cancelButton = useRef(null);
  const colors = TONES[tone];
  // Los manejadores pueden cambiar en cada render: el efecto los lee de una referencia.
  const handlers = useRef({ onCancel, busy });
  useEffect(() => { handlers.current = { onCancel, busy }; });

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    // El foco empieza en «Cancelar»: la opción segura ante una acción que no se puede deshacer.
    cancelButton.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape' && !handlers.current.busy) {
        event.preventDefault();
        handlers.current.onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = panel.current?.querySelectorAll('button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <div aria-hidden="true" onClick={busy ? undefined : onCancel} className="ds-fade absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
      <section
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="ds-pop relative w-full max-w-md origin-center rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl ring-1 ring-black/5"
      >
        <button type="button" onClick={onCancel} disabled={busy} aria-label="Cerrar" className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
          <IconX className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colors.badge}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-slate-900">{title}</h2>
            <div id={bodyId} className="mt-1 text-xs leading-relaxed text-slate-600">{children}</div>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelButton} type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm disabled:opacity-60 ${colors.confirm}`}>
            <Icon className="h-4 w-4" />{busy ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
