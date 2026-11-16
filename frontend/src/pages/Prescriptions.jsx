import { Suspense, lazy, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import PatientLayout from '../components/PatientLayout';
import { PATIENT_SECTION_IDS, patientSectionPath } from '../components/patientSections';
import Loading, { SkeletonCard, SkeletonRows } from '../components/Skeleton';
import ChartLoading from '../components/charts/ChartLoading';
import { buildSeries } from '../services/evolution';
import { fetchAll } from '../services/pagination';
import { currentPlan } from '../services/plans';
import ConversationalAssistant from '../components/patient/ConversationalAssistant';
import CareChecklist from '../components/patient/CareChecklist';
import PlainInstructions from '../components/patient/PlainInstructions';
import RemindersBanner from '../components/patient/RemindersBanner';
import TreatmentProgress from '../components/patient/TreatmentProgress';
import {
  IconPill,
  IconCheckCircle,
  IconSparkles,
  IconAlertTriangle,
  IconSend,
} from '../components/Icons';

const PainChart = lazy(() => import('../components/charts/PainChart'));

function getSeverityBadgeClass(severity) {
  switch (severity?.toLowerCase()) {
    case 'alta':
      return 'border-rose-200 bg-rose-100 text-rose-700';
    case 'media':
      return 'border-amber-200 bg-amber-100 text-amber-700';
    default:
      return 'border-emerald-200 bg-emerald-100 text-emerald-700';
  }
}

const ENTITY_LABELS = { MEDICAMENTO: 'medicamento', DOSIS: 'dosis', FRECUENCIA: 'frecuencia', SINTOMA: 'síntoma' };

function TreatmentCard({ prescription }) {
  const severity = prescription.nlp_severity || 'Baja';
  const entities = Array.isArray(prescription.extracted_entities)
    ? prescription.extracted_entities
    : [];

  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow [overflow-wrap:anywhere]">
      <div className="flex items-start gap-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <IconPill className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">Indicaciones Médicas</h3>
              <p className="text-xs text-slate-500">Dr. {prescription.doctor_name || 'Especialista tratante'}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                  prescription.is_active
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {prescription.is_active ? 'ACTIVA' : 'INACTIVA'}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${getSeverityBadgeClass(
                  severity,
                )}`}
              >
                Severidad: {severity}
              </span>
            </div>
          </div>

          <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 border border-slate-100">
            {prescription.details}
          </p>
          {prescription.medication_name && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-blue-800">
              <span className="rounded-full bg-blue-50 px-2 py-1">{prescription.medication_name}</span>
              {prescription.strength && <span className="rounded-full bg-slate-100 px-2 py-1">{prescription.strength}</span>}
              {prescription.frequency && <span className="rounded-full bg-slate-100 px-2 py-1">{prescription.frequency}</span>}
              {prescription.duration && <span className="rounded-full bg-slate-100 px-2 py-1">{prescription.duration}</span>}
            </div>
          )}

          {entities.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Fármacos y dosis identificados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {entities.map((entity, index) => (
                  <span
                    key={`${entity.text}-${entity.label}-${index}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700 font-medium"
                  >
                    <span>{entity.text}</span>
                    <span className="text-[10px] font-bold text-blue-600">({ENTITY_LABELS[entity.label] ?? entity.label})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {prescription.medication_guidance && (
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-slate-700">
              <p className="font-bold text-blue-900">Efectos esperados y recomendaciones</p>
              <p className="mt-1">{prescription.medication_guidance.common_effects}</p>
              <p className="mt-2 font-semibold text-rose-700">
                Consulta de inmediato si: {prescription.medication_guidance.warning_signs}
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function CarePlanCard({ plan }) {
  const typeLabel = plan.treatment_type_label || 'Cuidado';
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow [overflow-wrap:anywhere]">
      <div className="flex items-start gap-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <IconCheckCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">{plan.title}</h3>
              <p className="text-xs text-slate-500">
                {typeLabel} · Día {plan.postoperative_day ?? plan.current_day ?? plan.day_number} de seguimiento
                {plan.procedure ? ` · ${plan.procedure}` : ''}
              </p>
            </div>
            {plan.next_due_time && (
              <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">
                Próximo: {plan.next_due_time.slice(0, 5)}
              </span>
            )}
          </div>

          <p className="mt-2 text-xs font-semibold text-slate-600">{plan.schedule_description}</p>
          <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 border border-slate-100">
            {plan.instructions}
          </p>

          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900">
            <strong className="block text-[11px] uppercase tracking-wide text-blue-700">Pauta para hoy</strong>
            <span>{plan.care_recommendations || 'Sigue las indicaciones y registra cómo te sientes.'}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

// La misma gráfica que ve el odontólogo: EVA por día de seguimiento frente a lo esperado para el tratamiento.
function PainEvolution({ reports, plan }) {
  const series = buildSeries(reports, plan?.procedure_detail?.expected_curve ?? []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Evolución de Dolor (EVA)</h2>
      <p className="text-xs text-slate-500">Tu dolor por día desde tu última intervención (D0 es el día de la intervención)</p>

      {reports.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 py-6 text-center text-xs text-slate-400">Aún no hay puntos registrados</p>
      ) : (
        <div className="mt-3">
          <Suspense fallback={<ChartLoading />}>
            <PainChart
              series={series}
              reportedLabel="Tu dolor (máx. del día)"
              expectedLabel="Lo esperado para tu procedimiento"
              className="h-52"
              ariaLabel={`Gráfica de tu dolor en ${reports.length} reportes; la tabla siguiente contiene los mismos datos.`}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}

const VISIBLE_REPORTS = 6;

function ReportHistory({ reports, total }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? reports : reports.slice(0, VISIBLE_REPORTS);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-900">Reportes Recientes</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
          {total} {total === 1 ? 'registrado' : 'registrados'}
        </span>
      </header>

      {reports.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 p-4 text-xs text-slate-500 text-center">
          Tu primer autoreporte aparecerá aquí luego de enviarlo con el asistente.
        </p>
      ) : (
        <>
        <ul className="mt-3 space-y-2.5">
          {visible.map((report) => (
            <li key={report.id} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black ${
                  report.pain_level >= 7
                    ? 'bg-rose-100 text-rose-700 border border-rose-200'
                    : report.pain_level >= 4
                    ? 'bg-amber-100 text-amber-700 border border-amber-200'
                    : 'bg-blue-100 text-blue-700 border border-blue-200'
                }`}
              >
                {report.pain_level}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap justify-between gap-2 text-[10px] text-slate-500">
                  <span className="font-semibold text-slate-600">
                    Dolor EVA ·{' '}
                    {report.comparison === 'higher'
                      ? 'Mayor'
                      : report.comparison === 'lower'
                      ? 'Menor'
                      : 'Igual'}
                  </span>
                  <time dateTime={report.created_at}>{new Date(report.created_at).toLocaleDateString('es-EC')}</time>
                </p>
                <p className="mt-1 text-xs text-slate-700 line-clamp-2 [overflow-wrap:anywhere]">{report.message}</p>
              </div>
            </li>
          ))}
        </ul>
          {reports.length > VISIBLE_REPORTS && (
            <button type="button" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)} className="mt-2.5 w-full rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
              {showAll ? 'Mostrar menos' : `Mostrar los ${reports.length} reportes`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function Prescriptions() {
  const { user } = useAuth() ?? {};
  const navigate = useNavigate();
  const [prescriptions, setPrescriptions] = useState([]);
  const [carePlans, setCarePlans] = useState([]);
  const [profile, setProfile] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportTotal, setReportTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [welcome] = useState(() => {
    if (localStorage.getItem('show_first_login_welcome') !== 'true') return null;
    localStorage.removeItem('show_first_login_welcome');
    return localStorage.getItem('logged_in_username') || 'paciente';
  });

  useEffect(() => {
    // Peticiones independientes: salen todas a la vez.
    Promise.all([
      fetchAll('/prescriptions/'),
      // Todas las páginas: la gráfica necesita cada día del seguimiento.
      fetchAll('/patient-reports/'),
      fetchAll('/treatment-plans/'),
      api.get('/patient-profile/'),
    ])
      .then(([prescriptionItems, reportItems, planItems, profileResponse]) => {
        setPrescriptions(prescriptionItems);
        setReports(reportItems);
        setReportTotal(reportItems.length);
        setCarePlans(planItems);
        const profileItems = profileResponse.data.results || profileResponse.data;
        setProfile(Array.isArray(profileItems) ? profileItems[0] : profileItems);
      })
      .catch((error) => {
        console.error('Error al cargar el plan de recuperación:', error);
        setLoadError(
          error.response?.status === 401
            ? 'Tu sesión expiró. Inicia sesión nuevamente para continuar.'
            : 'No pudimos cargar tu plan de recuperación. Intenta actualizar la página.',
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const username = localStorage.getItem('logged_in_username') || 'paciente';

  // El asistente ya clasificó y guardó el reporte: se añade al historial sin recargar.
  const onReportSaved = (report) => {
    setReports((current) => [report, ...current]);
    setReportTotal((current) => current + 1);
  };

  const activePlan = currentPlan(carePlans);
  const [searchParams] = useSearchParams();
  const section = PATIENT_SECTION_IDS.includes(searchParams.get('seccion')) ? searchParams.get('seccion') : 'tratamiento';
  const goTo = (id) => navigate(patientSectionPath(id));
  // Los cuidados se piden al abrir su sección por primera vez, no antes.
  const [careOpened, setCareOpened] = useState(section === 'cuidados');
  if (section === 'cuidados' && !careOpened) setCareOpened(true);

  const layout = { section, badges: { evolucion: reportTotal } };

  if (loading) {
    return (
      <PatientLayout {...layout}>
        <Loading label="Cargando tu plan de recuperación..." className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={5} />
          </div>
          <SkeletonRows rows={3} className="lg:col-span-4" />
        </Loading>
      </PatientLayout>
    );
  }

  if (loadError) {
    return (
      <PatientLayout {...layout}>
        <section role="alert" className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <IconAlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
          <h2 className="mt-3 font-bold text-slate-900">No se pudo cargar el portal</h2>
          <p className="mt-1 text-xs text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
          >
            Reintentar
          </button>
        </section>
      </PatientLayout>
    );
  }

  const indications = prescriptions.length + carePlans.length;

  return (
    <PatientLayout {...layout}>
      <div className="space-y-5 text-[#12233d]">
        {activePlan && <RemindersBanner onAction={goTo} />}

        {/* Las secciones inactivas se ocultan sin desmontarse: un mensaje a medio escribir no se pierde. */}
        <div id="seccion-tratamiento" hidden={section !== 'tratamiento'} className={`${section === 'tratamiento' ? 'grid' : 'hidden'} grid-cols-1 gap-6 lg:grid-cols-12`}>
          <div className="min-w-0 space-y-6 lg:col-span-8">
            <section className="flex items-start gap-3.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <IconSparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 sm:text-xl [overflow-wrap:anywhere]">
                  Hola, {user?.full_name || welcome || username}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Aquí sigues tu tratamiento odontológico: revisa tus indicaciones, cuéntale al asistente cómo te sientes
                  y marca tus cuidados para que tu odontólogo conozca tu evolución.
                </p>
              </div>
            </section>

            {activePlan && <TreatmentProgress plan={activePlan} />}

            <section aria-labelledby="indicaciones-titulo">
              <header className="mb-3 flex items-center justify-between">
                <h2 id="indicaciones-titulo" className="text-sm font-bold text-slate-900">Tratamiento y Medicación Indicada</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {indications} {indications === 1 ? 'indicación' : 'indicaciones'}
                </span>
              </header>

              {indications === 0 ? (
                <p className="rounded-2xl border border-blue-200 bg-blue-50/70 p-6 text-center text-xs text-blue-800">
                  Aún no tienes indicaciones registradas por tu doctor.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {carePlans.map((plan) => (
                    <CarePlanCard key={`plan-${plan.id}`} plan={plan} />
                  ))}
                  {prescriptions.map((prescription) => (
                    <TreatmentCard key={prescription.id} prescription={prescription} />
                  ))}
                </div>
              )}
            </section>

            {activePlan && <PlainInstructions key={activePlan.id} planId={activePlan.id} />}
          </div>

          <aside className="min-w-0 space-y-4 lg:col-span-4">
            {activePlan && (
              <section className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900">¿Cómo te sientes hoy?</h2>
                <p className="mt-1 text-xs text-slate-500">Conversa con el asistente: te hará unas preguntas y tu odontólogo verá tu reporte en su panel.</p>
                <button type="button" onClick={() => goTo('asistente')} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
                  <IconSend className="h-4 w-4" /> Hablar con el asistente
                </button>
              </section>
            )}

            {profile?.age !== null && profile?.age !== undefined && (
              <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Ficha de paciente</h2>
                <p className="mt-1 text-xs text-slate-800">
                  Edad calculada: <strong>{profile.age} años</strong>
                  {profile.phone ? ` · Contacto: ${profile.phone}` : ''}
                </p>
              </section>
            )}
          </aside>
        </div>

        <div id="seccion-asistente" hidden={section !== 'asistente'} className="mx-auto max-w-3xl space-y-4">
          <ConversationalAssistant canReport={Boolean(activePlan)} onReportSaved={onReportSaved} />
          <button type="button" onClick={() => goTo('evolucion')} className="text-xs font-bold text-blue-700 hover:underline">
            Ver cómo va tu evolución →
          </button>
        </div>

        <div id="seccion-cuidados" hidden={section !== 'cuidados'}>
          {careOpened && <CareChecklist canReport={Boolean(activePlan)} />}
        </div>

        <div id="seccion-evolucion" hidden={section !== 'evolucion'} className={`${section === 'evolucion' ? 'grid' : 'hidden'} grid-cols-1 gap-6 lg:grid-cols-12`}>
          <div className="min-w-0 lg:col-span-7">
            <PainEvolution reports={reports} plan={activePlan} />
          </div>
          <div className="min-w-0 lg:col-span-5">
            <ReportHistory reports={reports} total={reportTotal} />
          </div>
        </div>

        {/* Fuera de las secciones: el aviso y el teléfono de emergencia se ven siempre. */}
        <SafetyNotice />
      </div>
    </PatientLayout>
  );
}

function SafetyNotice() {
  return (
    <aside aria-label="Aviso médico de seguridad" className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900">
      <p className="min-w-0 max-w-3xl">
        <strong className="mb-0.5 block text-[11px] font-bold uppercase tracking-wider text-amber-800">
          Aviso médico de seguridad
        </strong>
        Esta plataforma asiste tu proceso pero no reemplaza la atención de urgencia. Si experimentas
        hemorragia continua, fiebre alta o dificultad para respirar o tragar, comunícate de inmediato con la clínica.
      </p>
      <a href="tel:042700000" className="shrink-0 rounded-xl bg-rose-600 px-3 py-2 font-bold text-white hover:bg-rose-700">
        Emergencias: 04 270 0000
      </a>
    </aside>
  );
}
