import { describeNextControl, formatLongDate } from '../../services/consultationRules';
import Odontogram from '../Odontogram';

const formatDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('es-EC');

function followUpText(plan) {
  const day = plan.postoperative_day;
  if (plan.procedure_detail?.follow_up_unit === 'weeks' && day >= 7) {
    return `Semana ${Math.floor(day / 7) + 1} desde tu última intervención`;
  }
  return day === 0 ? 'Hoy fue tu intervención' : `Día ${day} desde tu última intervención`;
}

// Avance del tratamiento: fases, día de seguimiento, piezas y próximo control.
export default function TreatmentProgress({ plan }) {
  const detail = plan.procedure_detail;
  const phases = plan.phases ?? [];
  const totalDays = detail?.monitoring_days ?? null;
  const day = plan.postoperative_day;
  const days = totalDays === null || phases.length > 1 ? [] : Array.from({ length: totalDays + 1 }, (_, index) => index);
  const next = plan.next_control;
  const primary = (plan.teeth ?? []).some((tooth) => tooth >= 51);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">Mi tratamiento</h2>
          <p className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
            {plan.specialty_label} · {detail?.name || plan.procedure || plan.title} · inicio el {formatDate(plan.surgery_date)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm font-bold text-blue-700">{followUpText(plan)}</p>

      {next && (
        <p className={`mt-3 rounded-xl border p-3 text-xs ${next.overdue ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
          <strong className="block text-sm">
            {next.overdue ? 'Tienes un control pendiente' : 'Tu próximo control'}: <time dateTime={next.date}>{formatLongDate(next.date)}</time>
          </strong>
          {describeNextControl(next)}. Comunícate con el consultorio para confirmar tu turno.
        </p>
      )}

      {phases.length > 1 && (
        <ol aria-label="Fases del tratamiento" className="mt-3 grid gap-2 sm:grid-cols-2">
          {phases.map((phase) => (
            <li
              key={phase.id}
              aria-current={phase.status === 'active' ? 'step' : undefined}
              className={`rounded-xl border p-2.5 text-xs ${phase.status === 'active' ? 'border-blue-300 bg-blue-50 text-blue-900' : phase.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}
            >
              <span className="font-bold">{phase.order}. {phase.name}</span>
              <span className="ml-1 text-[10px]">({phase.status_label})</span>
              {phase.description && <p className="mt-0.5 text-[11px] opacity-80">{phase.description}</p>}
            </li>
          ))}
        </ol>
      )}

      {days.length > 0 && (
        <ol className="mt-3 flex gap-1" aria-label="Línea de tiempo de recuperación">
          {days.map((index) => (
            <li
              key={index}
              aria-current={index === day ? 'step' : undefined}
              title={`Día ${index}`}
              className={`h-2 flex-1 rounded-full ${index < day ? 'bg-blue-600' : index === day ? 'bg-blue-600 ring-2 ring-blue-200' : 'bg-slate-200'}`}
            />
          ))}
        </ol>
      )}
      {totalDays !== null && phases.length <= 1 && day > totalDays && (
        <p className="mt-2 text-xs text-slate-500">Terminó el periodo de seguimiento previsto. Sigue reportando si tienes molestias.</p>
      )}

      {plan.teeth?.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-bold text-slate-700">Piezas en tratamiento</p>
          <Odontogram value={plan.teeth} readOnly dentition={primary ? 'primary' : 'permanent'} />
        </div>
      )}
    </section>
  );
}
