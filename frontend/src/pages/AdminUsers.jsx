import { useCallback, useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import { IconSearch } from '../components/Icons';
import api from '../services/api';

const emptyForm = { username: '', first_name: '', last_name: '', email: '', role: 'DOC' };

function errorText(error, fallback) {
  const data = error.response?.data;
  if (!data || typeof data !== 'object') return fallback;
  return Object.values(data).flat().join(' ') || fallback;
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [credentials, setCredentials] = useState(null);

  const load = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([
        api.get('/admin/users/', { params: { search: search.trim() || undefined, page } }),
        api.get('/admin/users/summary/'),
      ]);
      setUsers(list.data.results);
      setCount(list.data.count);
      setHasNext(Boolean(list.data.next));
      setSummary(totals.data);
      setError('');
    } catch {
      setError('No se pudieron cargar los usuarios.');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const createUser = async (event) => {
    event.preventDefault();
    try {
      const { data } = await api.post('/admin/users/', form);
      setCredentials({ username: data.username, password: data.temporary_password });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (requestError) {
      setError(errorText(requestError, 'No se pudo crear el usuario.'));
    }
  };

  const toggleActive = async (user) => {
    try {
      await api.patch(`/admin/users/${user.id}/`, { is_active: !user.is_active });
      load();
    } catch (requestError) {
      setError(errorText(requestError, 'No se pudo actualizar el usuario.'));
    }
  };

  const update = ({ target }) => setForm((current) => ({ ...current, [target.name]: target.value }));

  return (
    <AdminLayout
      title="Usuarios y roles"
      subtitle="Cuentas registradas en el sistema. Los pacientes se crean desde una consulta."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Usuarios activos" value={summary?.active_users} />
        <Metric title="Pacientes activos" value={summary?.patients} />
        <Metric title="Profesionales" value={summary && summary.doctors + summary.admins} detail={summary && `${summary.doctors} doctores · ${summary.admins} administradores`} />
        <Metric title="Eventos auditados" value={summary?.audit_events} />
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

      {credentials && (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="font-bold">Credenciales temporales: se muestran una sola vez.</p>
          <p className="mt-1 font-mono [overflow-wrap:anywhere]">{credentials.username} / {credentials.password}</p>
          <button type="button" onClick={() => setCredentials(null)} className="mt-2 font-bold underline">Ocultar</button>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <IconSearch className="h-4 w-4" />
            </span>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Buscar por nombre, correo o C.I..."
              aria-label="Buscar usuarios"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-9 pr-3 text-xs text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            + Nuevo usuario
          </button>
        </div>

        {showForm && (
          <form onSubmit={createUser} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Usuario" name="username" value={form.username} onChange={update} required />
            <Field label="Nombres" name="first_name" value={form.first_name} onChange={update} required />
            <Field label="Apellidos" name="last_name" value={form.last_name} onChange={update} required />
            <Field label="Correo" name="email" type="email" value={form.email} onChange={update} />
            <label className="text-xs font-bold text-slate-700">
              Rol
              <select name="role" value={form.role} onChange={update} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-normal">
                <option value="DOC">Doctor</option>
                <option value="ADM">Administrador</option>
              </select>
            </label>
            <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white sm:col-span-2 lg:col-span-5">Crear cuenta</button>
          </form>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-xs">
            <thead className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="p-3">Usuario e identidad</th>
                <th scope="col" className="p-3">Rol</th>
                <th scope="col" className="p-3">Estado</th>
                <th scope="col" className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                  <td className="p-3">
                    <strong className="block text-slate-800">{user.full_name || user.username}</strong>
                    <span className="text-[11px] text-slate-400">{user.email || (user.national_id ? `C.I. ${user.national_id}` : `@${user.username}`)}</span>
                  </td>
                  <td className="p-3">
                    <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">{user.role_label}</span>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${user.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                      {user.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button type="button" onClick={() => toggleActive(user)} className="font-semibold text-blue-600 hover:text-blue-800 hover:underline">
                      {user.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
              {!users.length && !loading && (
                <tr><td colSpan="4" className="p-6 text-center text-slate-500">No hay usuarios que coincidan.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{count} {count === 1 ? 'usuario' : 'usuarios'}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={!hasNext} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">Siguiente</button>
          </div>
        </div>
      </section>
    </AdminLayout>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="text-xs font-bold text-slate-700">
      {label}
      <input {...props} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-normal outline-none focus:border-blue-500" />
    </label>
  );
}

function Metric({ title, value, detail }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value ?? '—'}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </article>
  );
}
