import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { initials, rememberedProfile } from '../services/session';
import { IconTooth, IconUser, IconLock, IconEye, IconEyeOff, IconAlertTriangle, IconClipboard, IconSparkles } from '../components/Icons';

const features = [
  {
    title: 'Seguimiento conversacional',
    description: 'Un asistente con inteligencia artificial te pregunta cómo te sientes y entiende tus síntomas en tus propias palabras.',
    icon: 'chat',
  },
  {
    title: 'Alertas oportunas para tu odontólogo',
    description: 'Detección de signos de alarma que aparecen como alerta en el panel de tu especialista.',
    icon: 'alert',
  },
  {
    title: 'Cuidados y medicación en un solo lugar',
    description: 'Tus indicaciones explicadas en lenguaje sencillo, tu checklist diario y tus próximas citas.',
    icon: 'clipboard',
  },
];

function FeatureIcon({ type }) {
  if (type === 'alert') {
    return <IconAlertTriangle className="h-4 w-4" />;
  }

  if (type === 'clipboard') {
    return <IconClipboard className="h-4 w-4" />;
  }

  return <IconSparkles className="h-4 w-4" />;
}

const ROLE_LABELS = { PAT: 'Paciente', DOC: 'Odontólogo', ADM: 'Administrador' };

const LOGOUT_MESSAGES = {
  inactividad: 'Tu sesión se cerró tras 5 minutos de inactividad para proteger tu información. Inicia sesión nuevamente.',
  terminos: 'Para usar el portal necesitas aceptar los Términos y Condiciones y el uso de tus datos. Puedes hacerlo la próxima vez que ingreses.',
};

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [logoutReason] = useState(() => {
    const reason = sessionStorage.getItem('logout_reason');
    sessionStorage.removeItem('logout_reason');
    if (new URLSearchParams(window.location.search).get('motivo') === 'inactividad') return 'inactividad';
    return LOGOUT_MESSAGES[reason] ? reason : null;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  // El último usuario que cerró sesión aquí solo necesita escribir su contraseña.
  const [profile] = useState(rememberedProfile);
  const [otherAccount, setOtherAccount] = useState(false);
  const usingProfile = Boolean(profile) && !otherAccount;
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);

  const switchAccount = (useOther) => {
    setOtherAccount(useOther);
    setForm({ username: '', password: '' });
    setError('');
    setShowPassword(false);
    // El foco va al primer campo que hay que escribir.
    setTimeout(() => (useOther ? usernameRef : passwordRef).current?.focus(), 0);
  };

  const handleChange = ({ target }) => {
    setForm((currentForm) => ({
      ...currentForm,
      [target.name]: target.value,
    }));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const username = usingProfile ? profile.username : form.username.trim();

    if (!username || !form.password) {
      setError(usingProfile ? 'Ingresa tu contraseña para continuar.' : 'Ingresa tu usuario y contraseña para continuar.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    const result = await login(username, form.password);

    if (!result.success) {
      setError(result.message);
    }

    setIsSubmitting(false);
  };

  return (
    <div className="min-h-[100svh] bg-[#f7f9fe] text-[#12233d]">
      <header className="flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/80 backdrop-blur px-5 shadow-sm sm:px-8">
        <p className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
            <IconTooth className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-bold tracking-tight text-slate-800">DentalSense</span>
              <span className="rounded bg-blue-100 px-1 text-[9px] font-extrabold text-blue-700">AI</span>
            </span>
            <span className="block text-[9px] font-medium tracking-wide text-slate-500">
              Seguimiento de tratamientos odontológicos
            </span>
          </span>
        </p>
      </header>

      <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-7xl items-center px-4 py-8 sm:px-10 sm:py-10 lg:px-12">
        <div className="grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <section className="lg:col-span-7">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <IconSparkles className="h-3.5 w-3.5" />
              Seguimiento de tu tratamiento dental
            </p>
            <h1 className="max-w-xl text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              Tu tratamiento dental acompañado día a día
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
              Ortodoncia, endodoncia, implantes, cirugía o cualquier tratamiento: tu odontólogo sigue tu
              evolución con ayuda del procesamiento de lenguaje natural y la inteligencia artificial.
            </p>
            <ul className="mt-6 space-y-3">
              {features.map((feature) => (
                <li key={feature.title} className="flex max-w-xl items-start gap-3 rounded-xl border border-slate-200/60 bg-white/60 p-3">
                  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <FeatureIcon type={feature.icon} />
                  </span>
                  <div className="text-xs leading-snug text-slate-600">
                    <h2 className="font-bold text-slate-800">{feature.title}</h2>
                    <p className="mt-0.5">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="login-title" className="w-full lg:col-span-5">
            <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-lg shadow-slate-100 sm:p-8">
              <header className="mb-6 text-center">
                <span aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600 shadow-sm">
                  <IconTooth className="h-6 w-6" />
                </span>
                <h2 id="login-title" className="text-lg font-bold text-slate-800">{usingProfile ? 'Hola de nuevo' : 'Bienvenido a tu recuperación'}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {usingProfile ? 'Escribe tu contraseña para continuar.' : 'Ingresa tus credenciales para acceder a tu plan clínico.'}
                </p>
              </header>

              {!error && logoutReason && (
                <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {LOGOUT_MESSAGES[logoutReason]}
                </p>
              )}

              {error && (
                <p role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>{error}</span>
                </p>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {usingProfile ? (
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="Cuenta recordada">
                    <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white">
                      {initials(profile.full_name || profile.username)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{profile.full_name || profile.username}</p>
                      <p className="truncate text-xs text-slate-500">
                        {ROLE_LABELS[profile.role] || 'Usuario'} · {profile.username}
                      </p>
                    </div>
                    {/* El gestor de contraseñas del navegador necesita el usuario aunque no se muestre. */}
                    <input type="hidden" name="username" autoComplete="username" value={profile.username} />
                  </div>
                ) : (
                <div>
                  <label htmlFor="username" className="mb-1.5 block text-xs font-bold text-slate-700">
                    Usuario o cédula
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                      <IconUser className="h-4 w-4" />
                    </span>
                    <input
                      ref={usernameRef}
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      value={form.username}
                      onChange={handleChange}
                      placeholder="Ej. 1723489102 o tu usuario"
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                  </div>
                </div>
                )}

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="password" className="text-xs font-bold text-slate-700">Contraseña</label>
                    <button type="button" onClick={() => setShowRecovery(true)} className="text-[11px] font-semibold text-blue-600 hover:underline">
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  {showRecovery && (
                    <p className="mb-2 rounded-lg border border-blue-100 bg-blue-50 p-2.5 text-[11px] text-blue-900">
                      Por seguridad, la contraseña se restablece en persona: contacta a tu clínica al 04 270 0000.
                    </p>
                  )}
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                      <IconLock className="h-4 w-4" />
                    </span>
                    <input
                      ref={passwordRef}
                      autoFocus={usingProfile}
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={form.password}
                      onChange={handleChange}
                      placeholder="Ingresa tu contraseña"
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-9 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-blue-600 transition-colors"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-md shadow-blue-500/20 transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Verificando...' : 'Iniciar sesión'}
                  {!isSubmitting && <span aria-hidden="true" className="text-base">→</span>}
                </button>
              </form>

              {profile && (
                <button
                  type="button"
                  onClick={() => switchAccount(usingProfile)}
                  disabled={isSubmitting}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {usingProfile
                    ? 'Iniciar sesión con otra cuenta'
                    : `Volver a ${(profile.full_name || profile.username).split(' ')[0]}`}
                </button>
              )}

              {!usingProfile && (
                <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-slate-600">
                  <strong className="text-blue-800">¿Primera vez?</strong> Usa el usuario y clave provistos por tu clínica.
                </p>
              )}

              <address className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-xs font-semibold not-italic text-rose-700">
                <span aria-hidden="true">☎ </span>¿Urgencia dental? Clínica San Jerónimo: <a href="tel:042700000" className="underline">04 270 0000</a>
              </address>

              <footer className="mt-4 text-center text-[10px] text-slate-500">
                Tus datos de salud se tratan conforme a la Ley Orgánica de Protección de Datos Personales (LOPDP) del Ecuador.
              </footer>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
