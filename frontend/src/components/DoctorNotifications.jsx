import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { IconAlertTriangle, IconArrowRight, IconBell, IconCalendar, IconHistory } from './Icons';

const SEEN_KEY = 'ds-doctor-notifications-seen';
const REFRESH_MS = 60000;

function readSeen() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(value) {
  try {
    localStorage.setItem(SEEN_KEY, String(value));
  } catch {
    // Sin almacenamiento local, el contador simplemente se reinicia.
  }
}

const dateTime = (value) => new Date(value).toLocaleString('es-EC', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ago(value) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
}

/**
 * Campana del odontólogo junto a su perfil: alertas rojas recientes y próximas citas reservadas.
 * El número cuenta lo nuevo desde la última vez que la abrió.
 */
export default function DoctorNotifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ appointments: [], alerts: [] });
  const [seen, setSeen] = useState(readSeen);
  const containerRef = useRef(null);

  const load = useCallback(() => {
    api.get('/doctor/notifications/')
      .then(({ data: payload }) => {
        if (payload && Array.isArray(payload.appointments) && Array.isArray(payload.alerts)) setData(payload);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const close = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeWithEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, []);

  const unseen = [...data.alerts, ...data.appointments].filter((item) => new Date(item.created_at).getTime() > seen).length;

  // Al abrir, lo pendiente se marca como visto (el número desaparece), pero los puntos azules siguen
  // señalando lo nuevo hasta que se cierre.
  const [marker, setMarker] = useState(seen);
  const toggle = () => {
    if (!open) {
      load();
      const now = Date.now();
      setMarker(seen);
      setSeen(now);
      writeSeen(now);
    }
    setOpen(!open);
  };

  const empty = !data.alerts.length && !data.appointments.length;

  return (
    <div ref={containerRef} className="relative z-50">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unseen ? `Notificaciones (${unseen} nuevas)` : 'Notificaciones'}
        onClick={toggle}
        className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-colors active:scale-95 ${open ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
      >
        <IconBell className={`h-5 w-5 ${unseen ? 'origin-top motion-safe:animate-[bell-ring_1.2s_ease-in-out_1]' : ''}`} />
        {unseen > 0 && (
          <span aria-hidden="true" className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-black text-white ring-2 ring-white">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notificaciones" className="ds-pop absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <strong className="text-sm font-bold text-slate-900">Notificaciones</strong>
            <Link to="/panel-doctor/horario" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline">
              Mi horario<IconArrowRight className="h-3 w-3" />
            </Link>
          </header>
          <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
            {empty && (
              <p className="px-4 py-8 text-center text-xs text-slate-500">
                <IconBell className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                No tienes alertas ni citas próximas.
              </p>
            )}
            {data.alerts.length > 0 && (
              <section aria-label="Alertas rojas">
                <h3 className="bg-rose-50/70 px-4 py-1.5 text-[10px] font-black uppercase tracking-wide text-rose-700">Alertas rojas · últimas 72 h</h3>
                <ul className="divide-y divide-slate-100">
                  {data.alerts.map((item) => (
                    <li key={`alert-${item.id}`}>
                      <Link to={`/panel-doctor/tratamientos/${item.treatment_plan}`} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                          <IconAlertTriangle className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 text-xs">
                          <strong className="block truncate text-slate-900">{item.patient_name}</strong>
                          <span className="block truncate text-slate-600">{item.reasons.join(' · ') || (item.pain_level != null ? `Dolor ${item.pain_level}/10` : 'Reporte de riesgo alto')}</span>
                          <span className="text-[10px] text-slate-400">{ago(item.created_at)}</span>
                        </span>
                        {new Date(item.created_at).getTime() > marker && <span aria-label="Nueva" className="ml-auto mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.appointments.length > 0 && (
              <section aria-label="Próximas citas">
                <h3 className="bg-slate-50 px-4 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">Próximas citas</h3>
                <ul className="divide-y divide-slate-100">
                  {data.appointments.map((item) => (
                    <li key={`appt-${item.id}`} className="flex gap-3 px-4 py-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <IconCalendar className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 text-xs">
                        <strong className="block truncate text-slate-900">{item.patient_name}</strong>
                        <time dateTime={item.starts_at} className="block capitalize text-slate-600">{dateTime(item.starts_at)}</time>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${item.kind === 'assessment' ? 'bg-violet-100 text-violet-800' : 'bg-blue-50 text-blue-700'}`}>
                          {item.kind === 'assessment' ? 'Valoración' : `Seguimiento${item.treatment ? ` · ${item.treatment}` : ''}`}
                        </span>
                        {item.reason && <span className="mt-0.5 block truncate text-slate-400">«{item.reason}»</span>}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        {new Date(item.created_at).getTime() > marker && <span aria-label="Nueva" className="mt-1 h-2 w-2 rounded-full bg-blue-600" />}
                        <Link
                          to={`/panel-doctor/pacientes/${item.patient_id}/historia`}
                          onClick={() => setOpen(false)}
                          aria-label={`Ver la historia clínica de ${item.patient_name}`}
                          title="Ver historia clínica"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <IconHistory className="h-3.5 w-3.5" />
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
