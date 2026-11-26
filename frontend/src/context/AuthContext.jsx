import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { homePath, rememberProfile } from '../services/session';

const AuthContext = createContext(null);

// RNF01: debe coincidir con SESSION_IDLE_TIMEOUT_MINUTES del backend.
export const IDLE_TIMEOUT_MS = Number(import.meta.env.VITE_SESSION_IDLE_MINUTES || 5) * 60000;
const PING_INTERVAL_MS = 60000;
const CHECK_INTERVAL_MS = 5000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('access_token'));
  const [role, setRole] = useState(() => localStorage.getItem('user_role'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!localStorage.getItem('access_token'));
  const navigate = useNavigate();

  // El cierre de sesión necesita el perfil actual sin volver a crear la función en cada cambio.
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // Usuario que tenía esta pestaña antes de que otra pestaña cambiara la sesión (null si no hubo cambio).
  const switchedFrom = useRef(undefined);

  useEffect(() => {
    if (!token) return;

    api.get('/me/')
      .then((response) => {
        setUser(response.data);
        // Otra pestaña inició sesión con otra cuenta: esta pestaña pasa al panel de esa cuenta en lugar
        // de seguir mostrando el anterior y enviar acciones con un token ajeno (respuestas 403).
        if (switchedFrom.current !== undefined) {
          if (switchedFrom.current !== response.data.username) navigate(homePath(response.data), { replace: true });
          switchedFrom.current = undefined;
        }
        if (response.data.role) {
          setRole(response.data.role);
          localStorage.setItem('user_role', response.data.role);
        }
      })
      .catch((error) => {
        // Solo un 401 invalida la sesión: un fallo pasajero del servidor no debe expulsar al usuario.
        if (error.response?.status !== 401) return;
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_role');
        setToken(null);
        setRole(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token, navigate]);

  // El token vive en localStorage, compartido por todas las pestañas: se sigue su cambio.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== 'access_token' || event.newValue === event.oldValue) return;
      if (!event.newValue) {
        setToken(null);
        setRole(null);
        setUser(null);
        navigate('/login', { replace: true });
        return;
      }
      switchedFrom.current = userRef.current?.username ?? null;
      setToken(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [navigate]);

  const login = async (username, password) => {
    try {
      const response = await api.post('/token/', { username, password });
      const accessToken = response.data.access;
      const refreshToken = response.data.refresh;

      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);
      if (!localStorage.getItem('has_logged_in')) {
        localStorage.setItem('show_first_login_welcome', 'true');
      }
      localStorage.setItem('logged_in_username', username);
      localStorage.setItem('has_logged_in', 'true');

      const currentUser = await api.get('/me/');
      const userRole = currentUser.data.role;
      localStorage.setItem('user_role', userRole);

      setToken(accessToken);
      setRole(userRole);
      setUser(currentUser.data);

      navigate(homePath(currentUser.data));
      return { success: true };
    } catch (err) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      const message = err.response?.data?.detail || 'Credenciales inválidas. Verifica tu usuario y contraseña.';
      return {
        success: false,
        message,
      };
    }
  };

  // Tras aceptar los términos o cambiar la contraseña, el perfil se actualiza sin pedirlo de nuevo.
  const updateUser = useCallback((changes) => {
    setUser((current) => (current ? { ...current, ...changes } : current));
  }, []);

  const logout = useCallback((reason) => {
    // El motivo viaja fuera de la URL: las rutas protegidas también redirigen a /login al cerrar la sesión.
    if (reason) sessionStorage.setItem('logout_reason', reason);
    // Al volver, el inicio de sesión muestra a este usuario y solo le pide la contraseña.
    rememberProfile(userRef.current);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('logged_in_username');
    localStorage.removeItem('show_first_login_welcome');
    setToken(null);
    setRole(null);
    setUser(null);
    navigate(reason === 'inactividad' ? '/login?motivo=inactividad' : '/login');
  }, [navigate]);

  // Cierra la sesión tras el tiempo de inactividad y avisa al servidor mientras el usuario interactúa.
  const lastInteraction = useRef(0);
  const lastPing = useRef(0);
  useEffect(() => {
    if (!token) return undefined;
    lastInteraction.current = Date.now();
    lastPing.current = Date.now();
    const markActive = () => { lastInteraction.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActive, { passive: true }));
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - lastInteraction.current >= IDLE_TIMEOUT_MS) {
        logout('inactividad');
        return;
      }
      if (lastInteraction.current > lastPing.current && now - lastPing.current >= PING_INTERVAL_MS) {
        lastPing.current = now;
        api.post('/session/ping/').catch(() => {});
      }
    }, CHECK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActive));
    };
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ token, role, user, isAuthenticated: !!token, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
