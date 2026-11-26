import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccountMenu from './AccountMenu';
import { IconTooth } from './Icons';

const ACCENTS = {
  blue: { logo: 'bg-blue-600 hover:bg-blue-700', badge: 'bg-blue-100 text-blue-700', active: 'bg-blue-600 text-white shadow-sm shadow-blue-500/20' },
  slate: { logo: 'bg-slate-800 hover:bg-slate-900', badge: 'bg-slate-100 text-slate-700', active: 'bg-slate-900 text-white shadow-sm' },
};

/**
 * Estructura común de los tres portales (paciente, odontólogo y administrador):
 * cabecera con la cuenta, menú lateral en escritorio y selector de módulo en móvil.
 *
 * navigation: [{ path, label, icon, badge? }]; `current` es el path de la sección abierta.
 * banner: franja fija bajo la cabecera (p. ej. el aviso de urgencias); floating: elemento fijo en pantalla.
 */
export default function PanelLayout({
  home, badge, tagline, area, menuLabel, accent = 'blue',
  navigation, current, fallbackName, fallbackTitle,
  title, subtitle, headerExtra, banner, floating, children,
}) {
  const navigate = useNavigate();
  // El perfil ya lo cargó la sesión: el layout no vuelve a pedirlo en cada pantalla.
  const { user } = useAuth() ?? {};
  const colors = ACCENTS[accent];
  const displayName = user?.full_name || user?.username || fallbackName;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-xs focus:font-bold focus:text-blue-700 focus:shadow">
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-40 print:hidden border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <Link to={home} aria-label="DentalSense, ir al inicio del panel" className="group flex items-center gap-3">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm transition ${colors.logo}`}>
              <IconTooth className="h-5 w-5" />
            </span>
            <span>
              <span className="flex items-center gap-1.5">
                <span className="font-bold text-slate-900 transition-colors group-hover:text-blue-600">DentalSense</span>
                <span className={`rounded px-1 text-[9px] font-extrabold ${colors.badge}`}>{badge}</span>
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-500">{tagline}</span>
            </span>
          </Link>

          {title && (
            <p className="hidden text-center text-xs text-slate-500 md:block">
              {area} <span aria-hidden="true" className="mx-2 text-slate-300">›</span> <strong className="text-slate-800">{title}</strong>
            </p>
          )}

          <div className="flex items-center gap-2">
            {headerExtra}
            <AccountMenu user={user || { username: fallbackName, professional_title: fallbackTitle }} />
          </div>
        </div>
        {banner}
      </header>
      {floating}

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 lg:grid-cols-[230px_1fr]">
        <aside className="hidden print:!hidden min-h-[calc(100dvh-60px)] flex-col border-r border-slate-200 bg-white p-4 lg:flex">
          <nav aria-label={menuLabel}>
            <h2 className="mb-3 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{menuLabel}</h2>
            <ul className="space-y-1">
              {navigation.map(({ path, label, icon: Icon, badge: count }) => {
                const isActive = current === path;
                return (
                  <li key={path}>
                    <Link
                      to={path}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-200 ease-out ${
                        isActive ? colors.active : 'text-slate-600 hover:translate-x-0.5 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {count ? (
                        <span className={`rounded-full px-1.5 text-[10px] ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <footer className="mt-auto border-t border-slate-100 px-2 pt-4 text-xs">
            <p className="truncate font-bold text-slate-800">{displayName}</p>
            <p className="truncate text-[11px] text-slate-500">{user?.professional_title || fallbackTitle}</p>
          </footer>
        </aside>

        <main id="contenido" className="min-w-0 p-4 sm:p-6 lg:p-8">
          <nav aria-label={`${menuLabel} (móvil)`} className="mb-5 lg:hidden print:hidden">
            <label htmlFor="panel-navigation" className="sr-only">Ir a la sección</label>
            <select
              id="panel-navigation"
              value={current ?? ''}
              onChange={(event) => navigate(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm outline-none focus:border-blue-500"
            >
              {!navigation.some((item) => item.path === current) && <option value="" disabled>Ir a…</option>}
              {navigation.map((item) => (
                <option key={item.path} value={item.path}>{item.label}</option>
              ))}
            </select>
          </nav>

          <div className="mx-auto max-w-[1240px]">
            {title && (
              <header className="ds-enter mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
                {subtitle && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{subtitle}</p>}
              </header>
            )}
            {/* Cada bloque de la pantalla entra con el mismo movimiento que el menú de la cuenta. */}
            <div className="ds-stagger">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
