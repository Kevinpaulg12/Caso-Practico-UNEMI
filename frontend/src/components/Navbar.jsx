import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IconLogout, IconUser } from './Icons';

export default function Navbar() {
  const { isAuthenticated, logout } = useAuth();
  const { pathname } = useLocation();

  if (pathname === '/login' || pathname.startsWith('/panel-') || pathname.startsWith('/mi-cuenta')) {
    return null;
  }

  return (
    <nav className="p-4 text-white bg-slate-800 shadow-md">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        <div className="flex gap-4">
          <Link to="/" className="hover:text-blue-400 font-medium">Inicio</Link>
          {isAuthenticated && (
            <>
              <Link to="/panel-paciente" className="hover:text-blue-400 font-medium">Panel Paciente</Link>
              <Link to="/panel-doctor" className="hover:text-blue-400 font-medium">Panel Doctor</Link>
              <Link to="/panel-admin" className="hover:text-blue-400 font-medium">Panel Admin</Link>
            </>
          )}
        </div>
        <div>
          {!isAuthenticated ? (
            <Link to="/login" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
              <IconUser className="h-4 w-4 shrink-0" />Iniciar Sesión
            </Link>
          ) : (
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              <IconLogout className="h-4 w-4 shrink-0" />Cerrar Sesión
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}