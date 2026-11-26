import { useEffect, useState } from 'react';
import api from '../services/api';
import { fetchAll } from '../services/pagination';
import { AlertDot, SymptomChips } from './AlertLevel';
import { ALERT_LABELS } from './alertLevels';
import PainChart from './charts/PainChart';
import { buildSeries } from '../services/evolution';
import { currentPlan } from '../services/plans';

export default function EvolutionChart({ patientId }) {
  const [state, setState] = useState({ status: 'loading', reports: [], plan: null });

  useEffect(() => {
    let stale = false;
    Promise.all([
      fetchAll('/patient-reports/', { patient: patientId }),
      api.get('/treatment-plans/', { params: { patient: patientId } }),
    ])
      .then(([reports, plansResponse]) => {
        if (stale) return;
        const plans = plansResponse.data.results || plansResponse.data;
        const plan = currentPlan(plans);
        setState({ status: 'ready', reports, plan });
      })
      .catch(() => {
        if (!stale) setState({ status: 'error', reports: [], plan: null });
      });
    return () => {
      stale = true;
    };
  }, [patientId]);

  const { status, reports, plan } = state;
  const expectedCurve = plan?.procedure_detail?.expected_curve ?? [];
  const series = buildSeries(reports, expectedCurve);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">Evolución del dolor (EVA) por día de seguimiento</h2>
          <p className="text-xs text-slate-500">
            {plan
              ? `${plan.specialty_label ? `${plan.specialty_label} · ` : ''}${plan.procedure || plan.title} · inicio el ${new Date(`${plan.surgery_date}T00:00:00`).toLocaleDateString('es-EC')} · hoy es el día ${plan.postoperative_day}`
              : 'Sin tratamiento activo'}
          </p>
        </div>
      </div>

      {status === 'loading' && <p className="mt-4 text-xs text-slate-500">Cargando historial...</p>}
      {status === 'error' && <p role="alert" className="mt-4 text-xs text-rose-700">No se pudo cargar el historial del paciente.</p>}
      {status === 'ready' && reports.length === 0 && (
        <p className="mt-4 rounded-xl bg-slate-50 py-6 text-center text-xs text-slate-500">
          Este paciente aún no ha enviado autorreportes.
        </p>
      )}

      {status === 'ready' && reports.length > 0 && (
        <>
          <PainChart series={series} ariaLabel={`Gráfica de EVA de ${reports.length} reportes; la tabla siguiente contiene los mismos datos.`} />

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Reportes recientes</h3>
          <ul className="mt-2 space-y-2">
            {reports.slice(0, 5).map((report) => (
              <li key={report.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs [overflow-wrap:anywhere]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-bold text-slate-800">
                    <AlertDot color={report.alert_color} />
                    {ALERT_LABELS[report.alert_color]} · {report.pain_level == null ? 'sin EVA' : `EVA ${report.pain_level}`}
                    {report.postoperative_day !== null && ` · Día ${report.postoperative_day}`}
                  </span>
                  <span className="text-[10px] text-slate-400">{new Date(report.created_at).toLocaleString('es-EC')}</span>
                </div>
                {report.alert_reasons?.length > 0 && (
                  <p className="mt-1 text-slate-700">Motivo: {report.alert_reasons.join('; ')}</p>
                )}
                {report.message && <p className="mt-1 text-slate-500">“{report.message}”</p>}
                <SymptomChips entities={report.extracted_entities} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
