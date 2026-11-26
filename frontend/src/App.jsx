import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import Loading, { SkeletonCard } from './components/Skeleton';
import Home from './pages/Home';
import Login from './pages/Login';
import { IconArrowLeft, IconTooth } from './components/Icons';

// Cada pantalla se descarga solo cuando se visita: quien entra como paciente no baja el panel del
// odontólogo ni el del administrador. Inicio y Login van en el paquete inicial para pintar de inmediato.
const Prescriptions = lazy(() => import('./pages/Prescriptions'));
const DoctorDashboard = lazy(() => import('./pages/DoctorDashboard'));
const NewConsultation = lazy(() => import('./pages/NewConsultation'));
const TreatmentHistory = lazy(() => import('./pages/TreatmentHistory'));
const ClinicalHistory = lazy(() => import('./pages/ClinicalHistory'));
const DoctorSchedule = lazy(() => import('./pages/DoctorSchedule'));
const AdminAI = lazy(() => import('./pages/AdminAI'));
const Discharges = lazy(() => import('./pages/Discharges'));
const Reports = lazy(() => import('./pages/Reports'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const ClinicalCatalog = lazy(() => import('./pages/ClinicalCatalog'));
const AlertRules = lazy(() => import('./pages/AlertRules'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Account = lazy(() => import('./pages/Account'));
const Consent = lazy(() => import('./pages/Consent'));

function PageLoading() {
  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-8">
      <Loading label="Cargando la página..." className="mx-auto max-w-5xl space-y-5">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={6} />
      </Loading>
    </main>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f7f9fe] p-6 text-center">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <IconTooth className="mx-auto h-10 w-10 text-blue-600" />
        <h1 className="mt-4 text-2xl font-bold text-slate-800">404 - Página no encontrada</h1>
        <p className="mt-2 text-sm text-slate-500">La ruta solicitada no existe o fue movida.</p>
        <Link to="/" className="inline-flex items-center gap-1.5 mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
          <IconArrowLeft className="h-3.5 w-3.5 shrink-0" />Volver al inicio
        </Link>
      </section>
    </main>
  );
}

const doctor = (page) => <RoleRoute role="DOC">{page}</RoleRoute>;
const admin = (page) => <RoleRoute role="ADM">{page}</RoleRoute>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/consentimiento" element={<Consent />} />
            <Route path="/mi-cuenta" element={<ProtectedRoute><Account /></ProtectedRoute>} />

            {/* Paciente */}
            <Route path="/panel-paciente" element={<RoleRoute role="PAT"><Prescriptions /></RoleRoute>} />

            {/* Odontólogo */}
            {/* «Pacientes activos» pasó a llamarse Monitoreo; la ruta antigua lleva a la nueva. */}
            <Route path="/panel-doctor" element={<Navigate to="/panel-doctor/monitoreo" replace />} />
            <Route path="/panel-doctor/monitoreo" element={doctor(<DoctorDashboard />)} />
            <Route path="/panel-doctor/consulta-medica" element={doctor(<NewConsultation />)} />
            {/* El registro de pacientes vive ahora dentro de Consulta médica. */}
            <Route path="/panel-doctor/nueva-consulta" element={<Navigate to="/panel-doctor/consulta-medica" replace />} />
            <Route path="/panel-doctor/nuevo-paciente" element={<Navigate to="/panel-doctor/consulta-medica?registro=1" replace />} />
            <Route path="/panel-doctor/tratamientos/:planId" element={doctor(<TreatmentHistory />)} />
            <Route path="/panel-doctor/pacientes/:patientId/historia" element={doctor(<ClinicalHistory />)} />
            {/* La agenda antigua es ahora «Mi horario»: el paciente reserva los turnos libres en el chat. */}
            <Route path="/panel-doctor/agenda" element={<Navigate to="/panel-doctor/horario" replace />} />
            <Route path="/panel-doctor/historial" element={doctor(<Discharges />)} />
            <Route path="/panel-doctor/horario" element={doctor(<DoctorSchedule />)} />
            <Route path="/panel-doctor/informes" element={doctor(<Reports />)} />

            {/* Administrador */}
            <Route path="/panel-admin" element={admin(<AdminUsers />)} />
            <Route path="/panel-admin/catalogo" element={admin(<ClinicalCatalog />)} />
            <Route path="/panel-admin/reglas" element={admin(<AlertRules />)} />
            <Route path="/panel-admin/ia" element={admin(<AdminAI />)} />
            <Route path="/panel-admin/auditoria" element={admin(<AuditLog />)} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
