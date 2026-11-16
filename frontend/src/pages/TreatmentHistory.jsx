import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Loading, { SkeletonCard, SkeletonRows } from '../components/Skeleton';
import DoctorLayout from '../components/DoctorLayout';
import { AlertDot, SymptomChips } from '../components/AlertLevel';
import { ALERT_LABELS } from '../components/alertLevels';
import ChartLoading from '../components/charts/ChartLoading';
import { IconAlertTriangle, IconCheckCircle } from '../components/Icons';
import Odontogram from '../components/Odontogram';
import ControlForm from '../components/consultation/ControlForm';
import api from '../services/api';
import { describeNextControl, formatLongDate } from '../services/consultationRules';
import { buildSeries } from '../services/evolution';
import { DEFAULT_STRENGTHS, DOSAGE_FORMS, DURATION_PATTERN, FREQUENCIES } from '../services/medicationOptions';

const PainChart = lazy(() => import('../components/charts/PainChart'));

const FILTERS = [
  ['all', 'Todo'],
  ['medication', 'Medicación'],
  ['report', 'Reportes'],
  ['control', 'Controles'],
  ['care', 'Cuidados'],
  ['change', 'Cambios'],
];
const MATCHES = {
  all: () => true,
  medication: (event) => event.type === 'medication',
  report: (event) => event.type === 'report' || event.type === 'summary',
  control: (event) => event.type === 'control',
  care: (event) => event.type === 'care',
  change: (event) => ['start', 'change', 'discharge'].includes(event.type),
};
const MARKER = {
  start: 'bg-blue-600',
  medication: 'bg-violet-600',
  change: 'bg-slate-500',
  control: 'bg-cyan-600',
  care: 'bg-emerald-600',
  summary: 'bg-fuchsia-600',
  discharge: 'bg-slate-900',
};

const formatDate = (value) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString('es-EC') : '—');
const formatDateTime = (value) => new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });

const EDIT_FIELDS = ['medication_name', 'strength', 'dosage_form', 'frequency', 'duration', 'instructions', 'side_effects', 'clinical_notes', 'teeth'];

function validate(form, isMedication) {
  const errors = {};
  if (isMedication) {
    if (form.medication_name.trim().length < 2 || form.medication_name.trim().length > 120) errors.medication_name = 'Indica un medicamento entre 2 y 120 caracteres.';
    if (!form.strength.trim()) errors.strength = 'Indica la concentración.';
    if (!form.dosage_form) errors.dosage_form = 'Selecciona una presentación.';
    if (!form.frequency) errors.frequency = 'Selecciona una frecuencia.';
    if (!DURATION_PATTERN.test(form.duration.trim())) errors.duration = 'Usa un formato como «5 días».';
  }
  if (form.instructions.trim().length < 10 || form.instructions.trim().length > 1000) errors.instructions = 'Escribe indicaciones entre 10 y 1000 caracteres.';
  if (form.side_effects.length > 500) errors.side_effects = 'No puede superar 500 caracteres.';
  if (form.clinical_notes.length > 1000) errors.clinical_notes = 'No puede superar 1000 caracteres.';
  return errors;
}

export default function TreatmentHistory() {
  const { planId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', data: null });
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');
  const editing = searchParams.get('editar') === '1';
  const registering = searchParams.get('control') === '1';

  const load = useCallback(() => api.get(`/treatment-plans/${planId}/history/`)
    .then(({ data }) => setState({ status: 'ready', data }))
    .catch((error) => setState({ status: error.response?.status === 404 ? 'missing' : 'error', data: null })), [planId]);

  useEffect(() => { load(); }, [load]);

  const setEditing = (value) => setSearchParams(value ? { editar: '1' } : {}, { replace: true });
  const setRegistering = (value) => setSearchParams(value ? { control: '1' } : {}, { replace: true });

  if (state.status !== 'ready') {
    return (
      <DoctorLayout title="Historial del tratamiento">
        <Link to="/panel-doctor" className="text-xs font-bold text-blue-700 hover:underline">← Volver a Pacientes Activos</Link>
        {state.status === 'loading' ? (
          <Loading label="Cargando historial..." className="mt-3 space-y-5">
            <SkeletonCard lines={3} />
            <SkeletonRows rows={4} />
          </Loading>
        ) : (
          <p role={state.status === 'error' ? 'alert' : undefined} className="mt-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            {state.status === 'missing'
              ? 'Este tratamiento no existe o pertenece a un paciente que no atiendes.'
              : 'No se pudo cargar el historial. Recarga la página para intentarlo de nuevo.'}
          </p>
        )}
      </DoctorLayout>
    );
  }

  const { plan, patient, events } = state.data;
  const visible = events.filter(MATCHES[filter]);
  const reports = events.filter((event) => event.type === 'report');
  const series = buildSeries(
    reports.map((event) => ({ pain_level: event.pain_level, postoperative_day: event.postoperative_day, alert_color: event.alert_color, created_at: event.date })),
    plan.procedure_detail?.expected_curve ?? [],
  );

  return (
    <DoctorLayout title="Historial del tratamiento" subtitle="Controles, medicación, cambios y reportes del paciente en una sola línea de tiempo.">
      <Link to="/panel-doctor" className="text-xs font-bold text-blue-700 hover:underline">← Volver a Pacientes Activos</Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {patient.full_name} · HC-{String(patient.id).padStart(5, '0')}{patient.national_id ? ` · C.I. ${patient.national_id}` : ''}
          </p>
          <h2 className="mt-1 text-xl font-black text-slate-900 [overflow-wrap:anywhere]">{plan.medication_name || plan.title}</h2>
          {plan.medication_name && (
            <p className="mt-0.5 text-sm font-semibold text-blue-700">
              {[plan.strength, plan.dosage_form, plan.frequency, plan.duration].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {plan.specialty_label} · {plan.procedure || 'Sin intervención registrada'} · inicio el {formatDate(plan.surgery_date)}
            {plan.is_active ? ` · día ${plan.postoperative_day} desde la última intervención` : ''}
          </p>
          {plan.next_control && (
            <p className={`mt-1 text-xs font-semibold ${plan.next_control.overdue ? 'text-amber-700' : 'text-cyan-800'}`}>
              {describeNextControl(plan.next_control)} · <time dateTime={plan.next_control.date}>{formatLongDate(plan.next_control.date)}</time>
            </p>
          )}
          <ClinicalData items={plan.clinical_data_display} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${plan.is_active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
            {plan.is_active ? 'Tratamiento vigente' : 'Tratamiento cerrado'}
          </span>
          {plan.is_active && !editing && !registering && (
            <>
              <button type="button" onClick={() => { setMessage(''); setRegistering(true); }} className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">
                Registrar control
              </button>
              <button type="button" onClick={() => { setMessage(''); setEditing(true); }} className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
                Editar tratamiento
              </button>
            </>
          )}
        </div>
      </header>

      {message && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0" />{message}
        </p>
      )}

      {editing && plan.is_active && (
        <EditTreatment
          plan={plan}
          onCancel={() => setEditing(false)}
          onSaved={(text) => { setMessage(text); setEditing(false); load(); }}
        />
      )}
      {registering && plan.is_active && (
        <div className="mt-4">
          <ControlForm
            plan={plan}
            onCancel={() => setRegistering(false)}
            onSaved={({ treatment }) => {
              setMessage(treatment.next_control
                ? `Control registrado. El paciente recibirá el aviso para volver el ${formatLongDate(treatment.next_control.date)}.`
                : 'Control registrado. No quedó un próximo control pendiente.');
              setRegistering(false);
              load();
            }}
          />
        </div>
      )}
      {(editing || registering) && !plan.is_active && (
        <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Este tratamiento ya fue cerrado con el alta médica; no se puede modificar ni recibir controles.
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Phases plan={plan} onAdvanced={(text) => { setMessage(text); load(); }} />
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900">Piezas en tratamiento</h3>
          <div className="mt-3">
            <Odontogram value={plan.teeth ?? []} readOnly dentition={(plan.teeth ?? []).some((tooth) => tooth >= 51) ? 'primary' : 'permanent'} />
          </div>
        </section>
      </div>

      {reports.length > 0 && (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900">Dolor (EVA) reportado en este tratamiento</h3>
          <Suspense fallback={<ChartLoading />}>
            <PainChart series={series} ariaLabel={`Gráfica de EVA de ${reports.length} reportes de este tratamiento; la tabla siguiente contiene los mismos datos.`} />
          </Suspense>
        </section>
      )}

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">Línea de tiempo</h3>
          <div role="group" aria-label="Filtrar la línea de tiempo" className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-md px-2.5 py-1 transition ${filter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        {visible.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 py-6 text-center text-xs text-slate-500">No hay eventos de este tipo.</p>
        ) : (
          <ol aria-label="Línea de tiempo del tratamiento" className="mt-4 space-y-0">
            {visible.map((event, index) => (
              <TimelineItem key={`${event.type}-${event.prescription_id || event.report_id || index}-${event.date}`} event={event} planActive={plan.is_active} last={index === visible.length - 1} />
            ))}
          </ol>
        )}
      </section>
    </DoctorLayout>
  );
}

function TimelineItem({ event, planActive, last }) {
  const marker = event.type === 'report'
    ? <span className="mt-1 flex h-3 w-3 items-center justify-center"><AlertDot color={event.alert_color} /></span>
    : <span aria-hidden="true" className={`mt-1 block h-3 w-3 rounded-full ring-4 ring-white ${MARKER[event.type]}`} />;
  return (
    <li className="relative flex gap-3 pb-5">
      {!last && <span aria-hidden="true" className="absolute left-[5px] top-4 h-full w-px bg-slate-200" />}
      <div className="relative z-10 shrink-0">{marker}</div>
      <div className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="font-bold text-slate-900">
            {event.type === 'report'
              ? `${ALERT_LABELS[event.alert_color]} · EVA ${event.pain_level}${event.postoperative_day !== null ? ` · Día ${event.postoperative_day}` : ''}`
              : event.title}
          </p>
          {/* Un control solo tiene fecha: no se le inventa una hora. */}
          <time dateTime={event.date} className="text-[10px] text-slate-400">
            {event.type === 'control' ? formatDate(event.date.slice(0, 10)) : formatDateTime(event.date)}
          </time>
        </div>
        <EventBody event={event} planActive={planActive} />
      </div>
    </li>
  );
}

function EventBody({ event, planActive }) {
  if (event.type === 'start') {
    return (
      <div className="mt-1 space-y-0.5 text-slate-600">
        <p>{event.procedure || 'Sin intervención registrada'} · inicio el {formatDate(event.surgery_date)}</p>
        {event.admission_reason && <p>Motivo de consulta: {event.admission_reason}</p>}
        {event.clinical_notes && <p className="text-slate-500">Notas clínicas: {event.clinical_notes}</p>}
        <ClinicalData items={event.clinical_data} />
      </div>
    );
  }
  if (event.type === 'medication') {
    const status = event.is_active ? 'Vigente' : planActive ? 'Reemplazada' : 'Cerrada con el alta';
    return (
      <div className="mt-1 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold text-violet-800">
            {[event.medication_name, event.strength, event.dosage_form, event.frequency, event.duration].filter(Boolean).join(' · ')}
          </p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${event.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>
            {status}
          </span>
        </div>
        {event.details && <p className="mt-1 text-slate-600">{event.details}</p>}
        {event.author && <p className="mt-1 text-[10px] text-slate-400">Recetada por {event.author}</p>}
      </div>
    );
  }
  if (event.type === 'report') {
    return (
      <div className="mt-1 text-slate-600">
        {event.alert_reasons?.length > 0 && <p className="text-slate-700">Motivo: {event.alert_reasons.join('; ')}</p>}
        {event.message && <p className="mt-0.5 text-slate-500">“{event.message}”</p>}
        <SymptomChips entities={event.symptoms} />
      </div>
    );
  }
  if (event.type === 'control') {
    return (
      <div className="mt-1 space-y-0.5 text-slate-600">
        {event.notes && <p>{event.notes}</p>}
        <ClinicalData items={event.clinical_data} />
        <p className="text-slate-500">
          {event.next_control_in_days > 0 ? `Debe volver en ${event.next_control_in_days} días` : 'Sin próximo control'}
          {event.author ? ` · ${event.author}` : ''}
        </p>
      </div>
    );
  }
  if (event.type === 'care') {
    return (
      <p className="mt-1 text-slate-600">
        Cumplió el {event.adherence} % de sus cuidados{event.missed?.length ? ` · faltó: ${event.missed.join(', ')}` : ''}
      </p>
    );
  }
  if (event.type === 'summary') {
    return <p className="mt-1 text-slate-600">{event.summary}</p>;
  }
  return (
    <div className="mt-1 text-slate-600">
      {event.summary && <p>{event.summary}</p>}
      {event.author && event.type === 'change' && <p className="mt-0.5 text-[10px] text-slate-400">Por {event.author}</p>}
    </div>
  );
}

// Datos propios del tratamiento o del control, tal como los define su protocolo.
function ClinicalData({ items }) {
  if (!items?.length) return null;
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
      {items.map((item) => (
        <div key={item.label} className="flex gap-1">
          <dt className="font-semibold text-slate-700">{item.label}:</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditTreatment({ plan, onCancel, onSaved }) {
  const isMedication = Boolean(plan.medication_name);
  const [form, setForm] = useState(() => Object.fromEntries(EDIT_FIELDS.map((field) => [field, plan[field] ?? (field === 'teeth' ? [] : '')])));
  const [dentition, setDentition] = useState((plan.teeth ?? []).some((tooth) => tooth >= 51) ? 'primary' : 'permanent');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const strengths = [...new Set([...DEFAULT_STRENGTHS, plan.strength].filter(Boolean))];

  const update = ({ target }) => {
    setForm((current) => ({ ...current, [target.name]: target.value }));
    setErrors((current) => ({ ...current, [target.name]: '' }));
    setError('');
  };

  const save = async (event) => {
    event.preventDefault();
    const nextErrors = validate(form, isMedication);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError('Revisa los campos marcados antes de guardar.');
      return;
    }
    // Solo viaja lo que cambió: así el historial registra exactamente la modificación.
    const changes = Object.fromEntries(
      EDIT_FIELDS
        .filter((field) => isMedication || !['medication_name', 'strength', 'dosage_form', 'frequency', 'duration'].includes(field))
        .map((field) => [field, typeof form[field] === 'string' ? form[field].trim() : form[field]])
        // Las piezas son una lista: se comparan por contenido.
        .filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(plan[field] ?? (field === 'teeth' ? [] : ''))),
    );
    if (!Object.keys(changes).length) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/treatment-plans/${plan.id}/`, changes);
      const medicationChanged = ['medication_name', 'strength', 'dosage_form', 'frequency', 'duration'].some((field) => field in changes);
      onSaved(medicationChanged
        ? 'Tratamiento actualizado: se emitió una receta nueva y la anterior quedó en el historial. El paciente ya ve la indicación vigente.'
        : 'Tratamiento actualizado. El cambio quedó registrado en la línea de tiempo.');
    } catch (requestError) {
      const data = requestError.response?.data || {};
      setErrors(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
      setError(data.detail || 'No se pudo guardar el cambio. Revisa los datos e inténtalo nuevamente.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="mt-4 space-y-4 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Editar tratamiento en curso</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {isMedication ? 'Si cambias la medicación se emite una receta nueva; la anterior se conserva en el historial.' : 'Los cambios quedan registrados en la línea de tiempo.'}
        </p>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <IconAlertTriangle className="h-4 w-4 shrink-0" />{error}
        </p>
      )}
      {isMedication && (
        <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Medicación</legend>
          <div className="sm:col-span-2">
            <Input label="Medicamento" name="medication_name" value={form.medication_name} onChange={update} maxLength={120} error={errors.medication_name} />
          </div>
          <Select label="Concentración" name="strength" value={form.strength} onChange={update} options={strengths} error={errors.strength} />
          <Select label="Presentación" name="dosage_form" value={form.dosage_form} onChange={update} options={[...new Set([...DOSAGE_FORMS, plan.dosage_form].filter(Boolean))]} error={errors.dosage_form} />
          <Select label="Frecuencia" name="frequency" value={form.frequency} onChange={update} options={[...new Set([...FREQUENCIES, plan.frequency].filter(Boolean))]} error={errors.frequency} />
          <Input label="Duración" name="duration" value={form.duration} onChange={update} maxLength={20} placeholder="Ej. 5 días" error={errors.duration} />
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Indicaciones para el paciente" name="instructions" value={form.instructions} onChange={update} maxLength={1000} error={errors.instructions} />
        <TextArea label="Efectos que debe observar (opcional)" name="side_effects" value={form.side_effects} onChange={update} maxLength={500} error={errors.side_effects} />
      </div>
      <TextArea label="Notas clínicas internas (opcional)" name="clinical_notes" value={form.clinical_notes} onChange={update} maxLength={1000} error={errors.clinical_notes} />
      <div>
        <p className="mb-1 text-xs font-bold text-slate-700">Piezas tratadas</p>
        <Odontogram
          value={form.teeth || []}
          onChange={(teeth) => setForm((current) => ({ ...current, teeth }))}
          dentition={dentition}
          onDentitionChange={setDentition}
        />
        {errors.teeth && <span className="mt-1 block text-[11px] text-rose-600">{errors.teeth}</span>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}

const fieldClass = (error) => `mt-1 w-full rounded-xl border ${error ? 'border-rose-400' : 'border-slate-200'} bg-white p-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100`;

function Input({ label, error, ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <input {...props} className={fieldClass(error)} />
      {error && <span className="mt-1 block text-[11px] font-normal text-rose-600">{error}</span>}
    </label>
  );
}

function Select({ label, options, error, ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <select {...props} className={fieldClass(error)}>
        <option value="">Selecciona una opción</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      {error && <span className="mt-1 block text-[11px] font-normal text-rose-600">{error}</span>}
    </label>
  );
}

function TextArea({ label, error, ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <textarea rows="3" {...props} className={fieldClass(error)} />
      {error && <span className="mt-1 block text-[11px] font-normal text-rose-600">{error}</span>}
    </label>
  );
}

// Fases del tratamiento: el odontólogo cierra la actual y comienza la siguiente.
function Phases({ plan, onAdvanced }) {
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState('');
  const phases = plan.phases ?? [];
  const hasNext = phases.some((phase) => phase.status === 'pending');

  const advance = async () => {
    setAdvancing(true);
    setError('');
    try {
      const { data } = await api.post(`/treatment-plans/${plan.id}/advance-phase/`);
      onAdvanced(`Fase actual: ${data.current_phase.name}. El seguimiento diario se reinicia desde hoy.`);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'No se pudo avanzar de fase.');
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">Fases del tratamiento</h3>
        {plan.is_active && hasNext && (
          <button type="button" onClick={advance} disabled={advancing} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-50">
            {advancing ? 'Avanzando...' : 'Pasar a la siguiente fase'}
          </button>
        )}
      </div>
      <ol className="mt-3 space-y-2">
        {phases.map((phase) => (
          <li
            key={phase.id}
            aria-current={phase.status === 'active' ? 'step' : undefined}
            className={`rounded-xl border p-3 text-xs ${phase.status === 'active' ? 'border-blue-300 bg-blue-50 text-blue-900' : phase.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-bold">{phase.order}. {phase.name}</span>
              <span>{phase.status_label} · {phase.planned_days} días previstos</span>
            </div>
            {phase.description && <p className="mt-0.5 opacity-80">{phase.description}</p>}
            {(phase.start_date || phase.end_date) && (
              <p className="mt-0.5 text-[10px] opacity-70">
                {phase.start_date ? `Inicio ${formatDate(phase.start_date)}` : ''}{phase.end_date ? ` · fin ${formatDate(phase.end_date)}` : ''}
              </p>
            )}
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
    </section>
  );
}
