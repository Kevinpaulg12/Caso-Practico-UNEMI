import { useEffect, useState } from 'react';
import { fetchAll } from '../services/pagination';
import { IconHistory, IconPencil } from './Icons';
import IconButton from './IconButton';

const formatDate = (value) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString('es-EC') : '—');

// Tratamientos del paciente: los vigentes primero, cada uno con acceso a su historial y a su edición.
export default function PatientTreatments({ patientId }) {
  const [state, setState] = useState({ status: 'loading', plans: [] });

  useEffect(() => {
    let stale = false;
    fetchAll('/treatment-plans/', { patient: patientId })
      .then((plans) => {
        if (stale) return;
        const sorted = [...plans].sort((a, b) => Number(b.is_active) - Number(a.is_active)
          || (b.created_at || '').localeCompare(a.created_at || ''));
        setState({ status: 'ready', plans: sorted });
      })
      .catch(() => { if (!stale) setState({ status: 'error', plans: [] }); });
    return () => { stale = true; };
  }, [patientId]);

  const { status, plans } = state;
  const active = plans.filter((plan) => plan.is_active).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
        <h3 className="text-sm font-bold text-slate-900">Tratamientos</h3>
        {status === 'ready' && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            {active} {active === 1 ? 'vigente' : 'vigentes'} · {plans.length} en total
          </span>
        )}
      </div>
      {status === 'loading' && <p className="text-xs text-slate-500">Cargando tratamientos...</p>}
      {status === 'error' && <p role="alert" className="text-xs text-rose-700">No se pudieron cargar los tratamientos.</p>}
      {status === 'ready' && plans.length === 0 && <p className="text-xs text-slate-500">Este paciente aún no tiene tratamientos registrados.</p>}
      <ul className="space-y-2.5">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-slate-900">{plan.medication_name || plan.title}</p>
                {plan.medication_name && (
                  <p className="mt-0.5 font-semibold text-blue-700">
                    {[plan.strength, plan.dosage_form, plan.frequency, plan.duration].filter(Boolean).join(' · ')}
                  </p>
                )}
                <p className="mt-0.5 text-slate-500">
                  {plan.specialty_label ? `${plan.specialty_label} · ` : ''}{plan.procedure || 'Sin intervención registrada'} · inicio el {formatDate(plan.surgery_date)}
                  {plan.is_active ? ` · día ${plan.postoperative_day}` : ''}
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${plan.is_active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                {plan.is_active ? 'Vigente' : 'Cerrado'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <IconButton to={`/panel-doctor/tratamientos/${plan.id}`} icon={IconHistory} label="Ver historial" />
              {plan.is_active && (
                <IconButton to={`/panel-doctor/tratamientos/${plan.id}?editar=1`} icon={IconPencil} tone="primary" label="Editar tratamiento" />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
