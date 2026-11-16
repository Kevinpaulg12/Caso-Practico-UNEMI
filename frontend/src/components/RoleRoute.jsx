import { Navigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RoleRoute({ role, children }) {
  const { isAuthenticated, role: userRole, user } = useAuth();
  const location = useLocation();
  const currentRole = userRole || localStorage.getItem('user_role');

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Primero el consentimiento y después la contraseña temporal: sin ellos no se entra a ningún panel.
  if (user?.must_accept_terms) {
    return <Navigate to="/consentimiento" replace />;
  }

  if (user?.must_change_password && location.pathname !== '/mi-cuenta') {
    return <Navigate to="/mi-cuenta?section=security&firstLogin=1" replace />;
  }

  if (currentRole !== role) {
    if (currentRole === 'DOC') return <Navigate to="/panel-doctor" replace />;
    if (currentRole === 'ADM') return <Navigate to="/panel-admin" replace />;
    return <Navigate to="/panel-paciente" replace />;
  }

  return children;
}
