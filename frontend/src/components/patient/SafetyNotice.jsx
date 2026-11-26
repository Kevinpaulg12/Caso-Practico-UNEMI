import { useEffect, useRef, useState } from 'react';
import { IconAlertTriangle, IconMail, IconPhone, IconUser, IconX } from '../Icons';

export const EMERGENCY_PHONE = '042700000';
export const EMERGENCY_LABEL = '04 270 0000';
export const SAFETY_NOTICE = 'Esta plataforma acompaña tu tratamiento pero no reemplaza la atención de urgencia. Si tienes sangrado que no se detiene, fiebre alta o dificultad para respirar o tragar, llama de inmediato a la clínica.';

const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Botón «Contacto» junto a Enviar en el chat: muestra a quién llamar o escribir (el odontólogo
 * tratante y la línea de urgencias de la clínica) y el aviso de seguridad.
 */
export function ContactButton({ contact }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && wrapper.current?.contains(event.target)) return;
      setOpen(false);
      if (event.type === 'keydown') trigger.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="contacto-odontologo"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-full items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
      >
        <IconPhone className="h-3.5 w-3.5" />
        <span>Contacto</span>
      </button>
      {open && (
        <section
          id="contacto-odontologo"
          aria-label="Contacto de tu odontólogo"
          className="ds-pop absolute bottom-full right-0 z-30 mb-2 origin-bottom-right w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-xl"
        >
          <header className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">Contacto</h3>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar contacto" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <IconX className="h-4 w-4" />
            </button>
          </header>

          {contact ? (
            <div className="mt-2 rounded-xl bg-slate-50 p-3">
              <p className="flex items-center gap-2 font-bold text-slate-900">
                <IconUser className="h-4 w-4 text-blue-600" />Dr(a). {contact.name}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">Tu odontólogo tratante</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {contact.phone && (
                  <a href={telHref(contact.phone)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 font-bold text-white hover:bg-blue-700">
                    <IconPhone className="h-3.5 w-3.5" />{contact.phone}
                  </a>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 [overflow-wrap:anywhere]">
                    <IconMail className="h-3.5 w-3.5 shrink-0" />{contact.email}
                  </a>
                )}
                {!contact.phone && !contact.email && <p className="text-[11px] text-slate-500">Comunícate con tu odontólogo a través de la clínica.</p>}
              </div>
            </div>
          ) : (
            <p className="mt-2 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500">Aún no tienes un odontólogo asignado: comunícate con la clínica.</p>
          )}

          <a href={`tel:${EMERGENCY_PHONE}`} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 py-2 font-bold text-white hover:bg-rose-700">
            <IconPhone className="h-4 w-4" />Urgencias de la clínica: {EMERGENCY_LABEL}
          </a>
          <p className="mt-3 flex gap-2 text-[11px] leading-relaxed text-amber-900">
            <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{SAFETY_NOTICE}</span>
          </p>
        </section>
      )}
    </div>
  );
}
