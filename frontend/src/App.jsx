import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import FeatureRoute from './components/FeatureRoute';
import Loading, { SkeletonCard } from './components/Skeleton';
import Home from './pages/Home';
import Login from './pages/Login';

// Cada pantalla se descarga solo cuando se visita: quien entra como paciente no baja el panel del
// odontólogo ni el del administrador. Inicio y Login van en el paquete inicial para pintar de inmediato.
const Prescriptions = lazy(() => import('./pages/Prescriptions'));
const DoctorDashboard = lazy(() => import('./pages/DoctorDashboard'));
const NewConsultation = lazy(() => import('./pages/NewConsultation'));
const TreatmentHistory = lazy(() => import('./pages/TreatmentHistory'));
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
        <span aria-hidden="true" className="text-4xl">🦷</span>
        <h1 className="mt-4 text-2xl font-bold text-slate-800">404 - Página no encontrada</h1>
        <p className="mt-2 text-sm text-slate-500">La ruta solicitada no existe o fue movida.</p>
        <Link to="/" className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
          Volver al inicio
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
            <Route path="/panel-doctor" element={doctor(<DoctorDashboard />)} />
            <Route path="/panel-doctor/consulta-medica" element={doctor(<NewConsultation />)} />
            {/* El registro de pacientes vive ahora dentro de Consulta médica. */}
            <Route path="/panel-doctor/nueva-consulta" element={<Navigate to="/panel-doctor/consulta-medica" replace />} />
            <Route path="/panel-doctor/nuevo-paciente" element={<Navigate to="/panel-doctor/consulta-medica?registro=1" replace />} />
            <Route path="/panel-doctor/tratamientos/:planId" element={doctor(<TreatmentHistory />)} />
            {/* La agenda se retiró: los controles se registran desde la consulta y el historial. */}
            <Route path="/panel-doctor/agenda" element={<Navigate to="/panel-doctor" replace />} />
            <Route path="/panel-doctor/historial" element={doctor(<Discharges />)} />
            {/* Característica opcional de la línea de productos (ENABLE_REPORTS). */}
            <Route path="/panel-doctor/informes" element={doctor(<FeatureRoute feature="reports" fallback="/panel-doctor"><Reports /></FeatureRoute>)} />

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
