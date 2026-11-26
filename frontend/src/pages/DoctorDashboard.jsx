import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { describeNextControl } from '../services/consultationRules';
import DoctorLayout from '../components/DoctorLayout';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import PatientTreatments from '../components/PatientTreatments';
import AISummaryCard from '../components/AISummaryCard';
import Loading, { SkeletonCard, SkeletonRows } from '../components/Skeleton';
import { IconAlertTriangle, IconArrowRight, IconCheck, IconCheckCircle, IconClipboard, IconHistory, IconSearch } from '../components/Icons';
// La librería de gráficos solo se descarga en el panel del doctor.
const EvolutionChart = lazy(() => import('../components/EvolutionChart'));

const BACKGROUND = { headers: { 'X-Background-Request': '1' } };

function RiskBadge({ risk, hasActiveTreatment }) {
  const isHigh = risk === 'Alto';
  const isMedium = risk === 'Medio';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
        isHigh
          ? 'bg-rose-100 text-rose-700 border border-rose-200'
          : isMedium
          ? 'bg-amber-100 text-amber-700 border border-amber-200'
          : risk === 'Sin seguimiento'
          ? 'bg-slate-100 text-slate-600 border border-slate-200'
          : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          isHigh ? 'bg-rose-600' : isMedium ? 'bg-amber-600' : risk === 'Sin seguimiento' ? 'bg-slate-400' : 'bg-emerald-600'
        }`}
      />
      {isHigh
        ? 'Rojo · riesgo alto'
        : isMedium
        ? 'Amarillo · en observación'
        : risk === 'Sin seguimiento'
        ? hasActiveTreatment
          ? 'Pendiente de reporte'
          : 'Sin tratamiento'
        : 'Verde · estable'}
    </span>
  );
}

function PatientCard({ patient, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border p-4 text-left shadow-sm transition-[border-color,box-shadow,background-color] duration-150 active:scale-[0.99] ${
        selected
          ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-100 shadow-md'
          : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow'
      }`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <strong className="block text-sm font-bold text-slate-900 [overflow-wrap:anywhere]">{patient.full_name || patient.username}</strong>
          <span className="mt-0.5 block text-xs text-slate-500">
            HC-{String(patient.id).padStart(5, '0')} · {patient.national_id || 'Sin cédula'}
          </span>
          {patient.specialty_label && (
            <span className="mt-1 block text-[11px] font-semibold text-blue-700 [overflow-wrap:anywhere]">
              {patient.specialty_label}{patient.treatment ? ` · ${patient.treatment}` : ''}
            </span>
          )}
        </span>
        <RiskBadge risk={patient.risk_level} hasActiveTreatment={patient.has_active_treatment} />
      </span>

      <span className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
        <span className="flex items-center gap-1 font-medium">
          {patient.latest_report ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                patient.latest_report.pain_level >= 7
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {patient.latest_report.pain_level == null ? 'Sin EVA hoy' : `Último EVA: ${patient.latest_report.pain_level}`}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500">Aún no conversa con el asistente</span>
          )}
        </span>
        <span className={`text-[11px] font-bold ${selected ? 'text-blue-600' : 'text-slate-500'}`}>
          {patient.next_control
            ? <span className={patient.next_control.overdue ? 'text-amber-700' : undefined}>{describeNextControl(patient.next_control)}</span>
            : selected
              ? <span className="inline-flex items-center gap-1"><IconCheck className="h-3.5 w-3.5" />Seleccionado</span>
              : <span className="inline-flex items-center gap-1">Ver ficha<IconArrowRight className="h-3.5 w-3.5" /></span>}
        </span>
      </span>
    </button>
  );
}

const REFRESH_MS = 60000;

export default function DoctorDashboard() {
  const { user } = useAuth() ?? {};
  const [roster, setRoster] = useState([]);
  const [results, setResults] = useState(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [discharging, setDischarging] = useState(false);
  const [confirmDischarge, setConfirmDischarge] = useState(false);
  const [dischargeMessage, setDischargeMessage] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [specialty, setSpecialty] = useState('');
  const [loading, setLoading] = useState(true);

  // La lista solo trae a los pacientes con tratamiento activo; los dados de alta están en Historial y Altas.
  useEffect(() => {
    api.get('/patients/')
      .then(({ data }) => {
        setRoster(data);
        if (data.length) setSelectedPatient(data[0]);
      })
      .catch((error) => {
        console.error('Error al cargar pacientes:', error);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  // Las alertas nuevas aparecen sin recargar la página.
  useEffect(() => {
    const timer = setInterval(() => {
      api.get('/patients/', BACKGROUND)
        .then(({ data }) => {
          setRoster(data);
          setLoadError(false);
          setSelectedPatient((current) => (current ? data.find((item) => item.id === current.id) ?? current : current));
        })
        .catch(() => setLoadError(true));
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      return undefined;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api.get('/patients/', { params: { search: term, active: 'true' } })
        .then(({ data }) => {
          if (!stale) setResults(data);
        })
        .catch(() => {
          if (!stale) setLoadError(true);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search]);

  const dischargePatient = async () => {
    setDischarging(true);
    setDischargeMessage('');
    const name = selectedPatient.full_name || selectedPatient.username;
    try {
      const { data: closed } = await api.post(`/patients/${selectedPatient.id}/discharge/`);
      // Quien recibe el alta sale de la lista de seguimiento.
      const { data } = await api.get('/patients/');
      setRoster(data);
      setResults((current) => current?.filter((item) => item.id !== selectedPatient.id) ?? current);
      setSelectedPatient(data[0] ?? null);
      const plans = closed?.plans_closed;
      setDischargeMessage(
        `Alta registrada para ${name}${plans > 1 ? `: se cerraron sus ${plans} tratamientos` : ''}. La encontrarás en Historial y Altas.`,
      );
    } catch (error) {
      setDischargeMessage(error.response?.data?.detail || 'No se pudo registrar el alta.');
    } finally {
      setDischarging(false);
      setConfirmDischarge(false);
    }
  };

  const found = search.trim() && results ? results : roster;
  const patients = specialty ? found.filter((patient) => patient.specialty === specialty) : found;
  // Especialidades presentes en la lista, con cuántos pacientes tiene cada una.
  const specialties = [...roster.reduce((map, patient) => (
    patient.specialty ? map.set(patient.specialty, [patient.specialty_label, (map.get(patient.specialty)?.[1] ?? 0) + 1]) : map
  ), new Map()).entries()];

  if (loading) {
    return (
      <DoctorLayout title="Monitoreo" subtitle="Seguimiento de tratamientos odontológicos">
        <Loading label="Cargando expedientes clínicos..." className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          <SkeletonRows rows={5} />
          <div className="space-y-6">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={6} />
          </div>
        </Loading>
      </DoctorLayout>
    );
  }

  const highRiskCount = roster.filter((patient) => patient.risk_level === 'Alto').length;

  return (
    <DoctorLayout
      title="Monitoreo"
      subtitle="Triaje con PLN y seguimiento de tratamientos odontológicos"
    >
      {user && !user.email && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">No recibirás por correo las alertas rojas ni tu agenda del día: aún no registras tu correo.</span>
          <Link to="/mi-cuenta" className="font-bold underline">Añadirlo en Mi cuenta</Link>
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left column: Patients roster */}
        <section aria-label="Pacientes en seguimiento" className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
          <header className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <hgroup>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total en seguimiento</p>
              <h2 className="text-2xl font-black text-slate-900">{roster.length} {roster.length === 1 ? 'paciente' : 'pacientes'}</h2>
            </hgroup>
            {loadError ? (
              <span role="alert" className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-extrabold text-amber-800">
                Sin conexión
              </span>
            ) : highRiskCount > 0 ? (
              <span className="flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-extrabold text-rose-700">
                <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-rose-600 motion-reduce:animate-none" />
                {highRiskCount} {highRiskCount === 1 ? 'alerta crítica' : 'alertas críticas'}
              </span>
            ) : roster.length > 0 && (
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                Sin alertas
              </span>
            )}
          </header>

          {loadError && (
            <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              No se pudo cargar la información de pacientes. Lo que ves puede estar desactualizado; revisa la conexión o recarga la página.
            </p>
          )}

          {/* Search bar */}
          <form role="search" onSubmit={(event) => event.preventDefault()} className="relative">
            <label htmlFor="roster-search" className="sr-only">Buscar entre tus pacientes en tratamiento</label>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <IconSearch className="h-4 w-4" />
            </span>
            <input
              id="roster-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tus pacientes o cédula exacta..."
              autoComplete="off"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </form>

          {specialties.length > 1 && (
            <div role="group" aria-label="Filtrar por especialidad" className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={!specialty} onClick={() => setSpecialty('')} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${!specialty ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                Todas
              </button>
              {specialties.map(([value, [label, count]]) => (
                <button key={value} type="button" aria-pressed={specialty === value} onClick={() => setSpecialty(specialty === value ? '' : value)} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${specialty === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                  {label} ({count})
                </button>
              ))}
            </div>
          )}

          {/* Patient Cards List */}
          {/* content-visibility: el navegador no pinta las tarjetas que quedan fuera de la vista. */}
          <ul aria-label="Lista de pacientes" className="space-y-3">
            {patients.map((patient) => (
              <li key={patient.id} className="[contain-intrinsic-size:auto_7rem] [content-visibility:auto]">
                <PatientCard
                  patient={patient}
                  selected={selectedPatient?.id === patient.id}
                  onSelect={() => setSelectedPatient(patient)}
                />
              </li>
            ))}
          </ul>

          {!patients.length && !loadError && (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
              {search.trim() ? 'No se encontraron pacientes en tratamiento que coincidan con la búsqueda.' : (
                <>
                  No tienes pacientes en tratamiento activo.{' '}
                  <Link to="/panel-doctor/consulta-medica" className="font-bold text-blue-700 hover:underline">Registrar una consulta</Link>
                </>
              )}
            </p>
          )}
        </section>

        {/* Right column: Selected Patient Clinical Dossier */}
        <section aria-label="Expediente del paciente seleccionado" className="min-w-0 space-y-6">
          {dischargeMessage && (
            <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">{dischargeMessage}</p>
          )}
          {selectedPatient ? (
            <>
              {/* Patient header card */}
              <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black text-slate-900 sm:text-2xl [overflow-wrap:anywhere]">
                      {selectedPatient.full_name || selectedPatient.username}
                    </h2>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                      HC-{String(selectedPatient.id).padStart(5, '0')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    C.I. {selectedPatient.national_id || 'Sin documento registrado'}
                    {selectedPatient.age ? ` · ${selectedPatient.age} años` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      selectedPatient.has_active_treatment
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {selectedPatient.has_active_treatment ? 'Tratamiento activo' : 'Sin tratamiento'}
                  </span>
                  <IconButton to={`/panel-doctor/pacientes/${selectedPatient.id}/historia`} icon={IconHistory} label="Historia clínica" tone="primary" />
                  {selectedPatient.has_active_treatment && (
                    <IconButton icon={IconCheckCircle} label="Dar de alta" tone="success" busy={discharging} disabled={discharging} onClick={() => setConfirmDischarge(true)} />
                  )}
                </div>
              </header>

              {/* High Risk Alert Banner */}
              {selectedPatient.risk_level === 'Alto' && (
                <section role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50/90 p-4 shadow-sm sm:p-5">
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white">
                    <IconAlertTriangle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <header className="flex items-center justify-between gap-2">
                      <h3 className="font-black text-rose-900">Alerta Clínica: Riesgo Alto Detectado</h3>
                      <span className="rounded bg-rose-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
                        Triaje Urgente
                      </span>
                    </header>
                    <p className="mt-1 text-xs leading-relaxed text-rose-800">
                      El último reporte del paciente es de nivel rojo. Revisa el motivo en sus reportes recientes y
                      valora la atención directa.
                    </p>
                  </div>
                </section>
              )}

              {/* Resumen redactado por la IA (o por el sistema) a partir de la evolución */}
              <AISummaryCard key={`summary-${selectedPatient.id}`} patientId={selectedPatient.id} />

              {/* Evolución histórica (RF03 CA02) */}
              <Suspense fallback={<p className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500">Cargando gráfica...</p>}>
                <EvolutionChart key={selectedPatient.id} patientId={selectedPatient.id} />
              </Suspense>

              {/* Tratamientos: historial unificado y edición de los vigentes */}
              <PatientTreatments key={`treatments-${selectedPatient.id}`} patientId={selectedPatient.id} />

            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
              <IconClipboard className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-bold text-slate-700">Ningún paciente seleccionado</p>
              <p className="mt-1 text-xs text-slate-500">Selecciona un paciente del listado para inspeccionar su evolución y tratamientos.</p>
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={confirmDischarge && Boolean(selectedPatient)}
        title={`¿Dar de alta a ${selectedPatient?.full_name || selectedPatient?.username || 'este paciente'}?`}
        confirmLabel="Dar de alta"
        icon={IconCheckCircle}
        tone="primary"
        busy={discharging}
        onConfirm={dischargePatient}
        onCancel={() => setConfirmDischarge(false)}
      >
        Se cerrarán sus recetas y tratamientos activos y saldrá de Monitoreo. Seguirá viendo sus tratamientos
        anteriores en su portal y podrá pedir una cita desde el asistente. Lo encontrarás en Historial y Altas.
      </ConfirmDialog>
    </DoctorLayout>
  );
}
