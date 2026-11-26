import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import DoctorLayout from '../components/DoctorLayout';
import IconButton from '../components/IconButton';
import { IconAlertTriangle, IconCalendar, IconCheckCircle, IconClipboard, IconClock, IconHistory, IconPlus, IconSave, IconTrash, IconX } from '../components/Icons';
import Loading, { SkeletonCard } from '../components/Skeleton';
import api from '../services/api';

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const SLOT_OPTIONS = [20, 30, 45, 60];
const AHEAD_OPTIONS = [[7, '1 semana'], [14, '2 semanas'], [30, '1 mes'], [60, '2 meses']];

// Jornadas típicas: un clic en lugar de escribir horas.
const SHIFTS = {
  morning: { label: 'Mañana', ranges: [['08:00', '12:00']] },
  afternoon: { label: 'Tarde', ranges: [['14:00', '18:00']] },
  full: { label: 'Todo el día', ranges: [['08:00', '12:00'], ['14:00', '18:00']] },
};
// Bloqueos de media jornada.
const HALF_DAY = { morning: ['06:00', '13:00'], afternoon: ['13:00', '22:00'] };

function isoToday(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const dateOf = (iso) => new Date(`${iso}T00:00:00`);
const dayLabel = (iso) => dateOf(iso).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (iso) => dateOf(iso).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short' });
const hour = (value) => new Date(value).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
const short = (value) => (value ? value.slice(0, 5) : '');
const localDay = (value) => new Date(value).toLocaleDateString('en-CA');

const normalize = (hours) => hours
  .map((item) => ({ weekday: item.weekday, start: short(item.start), end: short(item.end) }))
  .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));

function shiftOf(ranges) {
  if (!ranges.length) return 'off';
  const key = ranges.map((item) => `${short(item.start)}-${short(item.end)}`).join(',');
  return Object.keys(SHIFTS).find((name) => SHIFTS[name].ranges.map(([start, end]) => `${start}-${end}`).join(',') === key) ?? 'custom';
}

function blockLabel(block) {
  if (block.all_day) return 'Todo el día';
  const range = [short(block.start), short(block.end)];
  if (range.join() === HALF_DAY.morning.join()) return 'Mañana';
  if (range.join() === HALF_DAY.afternoon.join()) return 'Tarde';
  return `${range[0]}–${range[1]}`;
}

/**
 * «Mi horario»: el odontólogo publica cuándo atiende y bloquea los días u horas en que no puede.
 * Los pacientes reservan en el chat los turnos libres, por orden de llegada; no hay que confirmar nada.
 */
export default function DoctorSchedule() {
  const [schedule, setSchedule] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [agenda, setAgenda] = useState(null);
  const [error, setError] = useState('');

  const loadAgenda = useCallback(() => {
    api.get('/doctor/agenda/', { params: { from: isoToday(), to: isoToday(6) } }).then(({ data }) => setAgenda(data)).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([api.get('/doctor/schedule/'), api.get('/doctor/time-off/')])
      .then(([scheduleResponse, blocksResponse]) => {
        setSchedule(scheduleResponse.data);
        setBlocks(blocksResponse.data.results ?? blocksResponse.data);
      })
      .catch(() => setError('No se pudo cargar tu horario. Recarga la página para intentarlo de nuevo.'));
    loadAgenda();
  }, [loadAgenda]);

  return (
    <DoctorLayout title="Mi horario" subtitle="Elige cuándo atiendes. Los pacientes reservan en el chat los turnos libres, por orden de llegada.">
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {!schedule && !error ? (
        <Loading label="Cargando tu horario..." className="space-y-5"><SkeletonCard lines={6} /></Loading>
      ) : schedule && (
        <div className="space-y-6">
          <StatusBar schedule={schedule} agenda={agenda} />
          <WeeklyHours schedule={schedule} onSaved={(data) => { setSchedule(data); loadAgenda(); }} />
          <div className="grid gap-6 lg:grid-cols-2">
            <TimeOff blocks={blocks} onChanged={(items) => { setBlocks(items); loadAgenda(); }} />
            <Week agenda={agenda} onChanged={loadAgenda} />
          </div>
        </div>
      )}
    </DoctorLayout>
  );
}

function StatusBar({ schedule, agenda }) {
  const days = new Set(schedule.hours.map((item) => item.weekday)).size;
  const free = agenda ? Object.values(agenda.free_slots_per_day ?? {}).reduce((sum, value) => sum + (value ?? 0), 0) : null;
  const booked = agenda ? agenda.appointments.filter((item) => item.status !== 'cancelled').length : null;
  const stats = [[days, days === 1 ? 'día de atención' : 'días de atención'], [booked, 'citas en 7 días'], [free, 'turnos libres en 7 días']];
  return (
    <section aria-label="Estado de tu agenda" className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 ${schedule.published ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50'}`}>
      <p className="flex items-center gap-2.5 text-sm font-bold text-slate-900">
        <span className={`relative flex h-2.5 w-2.5 ${schedule.published ? 'text-emerald-500' : 'text-amber-500'}`}>
          {schedule.published && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-current" />
        </span>
        {schedule.published ? 'Agenda publicada: los pacientes ya pueden reservar contigo.' : 'Sin horario: los pacientes no pueden reservar contigo.'}
      </p>
      <dl className="flex gap-5">
        {stats.map(([value, label]) => (
          <div key={label} className="text-right">
            <dt className="sr-only">{label}</dt>
            <dd className="text-lg font-black leading-none text-slate-900">{value ?? '–'}</dd>
            <dd aria-hidden="true" className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Segmented({ label, options, value, onChange, size = 'md' }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded-lg font-bold transition ${size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} ${value === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function WeeklyHours({ schedule, onSaved }) {
  const [slot, setSlot] = useState(schedule.slot_minutes);
  const [ahead, setAhead] = useState(schedule.max_days_ahead);
  const [hours, setHours] = useState(() => normalize(schedule.hours));
  // Días en los que el odontólogo eligió «Otro» y ve el editor de horas.
  const [custom, setCustom] = useState(() => new Set(WEEKDAYS.map((_, day) => day).filter((day) => shiftOf(schedule.hours.filter((item) => item.weekday === day)) === 'custom')));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const baseline = useMemo(() => JSON.stringify([schedule.slot_minutes, schedule.max_days_ahead, normalize(schedule.hours)]), [schedule]);
  const dirty = JSON.stringify([Number(slot), Number(ahead), normalize(hours)]) !== baseline;

  const touch = () => { setMessage(''); setError(''); };
  const rangesOf = (day) => hours.filter((item) => item.weekday === day);
  const setDay = (day, ranges) => {
    setHours((current) => normalize([...current.filter((item) => item.weekday !== day), ...ranges.map(([start, end]) => ({ weekday: day, start, end }))]));
    touch();
  };
  const setCustomDay = (day, on) => setCustom((current) => {
    const next = new Set(current);
    if (on) next.add(day); else next.delete(day);
    return next;
  });

  const chooseShift = (day, key) => {
    if (key === 'custom') {
      setCustomDay(day, true);
      if (!rangesOf(day).length) setDay(day, SHIFTS.morning.ranges);
      return;
    }
    setCustomDay(day, false);
    setDay(day, SHIFTS[key].ranges);
  };

  const toggleDay = (day) => {
    setCustomDay(day, false);
    setDay(day, rangesOf(day).length ? [] : SHIFTS.full.ranges);
  };

  const copyMonday = () => {
    const monday = rangesOf(0).map((item) => [item.start, item.end]);
    setHours((current) => normalize([
      ...current.filter((item) => item.weekday === 0 || item.weekday > 4),
      ...[1, 2, 3, 4].flatMap((day) => monday.map(([start, end]) => ({ weekday: day, start, end }))),
    ]));
    setCustom((current) => {
      const next = new Set([...current].filter((day) => day === 0 || day > 4));
      if (current.has(0)) [1, 2, 3, 4].forEach((day) => next.add(day));
      return next;
    });
    touch();
  };

  const editRange = (day, position, patch) => {
    const ranges = rangesOf(day).map((item, index) => (index === position ? { ...item, ...patch } : item));
    setHours((current) => [...current.filter((item) => item.weekday !== day), ...ranges]);
    touch();
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    touch();
    try {
      const { data } = await api.put('/doctor/schedule/', { slot_minutes: Number(slot), max_days_ahead: Number(ahead), hours: normalize(hours) });
      onSaved(data);
      setHours(normalize(data.hours));
      setMessage(data.published ? 'Horario guardado: los pacientes ya pueden reservar tus turnos libres.' : 'Horario guardado. Elige al menos un día de atención para que puedan reservar.');
    } catch (requestError) {
      const data = requestError.response?.data || {};
      const first = (value) => (Array.isArray(value) ? (typeof value[0] === 'object' ? Object.values(value[0] ?? {})[0] : value[0]) : value);
      setError(first(data.hours) || first(data.slot_minutes) || first(data.max_days_ahead) || first(data.non_field_errors) || 'No se pudo guardar el horario.');
    } finally {
      setSaving(false);
    }
  };

  const aheadOptions = AHEAD_OPTIONS.some(([days]) => days === Number(ahead)) ? AHEAD_OPTIONS : [...AHEAD_OPTIONS, [Number(ahead), `${ahead} días`]];

  return (
    <form onSubmit={save} aria-labelledby="horario-semanal" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5 pb-4">
        <div>
          <h2 id="horario-semanal" className="flex items-center gap-2 text-sm font-bold text-slate-900"><IconClock className="h-4 w-4 text-blue-600" />Cuándo atiendes</h2>
          <p className="text-xs text-slate-500">Activa tus días y elige la jornada. Usa «Otro» solo si necesitas horas distintas.</p>
        </div>
        <button type="button" onClick={copyMonday} disabled={!rangesOf(0).length} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40">
          <IconClipboard className="h-3.5 w-3.5" />Copiar el lunes de martes a viernes
        </button>
      </header>

      <ul className="divide-y divide-slate-100 px-5">
        {WEEKDAYS.map((name, day) => {
          const ranges = rangesOf(day);
          const on = ranges.length > 0;
          const shift = custom.has(day) ? 'custom' : shiftOf(ranges);
          return (
            <li key={name} className="grid items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[10rem_1fr]">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Atiende el ${name.toLowerCase()}`}
                  onClick={() => toggleDay(day)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <span className={`text-sm font-bold ${on ? 'text-slate-900' : 'text-slate-400'}`}>{name}</span>
              </div>
              {on ? (
                <div className="ds-enter flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <Segmented
                    size="sm"
                    label={`Jornada del ${name.toLowerCase()}`}
                    value={shift}
                    onChange={(key) => chooseShift(day, key)}
                    options={[...Object.entries(SHIFTS).map(([key, item]) => [key, item.label]), ['custom', 'Otro']]}
                  />
                  {shift !== 'custom' && (
                    <span className="text-xs tabular-nums text-slate-500">{ranges.map((item) => `${item.start}–${item.end}`).join('  ·  ')}</span>
                  )}
                  {shift === 'custom' && (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      {ranges.map((item, position) => (
                        <span key={position} className="ds-enter inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                          <input type="time" aria-label={`${name}: desde`} value={item.start} onChange={(event) => editRange(day, position, { start: event.target.value })} className="min-h-0 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-xs tabular-nums" />
                          <span className="text-[11px] text-slate-400">a</span>
                          <input type="time" aria-label={`${name}: hasta`} value={item.end} onChange={(event) => editRange(day, position, { end: event.target.value })} className="min-h-0 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-xs tabular-nums" />
                          <IconButton icon={IconTrash} tone="danger" label={`Quitar la franja del ${name.toLowerCase()}`} className="h-6 w-6" onClick={() => setDay(day, ranges.filter((_, index) => index !== position).map((range) => [range.start, range.end]))} />
                        </span>
                      ))}
                      {ranges.length < 4 && (
                        <IconButton icon={IconPlus} tone="primary" label={`Añadir una franja el ${name.toLowerCase()}`} className="h-7 w-7" onClick={() => setDay(day, [...ranges.map((range) => [range.start, range.end]), ranges.length ? ['14:00', '18:00'] : ['08:00', '12:00']])} />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs text-slate-400">Descansa</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-bold text-slate-700">Duración de cada turno</p>
          <Segmented label="Duración de cada turno" value={Number(slot)} onChange={(value) => { setSlot(value); touch(); }} options={SLOT_OPTIONS.map((value) => [value, value === 60 ? '1 hora' : `${value} min`])} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold text-slate-700">Los pacientes reservan con hasta</p>
          <Segmented label="Reservas con anticipación" value={Number(ahead)} onChange={(value) => { setAhead(value); touch(); }} options={aheadOptions} />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
        <div className="min-h-[1rem] text-xs">
          {error && <p role="alert" className="flex items-center gap-2 text-rose-600"><IconAlertTriangle className="h-4 w-4" />{error}</p>}
          {message && <p role="status" className="flex items-center gap-2 font-semibold text-emerald-700"><IconCheckCircle className="h-4 w-4" />{message}</p>}
          {!error && !message && dirty && <p className="text-amber-700">Tienes cambios sin guardar.</p>}
        </div>
        <button type="submit" disabled={saving || !dirty} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
          <IconSave className="h-4 w-4" />{saving ? 'Guardando...' : 'Guardar horario'}
        </button>
      </footer>
    </form>
  );
}

const DAY_CHOICES = [['today', 'Hoy'], ['tomorrow', 'Mañana'], ['pick', 'Otro día']];
const SCOPES = [['all', 'Todo el día'], ['morning', 'Mañana'], ['afternoon', 'Tarde'], ['hours', 'Unas horas']];
const EMPTY_BLOCK = { day: 'tomorrow', date: '', scope: 'all', start: '08:00', end: '12:00', reason: '' };

function TimeOff({ blocks, onChanged }) {
  const [form, setForm] = useState(EMPTY_BLOCK);
  const [affected, setAffected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const date = form.day === 'today' ? isoToday() : form.day === 'tomorrow' ? isoToday(1) : form.date;
  const set = (patch) => { setForm((current) => ({ ...current, ...patch })); setError(''); setMessage(''); };

  const payload = () => {
    const range = form.scope === 'hours' ? [form.start, form.end] : HALF_DAY[form.scope];
    return { date, reason: form.reason.trim(), ...(range ? { start: range[0], end: range[1] } : {}) };
  };
  const failed = (requestError) => {
    const data = requestError.response?.data || {};
    setError([data.date, data.end, data.start, data.detail].flat().find(Boolean) || 'No se pudo bloquear ese horario.');
  };

  const create = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/doctor/time-off/', payload());
      onChanged([...blocks, data].sort((a, b) => a.date.localeCompare(b.date)));
      setMessage(data.cancelled_appointments
        ? `Se cancelaron ${data.cancelled_appointments} ${data.cancelled_appointments === 1 ? 'cita' : 'citas'} y se avisó a cada paciente.`
        : 'Listo: ese horario ya no se ofrece a los pacientes.');
      setForm(EMPTY_BLOCK);
      setAffected(null);
    } catch (requestError) {
      failed(requestError);
      setAffected(null);
    } finally {
      setBusy(false);
    }
  };

  // Antes de bloquear se revisa si hay citas reservadas: en ese caso se pide confirmación.
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!date) {
      setError('Elige el día que no podrás atender.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.get('/doctor/time-off/preview/', { params: payload() });
      setBusy(false);
      if (data.appointments.length) setAffected(data.appointments);
      else await create();
    } catch (requestError) {
      failed(requestError);
      setBusy(false);
    }
  };

  const remove = async (block) => {
    try {
      await api.delete(`/doctor/time-off/${block.id}/`);
      onChanged(blocks.filter((item) => item.id !== block.id));
      setMessage('Listo: ese horario vuelve a ofrecerse a los pacientes.');
    } catch {
      setError('No se pudo quitar el bloqueo.');
    }
  };

  return (
    <section aria-labelledby="no-disponible" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="no-disponible" className="flex items-center gap-2 text-sm font-bold text-slate-900"><IconX className="h-4 w-4 text-rose-600" />No puedo atender</h2>
      <p className="text-xs text-slate-500">Si tienes algo fuera de la clínica. Las citas que choquen se cancelan y cada paciente recibe un aviso.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Qué día" value={form.day} onChange={(day) => set({ day })} options={DAY_CHOICES} />
          {form.day === 'pick' && (
            <label className="ds-enter">
              <span className="sr-only">Día</span>
              <input type="date" min={isoToday()} value={form.date} onChange={(event) => set({ date: event.target.value })} className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs" />
            </label>
          )}
          {form.day !== 'pick' && <span className="text-xs capitalize text-slate-500">{dayLabel(date)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Qué parte del día" value={form.scope} onChange={(scope) => set({ scope })} options={SCOPES} />
          {form.scope === 'hours' && (
            <span className="ds-enter inline-flex items-center gap-1.5 text-xs text-slate-500">
              <label><span className="sr-only">Desde</span><input type="time" value={form.start} onChange={(event) => set({ start: event.target.value })} className="rounded-lg border border-slate-200 px-1.5 py-1 text-xs tabular-nums" /></label>
              a
              <label><span className="sr-only">Hasta</span><input type="time" value={form.end} onChange={(event) => set({ end: event.target.value })} className="rounded-lg border border-slate-200 px-1.5 py-1 text-xs tabular-nums" /></label>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Motivo (opcional, lo verán los pacientes afectados)</span>
            <input value={form.reason} maxLength={200} onChange={(event) => set({ reason: event.target.value })} placeholder="Motivo (opcional): congreso, cirugía fuera..." className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          </label>
          <button type="submit" disabled={busy} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            <IconCalendar className="h-4 w-4" />{busy ? 'Revisando...' : 'Bloquear'}
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        {message && <p role="status" className="text-xs font-semibold text-emerald-700">{message}</p>}
      </form>
      {blocks.length > 0 && (
        <>
          <h3 className="mt-5 text-[10px] font-black uppercase tracking-wide text-slate-400">Próximos bloqueos</h3>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Bloqueos próximos">
            {blocks.map((block) => (
              <li key={block.id} className="ds-enter inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50 py-1 pl-3 pr-1 text-[11px] text-rose-900">
                <span><strong className="capitalize">{shortDay(block.date)}</strong> · {blockLabel(block)}{block.reason ? ` · ${block.reason}` : ''}</span>
                <IconButton icon={IconTrash} tone="danger" label={`Quitar el bloqueo del ${dayLabel(block.date)}`} className="h-6 w-6 rounded-full" onClick={() => remove(block)} />
              </li>
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={Boolean(affected)}
        title={`Se cancelarán ${affected?.length ?? 0} ${affected?.length === 1 ? 'cita' : 'citas'}`}
        confirmLabel="Bloquear y avisar"
        cancelLabel="No bloquear"
        busy={busy}
        onConfirm={create}
        onCancel={() => setAffected(null)}
      >
        <p>Estos pacientes ya habían reservado. Recibirán un correo con el motivo y podrán reservar otro turno en el chat:</p>
        <ul className="mt-2 space-y-1">
          {(affected ?? []).map((item) => <li key={item.id}><strong>{hour(item.starts_at)}</strong> · {item.patient_name}</li>)}
        </ul>
      </ConfirmDialog>
    </section>
  );
}

function Week({ agenda, onChanged }) {
  const [selected, setSelected] = useState(() => isoToday());
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());

  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/appointment-requests/${cancelling.id}/cancel/`, { reason: reason.trim() });
      setCancelling(null);
      setReason('');
      onChanged();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'No se pudo cancelar la cita.');
    } finally {
      setBusy(false);
    }
  };

  if (!agenda) return <Loading label="Cargando tu agenda..."><SkeletonCard lines={5} /></Loading>;
  const days = Array.from({ length: 7 }, (_, offset) => isoToday(offset));
  const info = (day) => {
    const items = agenda.appointments.filter((item) => item.status !== 'cancelled' && localDay(item.starts_at) === day);
    const blocked = agenda.time_off.some((block) => block.date === day && block.all_day);
    const free = agenda.free_slots_per_day?.[day] ?? 0;
    return { items, blocked, free, total: items.length + free };
  };
  const current = info(selected);

  return (
    <section aria-labelledby="agenda-semana" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="agenda-semana" className="flex items-center gap-2 text-sm font-bold text-slate-900"><IconCalendar className="h-4 w-4 text-emerald-600" />Tu semana</h2>
      <p className="text-xs text-slate-500">Cada mañana a las 06:30 recibes por correo las citas del día.</p>
      <div role="group" aria-label="Días de la semana" className="mt-4 grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const { items, blocked, total } = info(day);
          const date = dateOf(day);
          const active = day === selected;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              aria-label={`${dayLabel(day)}: ${blocked ? 'no disponible' : `${items.length} ${items.length === 1 ? 'cita' : 'citas'}`}`}
              onClick={() => setSelected(day)}
              className={`flex flex-col items-center rounded-xl border px-1 py-2 transition ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-slate-50 text-slate-700 hover:border-slate-300'}`}
            >
              <span className={`text-[10px] font-bold uppercase ${active ? 'text-slate-300' : 'text-slate-400'}`}>{date.toLocaleDateString('es-EC', { weekday: 'short' }).replace('.', '')}</span>
              <span className={`text-base font-black leading-tight ${blocked ? 'line-through opacity-50' : ''}`}>{date.getDate()}</span>
              <span className={`mt-1 h-1 w-full max-w-[2rem] overflow-hidden rounded-full ${active ? 'bg-white/20' : 'bg-slate-200'}`}>
                <span className={`block h-full rounded-full ${active ? 'bg-emerald-300' : 'bg-emerald-500'}`} style={{ width: total ? `${Math.round((items.length / total) * 100)}%` : '0%' }} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4">
        <h3 className="text-xs font-bold capitalize text-slate-900">{dayLabel(selected)}</h3>
        {current.blocked ? (
          <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">No disponible: bloqueaste este día.</p>
        ) : current.items.length === 0 ? (
          <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
            Sin citas{current.free ? ` · ${current.free} ${current.free === 1 ? 'turno libre' : 'turnos libres'}` : ' · no atiendes este día'}
          </p>
        ) : (
          <ul aria-label={`Citas del ${dayLabel(selected)}`} className="mt-2 space-y-1.5">
            {current.items.map((item) => (
              <li key={item.id} className="ds-enter flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 p-2.5 text-xs">
                <span className="rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-white">{hour(item.starts_at)}</span>
                <span className="font-semibold text-slate-800">{item.patient_name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.kind === 'assessment' ? 'bg-violet-100 text-violet-800' : 'bg-blue-50 text-blue-700'}`}>
                  {item.kind === 'assessment' ? 'Valoración' : 'Seguimiento'}
                </span>
                {item.status === 'attended' && <span className="text-[10px] font-bold text-emerald-700">Atendida</span>}
                {item.status === 'booked' && new Date(item.starts_at).getTime() > now && (
                  <span className="ml-auto flex gap-1.5">
                    <IconButton icon={IconHistory} label={`Ver la historia clínica de ${item.patient_name}`} to={`/panel-doctor/pacientes/${item.patient}/historia`} className="h-7 w-7" />
                    <IconButton icon={IconX} tone="danger" label={`Cancelar la cita de ${item.patient_name}`} className="h-7 w-7" onClick={() => { setCancelling(item); setError(''); }} />
                  </span>
                )}
              </li>
            ))}
            {current.free > 0 && <li className="px-1 text-[11px] text-slate-500">{current.free} {current.free === 1 ? 'turno libre' : 'turnos libres'} más</li>}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(cancelling)}
        title={`¿Cancelar la cita de ${cancelling?.patient_name ?? ''}?`}
        confirmLabel="Cancelar la cita"
        cancelLabel="Mantenerla"
        icon={IconX}
        busy={busy}
        onConfirm={cancel}
        onCancel={() => { setCancelling(null); setReason(''); }}
      >
        <p>{cancelling && `${dayLabel(localDay(cancelling.starts_at))}, ${hour(cancelling.starts_at)}`}. El paciente recibirá un correo y podrá reservar otro turno en el chat.</p>
        <label className="mt-3 block font-bold text-slate-700">
          Motivo para el paciente (opcional)
          <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Tengo una emergencia" className="mt-1 w-full rounded-lg border border-slate-200 p-2 font-normal" />
        </label>
        {error && <p role="alert" className="mt-2 text-rose-600">{error}</p>}
      </ConfirmDialog>
    </section>
  );
}
