import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { homePath } from '../services/session';
import { IconAlertTriangle, IconArrowLeft, IconLock, IconLogout, IconTooth, IconX } from '../components/Icons';

// Texto base: la clínica debe revisarlo con su asesoría legal antes de usarlo con pacientes reales.
const SECTIONS = [
  ['1. Qué es DentalSense', 'DentalSense es una plataforma de seguimiento de tu recuperación durante tu tratamiento odontológico. Te permite consultar las indicaciones de tu odontólogo y reportar cómo te sientes cada día.'],
  ['2. Datos que tratamos', 'Datos de identificación y contacto (nombres, cédula, fecha de nacimiento, teléfono y contacto de emergencia) y datos de salud: el procedimiento realizado, tu medicación, el nivel de dolor que reportas, los síntomas que describes y los mensajes que escribes al asistente.'],
  ['3. Para qué los usamos', 'Únicamente para acompañar tu recuperación: mostrarte tus indicaciones, analizar tus reportes con un sistema automático que detecta signos de alarma y avisar a tu odontólogo cuando un reporte lo requiera. No se usan con fines comerciales ni se venden a terceros.'],
  ['4. Quién puede verlos', 'Tu odontólogo tratante y el equipo clínico autorizado. Para darte continuidad, cualquier odontólogo de la clínica que te atienda puede consultar tu historia clínica completa, incluidos los tratamientos que te hizo otro odontólogo; cada consulta queda registrada con su nombre y fecha. El administrador del sistema accede solo al registro de auditoría para fines de seguridad.'],
  ['5. Análisis automático', 'El análisis de tus mensajes orienta al equipo clínico, pero no reemplaza el criterio profesional ni constituye un diagnóstico. El nivel de alerta lo calculan reglas clínicas validadas por el equipo, dentro de los servidores de la clínica. Esta plataforma no es un canal de emergencias: si tienes una urgencia, llama a la clínica al 04 270 0000.'],
  ['6. Inteligencia artificial', 'Para conversar contigo, explicarte tus indicaciones en lenguaje sencillo y resumir tu evolución para tu odontólogo, la plataforma usa un modelo de inteligencia artificial de un proveedor externo (Google, modelo Gemini). Antes de enviarle información se eliminan tu nombre, tu cédula, tus teléfonos y las fechas exactas, incluida tu fecha de nacimiento: solo recibe tu edad en años, tu tratamiento y lo que describes de tus síntomas. Si este servicio no está disponible, la plataforma sigue funcionando sin él.'],
  ['7. Conservación y seguridad', 'Tus datos se conservan mientras dure tu seguimiento y el tiempo que exige la normativa de historia clínica. La sesión se cierra tras 5 minutos de inactividad y las contraseñas se guardan cifradas.'],
  ['8. Tus derechos', 'Conforme a la Ley Orgánica de Protección de Datos Personales del Ecuador puedes solicitar el acceso, la rectificación, la actualización, la eliminación o la portabilidad de tus datos, y oponerte a su tratamiento o revocar este consentimiento, comunicándote con la clínica. Revocarlo implica dejar de usar el portal.'],
];

export default function Consent() {
  const { isAuthenticated, user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const [version, setVersion] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptData, setAcceptData] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    api.get('/account/terms/')
      .then(({ data }) => setVersion(data.version))
      .catch(() => setLoadError('No se pudieron cargar los términos. Recarga la página para intentarlo de nuevo.'));
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Quien ya aceptó (o no es paciente) no tiene nada que hacer aquí.
  if (user && !user.must_accept_terms) return <Navigate to={homePath(user)} replace />;

  const answer = async (accepted) => {
    setSending(true);
    setError('');
    try {
      const { data } = await api.post('/account/terms/', { accepted, version });
      if (!accepted) {
        logout('terminos');
        return;
      }
      const changes = { must_accept_terms: false, must_change_password: data.must_change_password };
      updateUser(changes);
      navigate(homePath({ ...user, ...changes }), { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.version?.[0] || 'No se pudo registrar tu respuesta. Inténtalo nuevamente.');
      setSending(false);
    }
  };

  const ready = acceptTerms && acceptData && version && !sending;

  return (
    <div className="min-h-[100svh] bg-[#f7f9fe] px-4 py-6 text-slate-800 sm:py-10">
      <main className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
            <IconTooth className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Antes de empezar</p>
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Términos y Condiciones y uso de tus datos</h1>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {user?.full_name ? `${user.full_name}, para` : 'Para'} usar el portal necesitamos tu autorización. Léela con calma: puedes aceptarla o no.
        </p>

        <section
          tabIndex={0}
          aria-label="Texto de los términos y del uso de datos"
          className="mt-5 max-h-[45svh] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          {SECTIONS.map(([title, text]) => (
            <div key={title}>
              <h2 className="font-bold text-slate-900">{title}</h2>
              <p className="mt-1">{text}</p>
            </div>
          ))}
          {version && <p className="text-xs text-slate-500">Versión {version}</p>}
        </section>

        {loadError && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{loadError}</p>}

        <fieldset className="mt-5 min-w-0 space-y-3">
          <legend className="sr-only">Tu autorización</legend>
          <Check checked={acceptTerms} onChange={setAcceptTerms}>
            He leído y acepto los Términos y Condiciones de uso del portal.
          </Check>
          <Check checked={acceptData} onChange={setAcceptData}>
            Autorizo de forma expresa el tratamiento de mis datos de salud para el seguimiento de mi tratamiento, incluido su análisis anonimizado con inteligencia artificial, como se describe arriba.
          </Check>
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </p>
        )}

        {confirmDecline ? (
          <div role="alertdialog" aria-labelledby="decline-title" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p id="decline-title" className="font-bold">¿Seguro que no aceptas?</p>
            <p className="mt-1 text-xs">Sin tu autorización no podrás usar el portal: tu sesión se cerrará. Puedes volver a ingresar cuando quieras y aceptarlos entonces. Tu odontólogo seguirá atendiéndote en la clínica.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => answer(false)} disabled={sending || !version} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50">
                <IconLogout className="h-3.5 w-3.5 shrink-0" />No acepto, cerrar sesión
              </button>
              <button type="button" onClick={() => setConfirmDecline(false)} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">
                <IconArrowLeft className="h-3.5 w-3.5 shrink-0" />Volver a leer
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => setConfirmDecline(true)} disabled={sending} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              <IconX className="h-3.5 w-3.5 shrink-0" />No acepto
            </button>
            <button type="button" onClick={() => answer(true)} disabled={!ready} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              <IconLock className="h-4 w-4" />
              {sending ? 'Registrando...' : 'Aceptar y continuar'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600" />
      <span>{children}</span>
    </label>
  );
}
