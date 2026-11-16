import { describe, expect, it, vi } from 'vitest';
import api from './api';

const requestHandler = api.interceptors.request.handlers[0].fulfilled;
const errorHandler = api.interceptors.response.handlers[0].rejected;

describe('api', () => {
  it('añade el token Bearer cuando existe', () => {
    localStorage.setItem('access_token', 'abc');
    expect(requestHandler({ headers: {} }).headers.Authorization).toBe('Bearer abc');
  });

  it('no añade cabecera sin token', () => {
    expect(requestHandler({ headers: {} }).headers.Authorization).toBeUndefined();
  });

  it('un 401 borra los tokens y propaga el error', async () => {
    window.history.pushState({}, '', '/login');
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'r');
    const error = { response: { status: 401 } };
    await expect(errorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('otros errores conservan la sesión', async () => {
    localStorage.setItem('access_token', 'a');
    await expect(errorHandler({ response: { status: 500 } })).rejects.toBeTruthy();
    expect(localStorage.getItem('access_token')).toBe('a');
  });

  it('BUG-37 intenta renovar el token ante un 401', async () => {
    window.history.pushState({}, '', '/login');
    localStorage.setItem('refresh_token', 'r');
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { access: 'nuevo' } });
    await errorHandler({ response: { status: 401 }, config: { headers: {} } }).catch(() => {});
    expect(post).toHaveBeenCalledWith('/token/refresh/', expect.anything());
    expect(localStorage.getItem('access_token')).toBe('nuevo');
  });

  it('no intenta renovar cuando falla el propio login', async () => {
    window.history.pushState({}, '', '/login');
    localStorage.setItem('refresh_token', 'r');
    const post = vi.spyOn(api, 'post');
    await errorHandler({ response: { status: 401 }, config: { url: '/token/', headers: {} } }).catch(() => {});
    expect(post).not.toHaveBeenCalled();
  });
});

describe('RNF01 en el cliente HTTP', () => {
  it('una sesión cerrada por inactividad no se renueva y lleva al login con aviso', async () => {
    window.history.pushState({}, '', '/panel-paciente');
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/panel-paciente', assign });
    localStorage.setItem('refresh_token', 'r');
    const post = vi.spyOn(api, 'post');
    const error = { response: { status: 401, data: { code: 'session_idle' } }, config: { url: '/me/', headers: {} } };
    await expect(errorHandler(error)).rejects.toBe(error);
    expect(post).not.toHaveBeenCalled();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login?motivo=inactividad');
  });
});
