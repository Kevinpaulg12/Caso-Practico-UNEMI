import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DoctorLayout from '../components/DoctorLayout';
import Odontogram from '../components/Odontogram';
import Loading, { SkeletonCard, SkeletonRows } from '../components/Skeleton';
import api from '../services/api';
import { ClinicalData, TimelineItem } from './TreatmentHistory';
import { IconArrowLeft, IconArrowRight } from '../components/Icons';

const formatDate = (value) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const formatDateTime = (value) => new Date(value).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Historia clínica longitudinal: todos los tratamientos del paciente, con quien los haya atendido,
 * para dar continuidad entre colegas y no repetir esquemas que ya fallaron. Cada consulta queda auditada.
 */
export default function ClinicalHistory() {
  const { patientId } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    api.get(`/patients/${patientId}/clinical-history/`)
      .then(({ data }) => setState({ status: 'ready', data }))
      .catch((error) => setState({ status: error.response?.status === 404 ? 'missing' : 'error', data: null }));
  }, [patientId]);

  if (state.status !== 'ready') {
    return (
      <DoctorLayout title="Historia clínica">
        <Link to="/panel-doctor/monitoreo" className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:underline"><IconArrowLeft className="h-3.5 w-3.5 shrink-0" />Volver a Monitoreo</Link>
        {state.status === 'loading' ? (
          <Loading label="Cargando historia clínica..." className="mt-3 space-y-5">
            <SkeletonCard lines={3} />
            <SkeletonRows rows={4} />
          </Loading>
        ) : (
          <p role="alert" className="mt-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            {state.status === 'missing' ? 'Este paciente no existe.' : 'No se pudo cargar la historia clínica. Recarga la página para intentarlo de nuevo.'}
          </p>
        )}
      </DoctorLayout>
    );
  }

  const { patient, summary, medications, treatments } = state.data;
  return (
    <DoctorLayout title="Historia clínica" subtitle="Todos los tratamientos del paciente en la clínica, lo atendiera quien lo atendiera. Tu consulta queda registrada.">
      <Link to="/panel-doctor/monitoreo" className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:underline"><IconArrowLeft className="h-3.5 w-3.5 shrink-0" />Volver a Monitoreo</Link>

      <header className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">{patient.full_name}</h2>
        <p className="mt-1 text-xs text-slate-500">
          HC-{String(patient.id).padStart(5, '0')}{patient.national_id ? ` · C.I. ${patient.national_id}` : ''}
          {patient.age != null ? ` · ${patient.age} ${patient.age === 1 ? 'año' : 'años'}` : ''}
          {patient.primary_doctor ? ` · Odontólogo asignado: ${patient.primary_doctor}` : ''}
        </p>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4">
          <Fact label="Tratamientos" value={`${summary.treatments} (${summary.active_treatments} en curso)`} />
          <Fact label="Odontólogos que lo atendieron" value={summary.dentists.join(', ') || '—'} />
          <Fact label="Síntomas más frecuentes" value={summary.frequent_symptoms.map((item) => `${item.label} (${item.days} d)`).join(', ') || '—'} />
          <Fact label="Medicamentos recetados" value={medications.length} />
        </dl>
      </header>

      {medications.length > 0 && (
        <section aria-labelledby="medicacion-historica" className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 id="medicacion-historica" className="text-sm font-bold text-slate-900">Medicación recetada</h3>
          <p className="text-xs text-slate-500">Para no repetir un esquema que no funcionó: cada receta muestra si su tratamiento tuvo alertas rojas.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="p-2">Fecha</th>
                  <th scope="col" className="p-2">Medicamento</th>
                  <th scope="col" className="p-2">Tratamiento</th>
                  <th scope="col" className="p-2">Recetó</th>
                  <th scope="col" className="p-2">Alertas rojas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {medications.map((item, index) => (
                  <tr key={`${item.treatment_id}-${index}`}>
                    <td className="p-2"><time dateTime={item.date}>{formatDateTime(item.date)}</time></td>
                    <td className="p-2 font-semibold text-slate-800">{[item.name, item.strength, item.frequency, item.duration].filter(Boolean).join(' · ')}</td>
                    <td className="p-2">{item.treatment}</td>
                    <td className="p-2">{item.doctor || '—'}</td>
                    <td className={`p-2 font-bold ${item.red_alerts_in_treatment ? 'text-rose-700' : 'text-slate-500'}`}>{item.red_alerts_in_treatment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ol aria-label="Tratamientos del paciente" className="mt-5 space-y-5">
        {treatments.length === 0 && <li className="rounded-2xl bg-white p-6 text-center text-xs text-slate-500 shadow-sm">Aún no tiene tratamientos registrados.</li>}
        {treatments.map(({ plan, dentists, outcome, events }) => (
          <li key={plan.id}>
            <article aria-labelledby={`tratamiento-${plan.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 id={`tratamiento-${plan.id}`} className="text-sm font-black text-slate-900">{plan.procedure || plan.title}</h3>
                  <p className="text-xs text-slate-500">
                    {plan.specialty_label} · inicio el {formatDate(plan.surgery_date)} · {dentists.join(', ') || 'Sin odontólogo registrado'}
                  </p>
                  {plan.admission_reason && <p className="mt-0.5 text-xs text-slate-600">Motivo: {plan.admission_reason}</p>}
                  <ClinicalData items={plan.clinical_data_display} />
                </div>
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${plan.is_active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                  {plan.is_active ? 'En curso' : 'Cerrado'}
                </span>
              </header>
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                <Fact inline label="Días con seguimiento" value={outcome.days_with_followup} />
                <Fact inline label="EVA máximo" value={outcome.max_pain ?? '—'} />
                <Fact inline label="Último EVA" value={outcome.last_pain ?? '—'} />
                <Fact inline label="Alertas rojas" value={outcome.red_alerts} />
                <Fact inline label="Alertas amarillas" value={outcome.yellow_alerts} />
              </dl>
              {plan.teeth?.length > 0 && (
                <div className="mt-3 max-w-xl">
                  <Odontogram value={plan.teeth} readOnly dentition={plan.teeth.some((tooth) => tooth >= 51) ? 'primary' : 'permanent'} />
                </div>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-bold text-blue-700">Ver la línea de tiempo ({events.length} eventos)</summary>
                <ol aria-label={`Línea de tiempo de ${plan.procedure || plan.title}`} className="mt-3">
                  {events.map((event, index) => (
                    <TimelineItem key={`${event.type}-${event.date}-${index}`} event={event} planActive={plan.is_active} last={index === events.length - 1} />
                  ))}
                </ol>
              </details>
              {plan.is_active && (
                <Link to={`/panel-doctor/tratamientos/${plan.id}`} className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold text-blue-700 hover:underline">Abrir el tratamiento en curso<IconArrowRight className="h-3.5 w-3.5 shrink-0" /></Link>
              )}
            </article>
          </li>
        ))}
      </ol>
    </DoctorLayout>
  );
}

function Fact({ label, value, inline = false }) {
  return (
    <div className={inline ? 'flex gap-1' : 'rounded-xl bg-slate-50 p-3'}>
      <dt className={inline ? 'font-semibold' : 'text-[10px] font-bold uppercase tracking-wider text-slate-500'}>{label}{inline ? ':' : ''}</dt>
      <dd className={inline ? '' : 'mt-1 font-semibold text-slate-900'}>{value}</dd>
    </div>
  );
}
