import { useEffect, useState } from 'react';
import api from '../../services/api';
import ConfirmDialog from '../ConfirmDialog';
import IconButton from '../IconButton';
import { IconCalendar, IconX } from '../Icons';

const TONES = {
  booked: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  attended: 'border-blue-200 bg-blue-50 text-blue-900',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-600',
};

const dateTime = (value) => new Date(value).toLocaleString('es-EC', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

// Citas que el paciente reservó en el chat: la próxima, con la opción de cancelarla, y las anteriores.
export default function AppointmentRequests({ refreshKey, onRequest }) {
  const [items, setItems] = useState([]);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/appointment-requests/')
      .then(({ data }) => setItems((data.results ?? data).slice(0, 4)))
      .catch(() => {});
  }, [refreshKey]);

  // La hora de referencia se toma una vez: «próxima» es la primera cita que aún no ocurre.
  const [now] = useState(() => Date.now());
  const upcoming = items.find((item) => item.status === 'booked' && item.starts_at && new Date(item.starts_at).getTime() > now);
  const past = items.filter((item) => item !== upcoming).slice(0, 3);

  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/appointment-requests/${cancelling.id}/cancel/`, {});
      setItems((current) => current.map((item) => (item.id === data.id ? data : item)));
      setCancelling(null);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'No se pudo cancelar la cita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="mis-citas" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 id="mis-citas" className="text-sm font-bold text-slate-900">Mis citas</h2>
      {upcoming ? (
        <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p className="min-w-0">
            <strong className="block">Tu próxima cita</strong>
            <time dateTime={upcoming.starts_at}>{dateTime(upcoming.starts_at)}</time>
            {upcoming.doctor_name && <span className="block opacity-80">con Dr(a). {upcoming.doctor_name}</span>}
          </p>
          <IconButton icon={IconX} tone="danger" label="Cancelar mi cita" onClick={() => { setCancelling(upcoming); setError(''); }} />
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">¿Necesitas una revisión? Reserva un turno libre con el asistente.</p>
      )}
      {past.length > 0 && (
        <ul className="mt-2 space-y-2">
          {past.map((item) => (
            <li key={item.id} className={`rounded-xl border p-2.5 text-xs ${TONES[item.status] ?? TONES.cancelled}`}>
              <strong className="block">{item.status_label}</strong>
              {item.starts_at && <time dateTime={item.starts_at}>{dateTime(item.starts_at)}</time>}
              {item.note && <p className="mt-0.5 opacity-80">{item.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {!upcoming && (
        <button type="button" onClick={onRequest} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:underline">
          <IconCalendar className="h-3.5 w-3.5 shrink-0" />Pedir una cita al asistente
        </button>
      )}
      <ConfirmDialog
        open={Boolean(cancelling)}
        title="¿Cancelar tu cita?"
        confirmLabel="Cancelar la cita"
        cancelLabel="Mantenerla"
        icon={IconX}
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setCancelling(null)}
      >
        <p>{cancelling && dateTime(cancelling.starts_at)}. El turno quedará libre para otro paciente; puedes reservar otro cuando quieras.</p>
        {error && <p role="alert" className="mt-2 text-rose-600">{error}</p>}
      </ConfirmDialog>
    </section>
  );
}
