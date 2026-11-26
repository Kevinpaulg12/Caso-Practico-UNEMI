import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import PatientLayout from '../components/PatientLayout';
import { PATIENT_SECTION_IDS, patientSectionPath } from '../components/patientSections';
import Loading, { SkeletonCard, SkeletonRows } from '../components/Skeleton';
import { fetchAll } from '../services/pagination';
import { currentPlan } from '../services/plans';
import AppointmentRequests from '../components/patient/AppointmentRequests';
import ConversationalAssistant from '../components/patient/ConversationalAssistant';
import CareChecklist from '../components/patient/CareChecklist';
import MyMedication from '../components/patient/MyMedication';
import PastTreatments from '../components/patient/PastTreatments';
import PlainInstructions from '../components/patient/PlainInstructions';
import RemindersBanner from '../components/patient/RemindersBanner';
import TreatmentProgress from '../components/patient/TreatmentProgress';
import {
  IconPill,
  IconCheckCircle,
  IconSparkles,
  IconAlertTriangle,
  IconArrowRight,
  IconCalendar,
  IconRefresh,
} from '../components/Icons';

function TreatmentCard({ prescription, onShowEffects }) {
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

          <button type="button" onClick={onShowEffects} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100">
            <IconArrowRight className="h-3.5 w-3.5" />Cómo tomarlo y posibles efectos
          </button>
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
          {plan.diet_instructions && (
            <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs text-emerald-900">
              <strong className="block text-[11px] uppercase tracking-wide text-emerald-700">Dieta</strong>
              <span className="whitespace-pre-line">{plan.diet_instructions}</span>
            </div>
          )}

          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900">
            <strong className="block text-[11px] uppercase tracking-wide text-blue-700">Pauta para hoy</strong>
            <span>{plan.care_recommendations || 'Sigue las indicaciones y registra cómo te sientes.'}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function Prescriptions() {
  const { user } = useAuth() ?? {};
  const navigate = useNavigate();
  // Todo lo del paciente, vigente y cerrado: tras el alta conserva su historial y puede pedir una cita.
  const [allPrescriptions, setPrescriptions] = useState([]);
  const [allPlans, setCarePlans] = useState([]);
  const [profile, setProfile] = useState(null);
  // Cambia con cada mensaje al asistente: refresca las citas pedidas.
  const [activity, setActivity] = useState(0);
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
      fetchAll('/prescriptions/', { include_closed: 'true' }),
      fetchAll('/treatment-plans/', { include_closed: 'true' }),
      api.get('/patient-profile/'),
    ])
      .then(([prescriptionItems, planItems, profileResponse]) => {
        setPrescriptions(prescriptionItems);
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

  const onActivity = () => setActivity((current) => current + 1);

  const carePlans = allPlans.filter((plan) => plan.is_active);
  const pastPlans = allPlans.filter((plan) => !plan.is_active);
  const prescriptions = allPrescriptions.filter((item) => item.is_active);
  const activePlan = currentPlan(carePlans);
  // Dado de alta: sin tratamiento vigente, pero con tratamientos anteriores.
  const discharged = !activePlan && pastPlans.length > 0;
  const [searchParams] = useSearchParams();
  const section = PATIENT_SECTION_IDS.includes(searchParams.get('seccion')) ? searchParams.get('seccion') : 'tratamiento';
  const goTo = (id) => navigate(patientSectionPath(id));
  // Los cuidados se piden al abrir su sección por primera vez, no antes.
  const [careOpened, setCareOpened] = useState(section === 'cuidados');
  if (section === 'cuidados' && !careOpened) setCareOpened(true);

  const layout = { section };

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
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
          >
            <IconRefresh className="h-4 w-4" />Reintentar
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
        <div id="seccion-tratamiento" hidden={section !== 'tratamiento'} className={`${section === 'tratamiento' ? 'grid' : 'hidden'} ds-enter grid-cols-1 gap-6 lg:grid-cols-12`}>
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
                  {discharged
                    ? 'Tu odontólogo te dio de alta. Aquí siguen tus tratamientos anteriores y, si necesitas volver, puedes pedir una cita al asistente.'
                    : 'Aquí sigues tu tratamiento odontológico: revisa tus indicaciones, consulta en Mis cuidados cómo tomar tu medicación y cuéntale al asistente cómo te sientes; tu odontólogo estará al tanto.'}
                </p>
                {discharged && (
                  <button type="button" onClick={() => goTo('asistente')} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700">
                    <IconCalendar className="h-4 w-4" />Pedir una cita
                  </button>
                )}
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
                  {discharged ? 'No tienes indicaciones vigentes: tu tratamiento terminó.' : 'Aún no tienes indicaciones registradas por tu doctor.'}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {carePlans.map((plan) => (
                    <CarePlanCard key={`plan-${plan.id}`} plan={plan} />
                  ))}
                  {prescriptions.map((prescription) => (
                    <TreatmentCard key={prescription.id} prescription={prescription} onShowEffects={() => goTo('cuidados')} />
                  ))}
                </div>
              )}
            </section>

            {activePlan && <PlainInstructions key={activePlan.id} planId={activePlan.id} />}

            <PastTreatments plans={pastPlans} />
          </div>

          <aside className="min-w-0 space-y-4 lg:col-span-4">
            {(activePlan || discharged) && <AppointmentRequests refreshKey={activity} onRequest={() => goTo('asistente')} />}

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

        <div id="seccion-asistente" hidden={section !== 'asistente'} className="ds-enter mx-auto max-w-3xl space-y-4">
          <ConversationalAssistant canTalk={Boolean(activePlan) || discharged} discharged={discharged} onActivity={onActivity} contact={profile?.doctor_contact ?? null} />
        </div>

        {/* Mis cuidados: primero la medicación y sus posibles efectos; después, los cuidados del día. */}
        <div id="seccion-cuidados" hidden={section !== 'cuidados'} className="ds-enter space-y-6">
          <MyMedication prescriptions={allPrescriptions} />
          {careOpened && <CareChecklist canReport={Boolean(activePlan)} />}
        </div>
      </div>
    </PatientLayout>
  );
}
