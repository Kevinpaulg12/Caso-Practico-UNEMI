import { Suspense, lazy, useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import ChartLoading from '../components/charts/ChartLoading';
import api from '../services/api';
import { buildSeries } from '../services/evolution';
import { fetchAll } from '../services/pagination';

const PainChart = lazy(() => import('../components/charts/PainChart'));

const SPECIALTIES = [
  ['cirugia', 'Cirugía oral'], ['endodoncia', 'Endodoncia'], ['ortodoncia', 'Ortodoncia'], ['periodoncia', 'Periodoncia'],
  ['implantologia', 'Implantología'], ['protesis', 'Prótesis'], ['operatoria', 'Operatoria dental'], ['estetica', 'Estética dental'],
  ['odontopediatria', 'Odontopediatría'],
];

const emptyProcedure = {
  code: '', name: '', specialty: 'cirugia', complexity: 'medium', monitoring_days: 5, follow_up_unit: 'days',
  checkin_every_days: 1, control_every_days: 0, medication_default: true, uses_teeth: true, curve: '', care: '', alarm_symptoms: [], expected: [], questions: [], phases: [],
};

// El protocolo de la API se edita como filas y textos; al guardar se vuelve a su forma JSON.
const toForm = (procedure) => ({
  ...procedure,
  curve: procedure.expected_curve.join(', '),
  care: (procedure.care_items ?? []).join('\n'),
  alarm_symptoms: procedure.alarm_symptoms ?? [],
  expected: Object.entries(procedure.expected_symptoms ?? {}).map(([symptom, days]) => ({ symptom, days })),
  questions: Object.entries(procedure.follow_up_questions ?? {}).flatMap(([key, items]) => items.map((text) => ({ key, text }))),
  phases: (procedure.default_phases ?? []).map((phase) => ({ ...phase })),
});

function parseCurve(text) {
  return text.split(',').map((value) => value.trim()).filter(Boolean).map(Number);
}

function toPayload(form) {
  const questions = {};
  form.questions.filter((row) => row.text.trim()).forEach((row) => {
    (questions[row.key] = questions[row.key] || []).push(row.text.trim());
  });
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    specialty: form.specialty,
    complexity: form.complexity,
    monitoring_days: Number(form.monitoring_days),
    follow_up_unit: form.follow_up_unit,
    checkin_every_days: Number(form.checkin_every_days),
    control_every_days: Number(form.control_every_days ?? 0),
    medication_default: Boolean(form.medication_default),
    uses_teeth: Boolean(form.uses_teeth),
    expected_curve: parseCurve(form.curve),
    care_items: form.care.split('\n').map((item) => item.trim()).filter(Boolean),
    alarm_symptoms: form.alarm_symptoms,
    expected_symptoms: Object.fromEntries(form.expected.filter((row) => row.symptom).map((row) => [row.symptom, Number(row.days)])),
    follow_up_questions: questions,
    default_phases: form.phases.filter((phase) => phase.name.trim()).map((phase) => ({
      name: phase.name.trim(), days: Number(phase.days), description: phase.description ?? '',
    })),
  };
}

export default function ClinicalCatalog() {
  const [tab, setTab] = useState('procedures');
  const [procedures, setProcedures] = useState([]);
  const [guides, setGuides] = useState([]);
  const [symptoms, setSymptoms] = useState([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(emptyProcedure);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([fetchAll('/procedures/'), fetchAll('/medication-guides/'), api.get('/nlp/vocabulary/')])
      .then(([procedureItems, guideItems, vocabulary]) => {
        setProcedures(procedureItems);
        setGuides(guideItems);
        setSymptoms(vocabulary.data.symptoms ?? []);
      })
      .catch(() => setError('No se pudo cargar el catálogo.'));
  }, []);

  const update = ({ target }) => {
    setMessage('');
    setForm((current) => ({ ...current, [target.name]: target.value }));
  };
  const setRows = (name, rows) => { setMessage(''); setForm((current) => ({ ...current, [name]: rows })); };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const payload = toPayload(form);
      const { data } = form.id
        ? await api.patch(`/procedures/${form.id}/`, payload)
        : await api.post('/procedures/', payload);
      setForm(toForm(data));
      setMessage('Protocolo guardado. El triaje y el asistente usan los cambios desde ahora.');
      setProcedures(await fetchAll('/procedures/'));
    } catch (requestError) {
      const detail = requestError.response?.data;
      setError((detail && typeof detail === 'object' && Object.values(detail).flat().join(' ')) || 'No se pudo guardar el protocolo.');
    }
  };

  const curve = parseCurve(form.curve).filter((value) => value >= 0 && value <= 10);
  const visible = filter ? procedures.filter((item) => item.specialty === filter) : procedures;
  const symptomOptions = symptoms.length ? symptoms : [...new Set(form.expected.map((row) => row.symptom))];

  return (
    <AdminLayout title="Catálogo clínico" subtitle="Protocolos de seguimiento por especialidad y guías de medicamentos.">
      <div className="mb-6 flex flex-wrap gap-2" role="tablist">
        {[['procedures', `Protocolos (${procedures.length})`], ['guides', `Guías de medicamentos (${guides.length})`]].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`px-3.5 py-2 text-xs ${tab === value ? 'border-b-2 border-blue-600 font-bold text-blue-700' : 'font-medium text-slate-500 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

      {tab === 'guides' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {guides.map((guide) => (
            <article key={guide.id} className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-700 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">{guide.name}</h2>
              <p className="mt-2">{guide.common_effects}</p>
              <p className="mt-2">{guide.what_to_do}</p>
              <p className="mt-2 font-semibold text-rose-700">{guide.warning_signs}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <section className="min-w-0 space-y-2.5">
            <button
              type="button"
              onClick={() => { setForm(emptyProcedure); setMessage(''); }}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              + Nuevo protocolo
            </button>
            <label className="block text-xs font-bold text-slate-700">
              Especialidad
              <select value={filter} onChange={(event) => setFilter(event.target.value)} className={inputClass}>
                <option value="">Todas</option>
                {SPECIALTIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {visible.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => { setForm(toForm(item)); setMessage(''); }}
                className={`w-full rounded-2xl border p-4 text-left shadow-sm transition ${form.id === item.id ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              >
                <span className="text-[11px] font-bold text-blue-700">{item.code} · {item.specialty_label}</span>
                <h3 className="mt-1 text-xs font-bold leading-snug text-slate-900">{item.name}</h3>
                <p className="mt-2 flex justify-between text-[11px] text-slate-500">
                  <span>{item.complexity_label}</span>
                  <span>{item.default_phases?.length || 1} {item.default_phases?.length === 1 ? 'fase' : 'fases'}</span>
                </p>
              </button>
            ))}
          </section>

          <form onSubmit={save} className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">{form.id ? `Editar ${form.code}` : 'Nuevo protocolo'}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código" name="code" value={form.code} onChange={update} maxLength={20} required />
              <Select label="Especialidad" name="specialty" value={form.specialty} onChange={update} options={SPECIALTIES} />
              <div className="sm:col-span-2">
                <Field label="Denominación" name="name" value={form.name} onChange={update} maxLength={160} required />
              </div>
              <Select label="Complejidad" name="complexity" value={form.complexity} onChange={update} options={[['low', 'Leve'], ['medium', 'Moderada'], ['high', 'Compleja']]} />
              <Select label="Seguimiento en" name="follow_up_unit" value={form.follow_up_unit} onChange={update} options={[['days', 'Días'], ['weeks', 'Semanas']]} />
              <Field label="Días de seguimiento intensivo" name="monitoring_days" type="number" min="1" max="60" value={form.monitoring_days} onChange={update} required />
              <Field label="Reporte esperado cada (días)" name="checkin_every_days" type="number" min="1" max="30" value={form.checkin_every_days} onChange={update} required />
              <Field label="Control en consultorio cada (días, 0 = sin controles)" name="control_every_days" type="number" min="0" max="730" value={form.control_every_days ?? 0} onChange={update} required />
              <fieldset className="space-y-2 text-xs text-slate-700">
                <legend className="mb-1 font-bold">Registro de la consulta</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="medication_default" checked={Boolean(form.medication_default)} onChange={(event) => setForm((current) => ({ ...current, medication_default: event.target.checked }))} />
                  Suele llevar receta de medicación
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="uses_teeth" checked={Boolean(form.uses_teeth)} onChange={(event) => setForm((current) => ({ ...current, uses_teeth: event.target.checked }))} />
                  Se registran las piezas dentales tratadas
                </label>
              </fieldset>
              {form.consultation_fields?.length > 0 && (
                <div className="sm:col-span-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
                  <h3 className="font-bold text-slate-700">Datos propios de este tratamiento</h3>
                  <p className="mt-1"><strong>Al iniciar:</strong> {form.consultation_fields.filter((field) => field.en?.includes('inicio')).map((field) => field.label).join(' · ') || '—'}</p>
                  <p className="mt-1"><strong>En cada control:</strong> {form.consultation_fields.filter((field) => field.en?.includes('control')).map((field) => field.label).join(' · ') || '—'}</p>
                </div>
              )}
              <div className="sm:col-span-2">
                <Field label="Curva EVA esperada desde el día 0 (separada por comas)" name="curve" value={form.curve} onChange={update} placeholder="7, 5, 4, 2, 1" />
              </div>
            </div>

            {curve.length > 0 && (
              <section className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <h3 className="text-xs font-bold text-slate-700">Curva EVA esperada por día de seguimiento</h3>
                <p className="text-[11px] text-slate-500">Es la referencia punteada que el odontólogo y el paciente ven junto a los reportes.</p>
                <Suspense fallback={<ChartLoading />}>
                  <PainChart series={buildSeries([], curve)} showReported={false} height={190} ariaLabel={`Curva esperada de ${curve.length} días: ${curve.join(', ')}`} />
                </Suspense>
              </section>
            )}

            <Group title="Reglas de triaje" hint="Ventanas en las que un síntoma es esperable; después, el reporte pasa a amarillo. Los signos de alarma son siempre rojos.">
              <Rows
                rows={form.expected}
                onChange={(rows) => setRows('expected', rows)}
                empty={{ symptom: '', days: 3 }}
                addLabel="+ Síntoma esperado"
                render={(row, change) => (
                  <>
                    <select aria-label="Síntoma" value={row.symptom} onChange={(event) => change({ symptom: event.target.value })} className={`${inputClass} mt-0 flex-1`}>
                      <option value="">Síntoma</option>
                      {symptomOptions.map((symptom) => <option key={symptom} value={symptom}>{symptom}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      hasta el día
                      <input aria-label="Último día esperado" type="number" min="0" max="365" value={row.days} onChange={(event) => change({ days: event.target.value })} className={`${inputClass} mt-0 w-20`} />
                    </label>
                  </>
                )}
              />
              <fieldset className="mt-3 min-w-0">
                <legend className="text-xs font-bold text-slate-700">Signos de alarma de este tratamiento</legend>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {symptomOptions.map((symptom) => {
                    const checked = form.alarm_symptoms.includes(symptom);
                    return (
                      <label key={symptom} className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold ${checked ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600'}`}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => setRows('alarm_symptoms', checked ? form.alarm_symptoms.filter((item) => item !== symptom) : [...form.alarm_symptoms, symptom])}
                        />
                        {symptom}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </Group>

            <Group title="Checklist diario del paciente" hint="Un cuidado por línea. Mide la adherencia al tratamiento.">
              <textarea name="care" value={form.care} onChange={update} rows={4} aria-label="Cuidados diarios" className={inputClass} />
            </Group>

            <Group title="Preguntas guía del asistente" hint="El asistente las hace cuando el paciente menciona ese síntoma («Cualquier síntoma» para preguntas generales).">
              <Rows
                rows={form.questions}
                onChange={(rows) => setRows('questions', rows)}
                empty={{ key: '*', text: '' }}
                addLabel="+ Pregunta"
                render={(row, change) => (
                  <>
                    <select aria-label="Cuándo preguntar" value={row.key} onChange={(event) => change({ key: event.target.value })} className={`${inputClass} mt-0 w-44`}>
                      <option value="*">Cualquier síntoma</option>
                      {symptomOptions.map((symptom) => <option key={symptom} value={symptom}>{symptom}</option>)}
                    </select>
                    <input aria-label="Pregunta" value={row.text} maxLength={200} onChange={(event) => change({ text: event.target.value })} className={`${inputClass} mt-0 flex-1`} />
                  </>
                )}
              />
            </Group>

            <Group title="Fases del tratamiento" hint="Se crean al registrar la consulta; el odontólogo las avanza desde el historial.">
              <Rows
                rows={form.phases}
                onChange={(rows) => setRows('phases', rows)}
                empty={{ name: '', days: 30, description: '' }}
                addLabel="+ Fase"
                render={(row, change) => (
                  <>
                    <input aria-label="Nombre de la fase" placeholder="Nombre" value={row.name} maxLength={120} onChange={(event) => change({ name: event.target.value })} className={`${inputClass} mt-0 flex-1`} />
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      <input aria-label="Duración en días" type="number" min="1" max="1000" value={row.days} onChange={(event) => change({ days: event.target.value })} className={`${inputClass} mt-0 w-20`} />
                      días
                    </label>
                  </>
                )}
              />
            </Group>

            {message && <p role="status" className="text-xs font-semibold text-emerald-700">{message}</p>}
            <div className="flex justify-end">
              <button type="submit" className="rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700">
                Guardar protocolo
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  );
}

const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-xs font-normal text-slate-900 outline-none focus:border-blue-500 focus:bg-white';

function Field({ label, ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <input {...props} className={inputClass} />
    </label>
  );
}

function Select({ label, options, ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <select {...props} className={inputClass}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );
}

function Group({ title, hint, children }) {
  return (
    <section className="rounded-xl border border-slate-100 p-4">
      <h3 className="text-xs font-bold text-slate-900">{title}</h3>
      <p className="mb-2 text-[11px] text-slate-500">{hint}</p>
      {children}
    </section>
  );
}

function Rows({ rows, onChange, empty, addLabel, render }) {
  const change = (index, patch) => onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          {render(row, (patch) => change(index, patch))}
          <button type="button" aria-label="Quitar" onClick={() => onChange(rows.filter((_, position) => position !== index))} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-rose-50 hover:text-rose-600">
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { ...empty }])} className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
        {addLabel}
      </button>
    </div>
  );
}
