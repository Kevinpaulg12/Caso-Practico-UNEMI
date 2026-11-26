import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IconArrowRight, IconClipboard, IconHeartPulse, IconShield, IconSparkles, IconTooth, IconUser } from '../components/Icons';

const FEATURES = [
  {
    icon: IconHeartPulse,
    tone: 'bg-blue-50 text-blue-600',
    title: 'Evaluación Guiada de Síntomas',
    text: 'Registro diario asistido por IA de dolor EVA, inflamación y signos de evolución para prevenir complicaciones.',
  },
  {
    icon: IconClipboard,
    tone: 'bg-emerald-50 text-emerald-600',
    title: 'Plan Farmacológico y Cuidados',
    text: 'Indicaciones médicas claras, horarios de medicación analgésica y pautas higiénicas personalizadas por tu odontólogo.',
  },
  {
    icon: IconShield,
    tone: 'bg-indigo-50 text-indigo-600',
    title: 'Triaje y Alertas Oportunas',
    text: 'Detección temprana de signos de alarma (trismo severo, hemorragia, infección) visibles como alerta para el equipo clínico.',
    wide: true,
  },
];

export default function Home() {
  const { isAuthenticated, role, loading } = useAuth();

  if (loading) {
    return (
      <p role="status" className="flex min-h-screen items-center justify-center bg-[#f7f9fe] text-sm text-slate-500">
        Iniciando DentalSense AI...
      </p>
    );
  }

  if (isAuthenticated) {
    const currentRole = role || localStorage.getItem('user_role');
    if (currentRole === 'DOC') return <Navigate to="/panel-doctor/monitoreo" replace />;
    if (currentRole === 'ADM') return <Navigate to="/panel-admin" replace />;
    return <Navigate to="/panel-paciente" replace />;
  }

  return (
    <div className="min-h-screen bg-[#f7f9fe] text-[#12233d]">
      <header className="border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur sm:px-8">
        <nav aria-label="Principal" className="mx-auto flex max-w-7xl items-center justify-between">
          <p className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
              <IconTooth className="h-5 w-5" />
            </span>
            <span>
              <span className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-tight text-slate-900">DentalSense</span>
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-extrabold text-blue-700">AI</span>
              </span>
              <span className="block text-[10px] font-medium text-slate-500">Seguimiento odontológico inteligente</span>
            </span>
          </p>
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            <IconUser className="h-3.5 w-3.5 shrink-0" />Iniciar sesión
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-8 sm:py-20">
        <section className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/80 px-3.5 py-1.5 text-xs font-semibold text-blue-700 shadow-sm">
            <IconSparkles className="h-4 w-4" />
            Seguimiento odontológico asistido por PLN e IA
          </p>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl sm:leading-tight">
            Seguimiento continuo de tu tratamiento odontológico
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
            Plataforma para el seguimiento de tratamientos odontológicos (cirugía, endodoncia, ortodoncia, periodoncia, implantes, prótesis y más):
            triaje de síntomas, curvas de dolor EVA y comunicación directa con el especialista.
          </p>
          <Link
            to="/login"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-700 active:scale-95"
          >
            Acceder al portal<IconArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </section>

        <section aria-label="Qué ofrece la plataforma" className="mt-16">
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, tone, title, text, wide }) => (
              <li key={title} className={wide ? 'sm:col-span-2 lg:col-span-1' : undefined}>
                <article className="h-full rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:shadow-md">
                  <span aria-hidden="true" className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <h2 className="mt-4 text-base font-bold text-slate-800">{title}</h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">{text}</p>
                </article>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto max-w-7xl border-t border-slate-200/60 px-4 pb-10 pt-6 text-center text-xs text-slate-500 sm:px-8">
        <p>DentalSense AI · Seguimiento de tratamientos odontológicos con procesamiento de lenguaje natural e IA.</p>
        <p className="mt-1 text-[11px] text-slate-500">Protección de datos de salud conforme a la LOPDP del Ecuador.</p>
      </footer>
    </div>
  );
}
