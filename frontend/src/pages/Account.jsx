import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import AdminLayout from '../components/AdminLayout';
import DoctorLayout from '../components/DoctorLayout';
import PatientLayout from '../components/PatientLayout';
import Loading, { SkeletonCard } from '../components/Skeleton';
import { IconUser, IconLock, IconCheckCircle, IconAlertTriangle } from '../components/Icons';

const LAYOUTS = { DOC: DoctorLayout, ADM: AdminLayout };
const HOME_PATHS = { DOC: '/panel-doctor', ADM: '/panel-admin' };
const INPUT = 'mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-xs font-normal text-slate-900 outline-none focus:border-blue-500 focus:bg-white';

// La etiqueta envuelve al campo: quedan asociados sin depender de identificadores.
function Field({ label, ...input }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <input {...input} className={INPUT} />
    </label>
  );
}

const initialPassword = { current_password: '', new_password: '', confirm_password: '' };

export default function Account() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { logout, updateUser, role: sessionRole } = useAuth();
  const [account, setAccount] = useState(null);
  const firstLogin = searchParams.get('firstLogin') === '1';
  const activeTab = searchParams.get('section') === 'security' || firstLogin ? 'security' : 'profile';
  const [form, setForm] = useState({});
  const [password, setPassword] = useState(initialPassword);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/account/').then(({ data }) => {
      setAccount(data);
      setForm({
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.email || '',
        phone: data.phone || '',
        emergency_contact: data.emergency_contact || '',
        birth_date: data.birth_date || '',
      });
    }).catch(() => setError('No pudimos cargar tu información de perfil.'));
  }, []);

  const updateForm = ({ target }) => {
    const value = ['phone', 'emergency_contact'].includes(target.name)
      ? target.value.replace(/\D/g, '')
      : target.value;
    setForm((current) => ({ ...current, [target.name]: value }));
  };
  const updatePassword = ({ target }) => setPassword((current) => ({ ...current, [target.name]: target.value }));

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const { data } = await api.patch('/account/', { ...form, birth_date: form.birth_date || null });
      setAccount(data);
      // El nombre del menú y de la cabecera se actualiza sin volver a pedir el perfil.
      if (data.full_name) updateUser?.({ full_name: data.full_name });
      setMessage('Tus datos se actualizaron correctamente.');
      setTimeout(() => setMessage(''), 4000);
    } catch (requestError) {
      setError(Object.values(requestError.response?.data || {}).flat().join(' ') || 'No pudimos guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (password.new_password !== password.confirm_password) {
      setError('Las nuevas contraseñas no coinciden.');
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');
    try {
      await api.post('/account/password/', password);
      setMessage('Contraseña actualizada con éxito. Por seguridad, la sesión se reiniciará.');
      setPassword(initialPassword);
      setTimeout(logout, 1500);
    } catch (requestError) {
      setError(Object.values(requestError.response?.data || {}).flat().join(' ') || 'No pudimos actualizar la contraseña.');
    } finally {
      setSaving(false);
    }
  };

  // El mismo menú lateral del rol: la cuenta se abre sin salir del panel.
  const role = account?.role || sessionRole || localStorage.getItem('user_role');
  const Layout = LAYOUTS[role] ?? PatientLayout;
  const homePath = HOME_PATHS[role] ?? '/panel-paciente';
  const page = {
    title: 'Configuración de Cuenta',
    subtitle: 'Administra tu información personal y los métodos de acceso seguro.',
  };

  if (!account && error) return (
    <Layout {...page}>
      <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
    </Layout>
  );

  if (!account) return (
    <Layout {...page}>
      <Loading label="Cargando tu cuenta..." className="mx-auto max-w-[1000px]">
        <SkeletonCard lines={6} />
      </Loading>
    </Layout>
  );

  const tabClass = (active, disabled) => `flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
    active ? 'border-blue-600 text-blue-700' : `border-transparent text-slate-500 ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:text-slate-800'}`
  }`;

  return (
    <Layout {...page}>
      <div className="mx-auto max-w-[1000px]">
        <nav aria-label="Secciones de la cuenta" className="mb-6 flex flex-wrap items-end justify-between gap-2 border-b border-slate-200">
          <ul className="flex gap-2">
            <li>
              <button
                type="button"
                aria-current={activeTab === 'profile' ? 'page' : undefined}
                onClick={() => { if (!firstLogin) setSearchParams({}); }}
                disabled={firstLogin}
                className={tabClass(activeTab === 'profile', firstLogin)}
              >
                <IconUser className="h-4 w-4" />
                Información del perfil
              </button>
            </li>
            <li>
              <button
                type="button"
                aria-current={activeTab === 'security' ? 'page' : undefined}
                onClick={() => setSearchParams({ section: 'security' })}
                className={tabClass(activeTab === 'security', false)}
              >
                <IconLock className="h-4 w-4" />
                Seguridad y contraseña
              </button>
            </li>
          </ul>
          {!firstLogin && (
            <Link to={homePath} className="mb-1.5 hidden rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:inline-block">
              ← Volver al panel
            </Link>
          )}
        </nav>

        {error && (
          <p role="alert" className="mb-5 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="mb-5 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-700">
            <IconCheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
            {message}
          </p>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {activeTab === 'profile' ? (
            <form onSubmit={saveProfile} className="space-y-5">
              <header>
                <h2 className="text-base font-bold text-slate-900">Datos Personales</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  El usuario del sistema y el documento de identidad están regulados por el protocolo clínico.
                </p>
              </header>

              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="sr-only">Datos personales</legend>
                <Field label="Nombres" name="first_name" value={form.first_name || ''} onChange={updateForm} required autoComplete="given-name" />
                <Field label="Apellidos" name="last_name" value={form.last_name || ''} onChange={updateForm} required autoComplete="family-name" />
                <Field label="Correo electrónico" type="email" name="email" value={form.email || ''} onChange={updateForm} autoComplete="email" />
                <Field label="Teléfono principal" type="tel" name="phone" value={form.phone || ''} onChange={updateForm} inputMode="numeric" pattern="[0-9]*" autoComplete="tel" />
                <Field label="Contacto de emergencia" type="tel" name="emergency_contact" value={form.emergency_contact || ''} onChange={updateForm} inputMode="numeric" pattern="[0-9]*" />
                <Field label="Fecha de nacimiento" type="date" name="birth_date" value={form.birth_date || ''} onChange={updateForm} autoComplete="bday" />
              </fieldset>

              <p className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={changePassword} className="max-w-lg space-y-4">
              <header>
                <h2 className="text-base font-bold text-slate-900">Actualizar Contraseña</h2>
                {firstLogin && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">Por seguridad, debes cambiar tu contraseña temporal antes de continuar.</p>}
                <p className="mt-0.5 text-xs text-slate-500">
                  Utiliza al menos 8 caracteres con una combinación segura de letras y números.
                </p>
              </header>

              {/* El gestor de contraseñas necesita saber a qué usuario pertenece la clave. */}
              <input type="hidden" name="username" autoComplete="username" value={account.username || ''} readOnly />
              <Field label="Contraseña actual" type="password" name="current_password" value={password.current_password} onChange={updatePassword} required autoComplete="current-password" />
              <Field label="Nueva contraseña" type="password" name="new_password" value={password.new_password} onChange={updatePassword} required minLength={8} autoComplete="new-password" />
              <Field label="Confirmar nueva contraseña" type="password" name="confirm_password" value={password.confirm_password} onChange={updatePassword} required minLength={8} autoComplete="new-password" />

              <button
                type="submit"
                disabled={saving}
                className="mt-2 rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Actualizando...' : 'Actualizar contraseña'}
              </button>
            </form>
          )}
        </section>
      </div>
    </Layout>
  );
}
