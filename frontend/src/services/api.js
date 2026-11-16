import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = 'Bearer ' + token;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

let refreshing = null;

function refreshAccessToken() {
  refreshing ??= api
    .post('/token/refresh/', { refresh: localStorage.getItem('refresh_token') })
    .then(({ data }) => {
      localStorage.setItem('access_token', data.access);
      return data.access;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const { config } = error;
      const idle = error.response.data?.code === 'session_idle';
      const canRefresh = !idle && config && !config.retried && !config.url?.includes('/token/')
        && localStorage.getItem('refresh_token');
      if (canRefresh) {
        try {
          await refreshAccessToken();
          return await api({ ...config, retried: true });
        } catch (retryError) {
          return Promise.reject(retryError);
        }
      }
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user_role');
      if (idle) sessionStorage.setItem('logout_reason', 'inactividad');
      if (window.location.pathname !== '/login') {
        window.location.assign(idle ? '/login?motivo=inactividad' : '/login');
      }
    }
    return Promise.reject(error);
  },
);

export default api;
