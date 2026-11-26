import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DoctorLayout from '../components/DoctorLayout';
import ChartLoading from '../components/charts/ChartLoading';
import api from '../services/api';
import { IconDownload, IconPrinter } from '../components/Icons';
import IconButton from '../components/IconButton';

// D3 se descarga solo al abrir el informe.
const PainByDayChart = lazy(() => import('../components/charts/ReportCharts').then((module) => ({ default: module.PainByDayChart })));
const SymptomChart = lazy(() => import('../components/charts/ReportCharts').then((module) => ({ default: module.SymptomChart })));

const RISK_LABELS = { Bajo: 'Evolución normal', Medio: 'En observación', Alto: 'Riesgo alto' };
const RISK_COLORS = { Bajo: 'text-emerald-700', Medio: 'text-amber-700', Alto: 'text-rose-700' };
const PERIODS = { 30: 'Últimos 30 días', 90: 'Últimos 90 días', 365: 'Último año' };

function percent(value, total) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
}

const longDate = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function downloadCsv(report) {
  const activity = report.activity;
  const rows = [
    ['Indicador', 'Valor'],
    ['Periodo (días)', report.days],
    ...(activity ? [
      ['Tratamientos iniciados', activity.treatments_started],
      ['Tratamientos en curso', activity.treatments_active],
      ['Tratamientos con alta', activity.treatments_discharged],
      ['Pacientes atendidos', activity.patients_treated],
      ['Controles realizados', activity.controls_given],
      ['Altas dadas', activity.discharges_given],
      ['Recetas emitidas', activity.prescriptions_issued],
      ['Citas atendidas', activity.appointments_attended],
      ['Citas canceladas', activity.appointments_cancelled],
      ...activity.by_procedure.map((item) => [`Tratamientos: ${item.procedure}`, item.total]),
      ...activity.top_medications.map((item) => [`Recetado: ${item.name}`, item.count]),
    ] : []),
    ['Pacientes monitoreados', report.patients_monitored],
    ['Reportes', report.reports_total],
    ['Reportes de riesgo medio', report.alerts_medium],
    ['Reportes de riesgo alto', report.alerts_high],
    ['Seguimiento promedio (días)', report.average_followup_days ?? ''],
    ...report.pain_by_day.map((item) => [`EVA promedio día ${item.day}`, item.average]),
    ...report.top_symptoms.map((item) => [`Síntoma: ${item.label}`, item.count]),
    ...(activity?.treatments.length ? [
      [],
      ['Paciente', 'Tratamiento', 'Piezas', 'Inicio', 'Estado', 'Controles', 'Medicación', 'Alertas rojas'],
      ...activity.treatments.map((item) => [
        item.patient_name, item.procedure, item.teeth.join(' '), item.start_date ?? '', item.status,
        item.controls, item.medications.join(', '), item.high_alerts,
      ]),
    ] : []),
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
  // Fecha de generación del PDF: se toma una vez al abrir el informe.
  const [generatedAt] = useState(() => new Date());

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
  const activity = report?.activity;

  return (
    <DoctorLayout
      title="Informes clínicos"
      subtitle="Los tratamientos que realizaste y cómo evolucionaron tus pacientes. Puedes imprimirlo o guardarlo en PDF."
    >
      <div className="mb-6 flex flex-wrap items-center justify-end gap-2.5 print:hidden">
        <select
          value={days}
          onChange={(event) => setDays(event.target.value)}
          aria-label="Periodo"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm outline-none"
        >
          {Object.entries(PERIODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <IconButton icon={IconPrinter} label="Imprimir / PDF" onClick={() => window.print()} />
        <IconButton icon={IconDownload} tone="primary" label="Exportar CSV" disabled={!report} onClick={() => downloadCsv(report)} />
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

      {report && (
        <>
          {/* Encabezado del PDF: quién, qué periodo y cuándo se generó. */}
          <header className="mb-6 hidden border-b-2 border-slate-900 pb-3 print:block">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">DentalSense · Informe clínico</p>
            <h1 className="text-xl font-black text-slate-900">Informe de tratamientos{activity?.doctor_name ? ` · Dr(a). ${activity.doctor_name}` : ''}</h1>
            <p className="text-xs text-slate-600">{PERIODS[report.days] ?? `Últimos ${report.days} días`} · generado el {generatedAt.toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </header>

          {activity && <Activity activity={activity} />}

          <h2 className="mb-3 mt-8 text-xs font-black uppercase tracking-wider text-slate-500 print:break-before-auto">Evolución de tus pacientes</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric title="Pacientes monitoreados" value={report.patients_monitored} detail={`${report.reports_total} reportes`} />
            <Metric title="Reportes en observación" value={report.alerts_medium} detail={percent(report.alerts_medium, report.reports_total)} />
            <Metric title="Reportes de riesgo alto" value={report.alerts_high} detail={percent(report.alerts_high, report.reports_total)} />
            <Metric title="Seguimiento promedio" value={report.average_followup_days === null ? '—' : `${report.average_followup_days} días`} detail="Del primer al último reporte" />
          </div>

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:break-inside-avoid print:shadow-none">
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
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:break-inside-avoid print:shadow-none">
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

            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:break-inside-avoid print:shadow-none">
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
          <p className="mt-6 hidden text-[10px] text-slate-500 print:block">
            Informe generado automáticamente a partir de las consultas, controles, recetas y reportes registrados en DentalSense. No reemplaza la historia clínica.
          </p>
        </>
      )}
    </DoctorLayout>
  );
}

function Activity({ activity }) {
  const stats = [
    ['Tratamientos iniciados', activity.treatments_started, `${activity.treatments_active} en curso · ${activity.treatments_discharged} con alta`],
    ['Pacientes atendidos', activity.patients_treated, `${activity.reports_received} reportes recibidos`],
    ['Controles realizados', activity.controls_given, `${activity.appointments_attended} citas atendidas`],
    ['Altas dadas', activity.discharges_given, `${activity.treatments_with_high_alerts} tratamientos con alerta roja`],
    ['Recetas emitidas', activity.prescriptions_issued, `${activity.top_medications.length} medicamentos distintos`],
    ['Citas canceladas', activity.appointments_cancelled, 'Por ti o por el paciente'],
  ];
  const topCount = activity.top_medications[0]?.count ?? 0;

  return (
    <>
      <h2 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">Tu actividad clínica</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-3">
        {stats.map(([title, value, detail]) => <Metric key={title} title={title} value={value} detail={detail} />)}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr] print:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="por-procedimiento" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:break-inside-avoid print:shadow-none">
          <h2 id="por-procedimiento" className="text-sm font-bold text-slate-900">Tratamientos por procedimiento</h2>
          {activity.by_procedure.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">No iniciaste tratamientos en este periodo.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                  <tr><th className="py-2 pr-3 font-bold">Procedimiento</th><th className="py-2 pr-3 text-right font-bold">Total</th><th className="py-2 pr-3 text-right font-bold">En curso</th><th className="py-2 pr-3 text-right font-bold">Alta</th><th className="py-2 text-right font-bold">Pacientes</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activity.by_procedure.map((item) => (
                    <tr key={item.procedure}>
                      <td className="py-2 pr-3"><strong className="block text-slate-900">{item.procedure}</strong><span className="text-[10px] text-slate-500">{item.specialty}</span></td>
                      <td className="py-2 pr-3 text-right font-black tabular-nums text-slate-900">{item.total}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{item.active}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{item.discharged}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">{item.patients}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="mas-recetados" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:break-inside-avoid print:shadow-none">
          <h2 id="mas-recetados" className="text-sm font-bold text-slate-900">Medicamentos más recetados</h2>
          {activity.top_medications.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">No emitiste recetas en este periodo.</p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-xs">
              {activity.top_medications.map((item) => (
                <li key={item.name}>
                  <span className="flex justify-between gap-2"><span className="truncate text-slate-800">{item.name}</span><strong className="tabular-nums text-slate-900">{item.count}</strong></span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-blue-600 print:bg-slate-700" style={{ width: `${Math.round((item.count / topCount) * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="detalle-tratamientos" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:shadow-none">
        <h2 id="detalle-tratamientos" className="text-sm font-bold text-slate-900">Detalle de tratamientos</h2>
        <p className="text-xs text-slate-500">Cada tratamiento que iniciaste en el periodo, con sus controles, medicación y alertas.</p>
        {activity.treatments.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-500">Sin tratamientos en este periodo.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-bold">Paciente</th><th className="py-2 pr-3 font-bold">Tratamiento</th><th className="py-2 pr-3 font-bold">Inicio</th>
                  <th className="py-2 pr-3 font-bold">Estado</th><th className="py-2 pr-3 text-right font-bold">Controles</th><th className="py-2 pr-3 font-bold">Medicación</th><th className="py-2 text-right font-bold">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activity.treatments.map((item) => (
                  <tr key={item.id} className="align-top print:break-inside-avoid">
                    <td className="py-2 pr-3 font-semibold text-slate-900">
                      <Link to={`/panel-doctor/tratamientos/${item.id}`} className="hover:text-blue-700 hover:underline print:no-underline">{item.patient_name}</Link>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{item.procedure}{item.teeth.length > 0 && <span className="block text-[10px] text-slate-400">Piezas {item.teeth.join(', ')}</span>}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{longDate(item.start_date)}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.status === 'Alta' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                        {item.status}{item.discharged_at ? ` · ${longDate(item.discharged_at)}` : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{item.controls}</td>
                    <td className="py-2 pr-3 text-slate-600">{item.medications.join(', ') || '—'}</td>
                    <td className={`py-2 text-right tabular-nums ${item.high_alerts ? 'font-bold text-rose-700' : 'text-slate-400'}`}>{item.high_alerts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Metric({ title, value, detail }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:break-inside-avoid print:p-3 print:shadow-none">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}
