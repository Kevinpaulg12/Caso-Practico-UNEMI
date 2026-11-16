import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { renderAt } from '../test/utils';
import Consent from './Consent';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

const auth = (user, extra = {}) => {
  const value = { isAuthenticated: true, user, updateUser: vi.fn(), logout: vi.fn(), ...extra };
  useAuth.mockReturnValue(value);
  return value;
};
const patient = { username: 'paciente.1', full_name: 'Ana López', role: 'PAT', must_accept_terms: true, must_change_password: true };

function render(path = '/consentimiento') {
  return renderAt(
    <Routes>
      <Route path="/consentimiento" element={<Consent />} />
      <Route path="/mi-cuenta" element={<p>cuenta</p>} />
      <Route path="/panel-paciente" element={<p>portal</p>} />
      <Route path="/login" element={<p>login</p>} />
    </Routes>,
    path,
  );
}
const accept = () => screen.getByRole('button', { name: 'Aceptar y continuar' });

describe('Consentimiento en el primer acceso', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockResolvedValue({ data: { version: '2026-11', must_accept_terms: true } });
  });

  it('exige marcar las dos autorizaciones antes de aceptar', async () => {
    auth(patient);
    render();
    expect(await screen.findByText('Versión 2026-11')).toBeInTheDocument();
    expect(screen.getByText(/Ana López, para usar el portal/)).toBeInTheDocument();
    expect(accept()).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/acepto los Términos y Condiciones/));
    expect(accept()).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/tratamiento de mis datos de salud/));
    expect(accept()).toBeEnabled();
  });

  it('al aceptar registra la versión y pasa al cambio de contraseña', async () => {
    const value = auth(patient);
    api.post.mockResolvedValue({ data: { must_accept_terms: false, must_change_password: true } });
    render();
    await screen.findByText('Versión 2026-11');
    fireEvent.click(screen.getByLabelText(/acepto los Términos/));
    fireEvent.click(screen.getByLabelText(/datos de salud/));
    fireEvent.click(accept());
    expect(await screen.findByText('cuenta')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/account/terms/', { accepted: true, version: '2026-11' });
    expect(value.updateUser).toHaveBeenCalledWith({ must_accept_terms: false, must_change_password: true });
  });

  it('si ya cambió la contraseña entra directo a su portal', async () => {
    auth({ ...patient, must_change_password: false });
    api.post.mockResolvedValue({ data: { must_accept_terms: false, must_change_password: false } });
    render();
    await screen.findByText('Versión 2026-11');
    fireEvent.click(screen.getByLabelText(/acepto los Términos/));
    fireEvent.click(screen.getByLabelText(/datos de salud/));
    fireEvent.click(accept());
    expect(await screen.findByText('portal')).toBeInTheDocument();
  });

  it('no aceptar pide confirmación, registra la respuesta y cierra la sesión', async () => {
    const value = auth(patient);
    api.post.mockResolvedValue({ data: { must_accept_terms: true } });
    render();
    await screen.findByText('Versión 2026-11');
    fireEvent.click(screen.getByRole('button', { name: 'No acepto' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('no podrás usar el portal');
    fireEvent.click(screen.getByRole('button', { name: 'No acepto, cerrar sesión' }));
    await waitFor(() => expect(value.logout).toHaveBeenCalledWith('terminos'));
    expect(api.post).toHaveBeenCalledWith('/account/terms/', { accepted: false, version: '2026-11' });
  });

  it('quien ya aceptó no vuelve a ver la pantalla', () => {
    auth({ ...patient, must_accept_terms: false, must_change_password: false });
    render();
    expect(screen.getByText('portal')).toBeInTheDocument();
  });

  it('sin sesión va al inicio de sesión', () => {
    auth(null, { isAuthenticated: false });
    render();
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('informa si los términos cambiaron mientras los leía', async () => {
    auth(patient);
    api.post.mockRejectedValue({ response: { data: { version: ['Los términos cambiaron. Vuelve a leerlos antes de aceptar.'] } } });
    render();
    await screen.findByText('Versión 2026-11');
    fireEvent.click(screen.getByLabelText(/acepto los Términos/));
    fireEvent.click(screen.getByLabelText(/datos de salud/));
    fireEvent.click(accept());
    expect(await screen.findByRole('alert')).toHaveTextContent('Los términos cambiaron');
  });
});
