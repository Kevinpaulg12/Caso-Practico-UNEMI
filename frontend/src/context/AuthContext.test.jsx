import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { AuthProvider, IDLE_TIMEOUT_MS, useAuth } from './AuthContext';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

let auth;
function Probe() {
  const value = useAuth();
  useEffect(() => { auth = value; });
  const { pathname, search } = useLocation();
  return <p data-testid="location">{pathname + search}</p>;
}
const setup = () => render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
const location = () => screen.getByTestId('location').textContent;

function mockLogin(me) {
  api.post.mockResolvedValue({ data: { access: 'a', refresh: 'r' } });
  api.get.mockResolvedValue({ data: me });
}

describe('AuthContext', () => {
  beforeEach(() => { api.get.mockReset(); });

  it.each([
    ['DOC', '/panel-doctor/monitoreo'],
    ['ADM', '/panel-admin'],
    ['PAT', '/panel-paciente'],
  ])('el rol %s entra en %s', async (role, path) => {
    mockLogin({ role });
    setup();
    await act(async () => { expect((await auth.login('u', 'p')).success).toBe(true); });
    expect(location()).toBe(path);
    expect(localStorage.getItem('access_token')).toBe('a');
    expect(localStorage.getItem('user_role')).toBe(role);
  });

  it('la clave temporal lleva a cambiar la contraseña', async () => {
    mockLogin({ role: 'PAT', must_change_password: true });
    setup();
    await act(async () => { await auth.login('u', 'p'); });
    expect(location()).toBe('/mi-cuenta?section=security&firstLogin=1');
  });

  it('un paciente sin consentimiento va primero a los términos', async () => {
    mockLogin({ role: 'PAT', must_accept_terms: true, must_change_password: true });
    setup();
    await act(async () => { await auth.login('u', 'p'); });
    expect(location()).toBe('/consentimiento');
  });

  it('si otra pestaña inicia sesión con otra cuenta, esta pestaña pasa al panel de esa cuenta', async () => {
    mockLogin({ role: 'ADM', username: 'admin' });
    setup();
    await act(async () => { await auth.login('admin', 'p'); });
    expect(location()).toBe('/panel-admin');
    api.get.mockResolvedValue({ data: { role: 'PAT', username: 'ana' } });
    localStorage.setItem('access_token', 'otro');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'access_token', oldValue: 'a', newValue: 'otro' })); });
    await waitFor(() => expect(location()).toBe('/panel-paciente'));
    expect(auth.user.username).toBe('ana');
  });

  it('si otra pestaña cierra la sesión, esta también vuelve al inicio de sesión', async () => {
    mockLogin({ role: 'DOC', username: 'laura' });
    setup();
    await act(async () => { await auth.login('laura', 'p'); });
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'access_token', oldValue: 'a', newValue: null })); });
    expect(location()).toBe('/login');
    expect(auth.isAuthenticated).toBe(false);
  });

  it('updateUser actualiza el perfil sin volver a pedirlo', async () => {
    mockLogin({ role: 'PAT', must_accept_terms: true });
    setup();
    await act(async () => { await auth.login('u', 'p'); });
    act(() => auth.updateUser({ must_accept_terms: false }));
    expect(auth.user).toEqual({ role: 'PAT', must_accept_terms: false });
  });

  it('al cerrar sesión recuerda el perfil (sin tokens) para el próximo inicio', async () => {
    mockLogin({ role: 'PAT', username: 'paciente.1', full_name: 'Kevin Davila' });
    setup();
    await act(async () => { await auth.login('1712345678', 'p'); });
    act(() => auth.logout());
    expect(JSON.parse(localStorage.getItem('last_profile'))).toEqual({
      username: 'paciente.1', full_name: 'Kevin Davila', role: 'PAT',
    });
  });

  it('un login fallido devuelve el mensaje y no autentica', async () => {
    api.post.mockRejectedValue({ response: { data: { detail: 'Mal' } } });
    setup();
    let result;
    await act(async () => { result = await auth.login('u', 'p'); });
    expect(result).toEqual({ success: false, message: 'Mal' });
    expect(auth.isAuthenticated).toBe(false);
  });

  it('logout limpia la sesión y va a /login', async () => {
    mockLogin({ role: 'DOC' });
    setup();
    await act(async () => { await auth.login('u', 'p'); });
    act(() => auth.logout());
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(location()).toBe('/login');
  });

  it('restaura la sesión guardada', async () => {
    localStorage.setItem('access_token', 'a');
    api.get.mockResolvedValue({ data: { role: 'DOC', username: 'd' } });
    setup();
    await waitFor(() => expect(auth.user?.username).toBe('d'));
    expect(auth.role).toBe('DOC');
    expect(auth.loading).toBe(false);
  });

  it('BUG-36 un error 503 transitorio no cierra la sesión', async () => {
    localStorage.setItem('access_token', 'a');
    api.get.mockRejectedValue({ response: { status: 503 } });
    setup();
    await waitFor(() => expect(auth.loading).toBe(false));
    expect(auth.isAuthenticated).toBe(true);
  });

  it('BUG-50 un fallo posterior al login no deja tokens huérfanos', async () => {
    api.post.mockResolvedValue({ data: { access: 'a', refresh: 'r' } });
    api.get.mockRejectedValue({ response: { status: 500 } });
    setup();
    await act(async () => { await auth.login('u', 'p'); });
    expect(localStorage.getItem('access_token')).toBeNull();
  });
});

describe('RNF01: cierre por inactividad', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem('access_token', 'a');
    api.get.mockResolvedValue({ data: { role: 'PAT', username: 'p' } });
    api.post.mockResolvedValue({ data: {} });
  });
  afterEach(() => vi.useRealTimers());

  it('cierra la sesión tras 5 minutos sin interacción', async () => {
    setup();
    await waitFor(() => expect(auth.isAuthenticated).toBe(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 5000); });
    expect(auth.isAuthenticated).toBe(false);
    expect(location()).toBe('/login?motivo=inactividad');
    expect(sessionStorage.getItem('logout_reason')).toBe('inactividad');
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('mientras el usuario interactúa la sesión sigue y se avisa al servidor', async () => {
    setup();
    await waitFor(() => expect(auth.isAuthenticated).toBe(true));
    for (let minute = 0; minute < 8; minute += 1) {
      window.dispatchEvent(new Event('keydown'));
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    }
    expect(auth.isAuthenticated).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/session/ping/');
  });
});
