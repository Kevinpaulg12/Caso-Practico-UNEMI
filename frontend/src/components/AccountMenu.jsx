import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IconChevronDown, IconUser, IconLock, IconLogout } from './Icons';

function firstCharacter(word) {
  const [first] = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
  return first?.segment ?? '';
}

function getInitials(name) {
  const words = name.trim().split(/\s+/);
  const last = words.length > 1 ? firstCharacter(words.at(-1)) : '';
  return (firstCharacter(words[0]) + last).toUpperCase();
}

export default function AccountMenu({ user }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const { logout } = useAuth();
  const displayName = user?.full_name || user?.username || 'Mi cuenta';
  const initials = getInitials(displayName);

  useEffect(() => {
    const close = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeWithEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative z-50">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? 'Ocultar menú de cuenta' : 'Mostrar menú de cuenta'}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2.5 rounded-full p-1.5 hover:bg-slate-100 transition-colors active:scale-95"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-sm">
          {initials}
        </span>
        <span className="hidden max-w-[150px] truncate text-left text-xs sm:block">
          <strong className="block truncate text-slate-800">{displayName}</strong>
          <span className="truncate text-[10px] text-slate-500">{user?.professional_title || 'Usuario DentalSense'}</span>
        </span>
        <IconChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 ds-pop origin-top-right w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl ring-1 ring-black/5">
          <p className="border-b border-slate-100 px-3 py-2.5">
            <strong className="block truncate text-sm font-bold text-slate-800">{displayName}</strong>
            <span className="block truncate text-xs text-slate-500">@{user?.username || 'usuario'}</span>
          </p>
          <nav aria-label="Cuenta">
           <ul className="mt-1 space-y-1">
            <li><Link
              to="/mi-cuenta"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              <IconUser className="h-4 w-4 text-slate-400" />
              <span>Mi perfil</span>
            </Link></li>
            <li><Link
              to="/mi-cuenta?section=security"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              <IconLock className="h-4 w-4 text-slate-400" />
              <span>Seguridad y contraseña</span>
            </Link></li>
            <li className="mt-1 border-t border-slate-100 pt-1"><button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <IconLogout className="h-4 w-4 text-rose-500" />
              <span>Cerrar sesión</span>
            </button></li>
           </ul>
          </nav>
        </div>
      )}
    </div>
  );
}
