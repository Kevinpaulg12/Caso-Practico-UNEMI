import { IconHistory } from '../Icons';

const formatDate = (value) => (value
  ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' })
  : null);

/** Tratamientos ya cerrados: el paciente conserva sus indicaciones después del alta. */
export default function PastTreatments({ plans }) {
  if (!plans.length) return null;
  return (
    <section aria-labelledby="tratamientos-anteriores" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <IconHistory className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="tratamientos-anteriores" className="text-sm font-bold text-slate-900">Mis tratamientos anteriores</h2>
          <p className="text-xs text-slate-500">Lo que te indicó tu odontólogo en cada tratamiento ya terminado.</p>
        </div>
      </header>
      <ul className="mt-4 space-y-2">
        {plans.map((plan) => (
          <li key={plan.id}>
            <details className="group rounded-xl border border-slate-200 [overflow-wrap:anywhere]">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-3 text-xs hover:bg-slate-50">
                <span className="min-w-0">
                  <strong className="block text-sm text-slate-900">{plan.procedure || plan.title}</strong>
                  <span className="text-slate-500">
                    {[plan.specialty_label, formatDate(plan.surgery_date || plan.start_date) && `desde el ${formatDate(plan.surgery_date || plan.start_date)}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600">Terminado</span>
              </summary>
              <div className="space-y-2 border-t border-slate-100 p-3 text-xs text-slate-700">
                {plan.admission_reason && <p><strong className="text-slate-900">Motivo:</strong> {plan.admission_reason}</p>}
                {plan.instructions && (
                  <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3"><strong className="block text-slate-900">Indicaciones</strong>{plan.instructions}</p>
                )}
                {plan.diet_instructions && (
                  <p className="whitespace-pre-line rounded-lg bg-emerald-50/70 p-3 text-emerald-900"><strong className="block">Dieta</strong>{plan.diet_instructions}</p>
                )}
                {plan.medication_name && (
                  <p><strong className="text-slate-900">Medicación:</strong> {[plan.medication_name, plan.strength, plan.frequency, plan.duration].filter(Boolean).join(' · ')}</p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
