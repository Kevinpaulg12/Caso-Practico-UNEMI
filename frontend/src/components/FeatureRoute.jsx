import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasFeature } from '../services/features';

// Una pantalla opcional solo existe si la variante del producto incluye su característica;
// si no, quien escriba la dirección a mano vuelve a `fallback`.
export default function FeatureRoute({ feature, fallback, children }) {
  const { user } = useAuth() ?? {};
  if (user && !hasFeature(user, feature)) return <Navigate to={fallback} replace />;
  return children;
}
