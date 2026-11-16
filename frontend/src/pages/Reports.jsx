import { Suspense, lazy, useEffect, useState } from 'react';
import DoctorLayout from '../components/DoctorLayout';
import ChartLoading from '../components/charts/ChartLoading';
import api from '../services/api';

// D3 se descarga solo al abrir el informe.
const PainByDayChart = lazy(() => import('../components/charts/ReportCharts').then((module) => ({ default: module.PainByDayChart })));
const SymptomChart = lazy(() => import('../components/charts/ReportCharts').then((module) => ({ default: module.SymptomChart })));

const RISK_LABELS = { Bajo: 'Evolución normal', Medio: 'En observación', Alto: 'Riesgo alto' };
const RISK_COLORS = { Bajo: 'text-emerald-700', Medio: 'text-amber-700', Alto: 'text-rose-700' };

function percent(value, total) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
}

function downloadCsv(report) {
  const rows = [
    ['Indicador', 'Valor'],
    ['Periodo (días)', report.days],
    ['Pacientes monitoreados', report.patients_monitored],
    ['Reportes', report.reports_total],
    ['Reportes de riesgo medio', report.alerts_medium],
    ['Reportes de riesgo alto', report.alerts_high],
    ['Seguimiento promedio (días)', report.average_followup_days ?? ''],
    ...report.pain_by_day.map((item) => [`EVA promedio día ${item.day}`, item.average]),
    ...report.top_symptoms.map((item) => [`Síntoma: ${item.label}`, item.count]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `informe-${report.days}-dias.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [days, setDays] = useState('30');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    api.get('/reports/summary/', { params: { days } })
      .then(({ data }) => {
        if (stale) return;
        setReport(data);
        setError('');
      })
      .catch(() => {
        if (!stale) setError('No se pudo cargar el informe.');
      });
    return () => {
      stale = true;
    };
  }, [days]);

  const latestTotal = report ? Object.values(report.risk_distribution).reduce((sum, value) => sum + value, 0) : 0;

  return (
    <DoctorLayout
      title="Informes clínicos"
      subtitle="Evolución de tus pacientes, calculada a partir de sus reportes."
    >
      <div className="mb-6 flex flex-wrap items-center justify-end gap-2.5 print:hidden">
        <select
          value={days}
          onChange={(event) => setDays(event.target.value)}
          aria-label="Periodo"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm outline-none"
        >
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
        </select>
        <button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-95 transition">
          Imprimir / PDF
        </button>
        <button type="button" disabled={!report} onClick={() => downloadCsv(report)} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition disabled:opacity-50">
          Exportar CSV
        </button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric title="Pacientes monitoreados" value={report.patients_monitored} detail={`${report.reports_total} reportes`} />
            <Metric title="Reportes en observación" value={report.alerts_medium} detail={percent(report.alerts_medium, report.reports_total)} />
            <Metric title="Reportes de riesgo alto" value={report.alerts_high} detail={percent(report.alerts_high, report.reports_total)} />
            <Metric title="Seguimiento promedio" value={report.average_followup_days === null ? '—' : `${report.average_followup_days} días`} detail="Del primer al último reporte" />
          </div>

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900">Dolor promedio (EVA) por día de seguimiento</h2>
              <span className="rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-[10px] font-bold text-rose-700">
                Riesgo alto: EVA ≥ {report.high_pain_threshold}
              </span>
            </div>
            {report.pain_by_day.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-500">No hay reportes en este periodo.</p>
            ) : (
              <Suspense fallback={<ChartLoading />}>
                <PainByDayChart data={report.pain_by_day} threshold={report.high_pain_threshold} />
              </Suspense>
            )}
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Riesgo actual por paciente</h2>
              <div className="mt-4 space-y-1.5 text-xs">
                {Object.entries(report.risk_distribution).map(([level, value]) => (
                  <p key={level} className="flex justify-between text-slate-700">
                    <span>{RISK_LABELS[level]}</span>
                    <strong className={RISK_COLORS[level]}>{value} ({percent(value, latestTotal)})</strong>
                  </p>
                ))}
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Signos de alarma mencionados</h2>
              {report.top_symptoms.length === 0 ? (
                <p className="mt-4 text-xs text-slate-500">Ningún reporte menciona signos de alarma.</p>
              ) : (
                <Suspense fallback={<ChartLoading />}>
                  <SymptomChart data={report.top_symptoms} />
                </Suspense>
              )}
            </section>
          </div>
        </>
      )}
    </DoctorLayout>
  );
}

function Metric({ title, value, detail }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}
