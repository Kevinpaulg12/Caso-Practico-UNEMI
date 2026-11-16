import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { renderAt } from '../test/utils';
import Account from './Account';

const logout = vi.hoisted(() => vi.fn());
vi.mock('../services/api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout }) }));

const account = { username: 'ana', role: 'PAT', first_name: 'Ana', last_name: 'Ruiz', email: '', phone: '', emergency_contact: '', birth_date: '1990-01-01' };
const named = (container, name) => container.querySelector(`[name=${name}]`);

describe('Mi cuenta', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.patch.mockReset();
    api.post.mockReset();
    api.get.mockResolvedValue({ data: account });
  });

  it('carga y guarda el perfil; el teléfono solo admite dígitos', async () => {
    api.patch.mockResolvedValue({ data: account });
    const { container } = renderAt(<Account />);
    await screen.findByText('Datos Personales');
    fireEvent.change(named(container, 'phone'), { target: { value: '09-9a' } });
    expect(named(container, 'phone')).toHaveValue('099');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(/se actualizaron correctamente/)).toBeInTheDocument();
    expect(api.patch.mock.calls[0][1]).toMatchObject({ phone: '099', first_name: 'Ana' });
  });

  it('muestra los errores de la API al guardar', async () => {
    api.patch.mockRejectedValue({ response: { data: { email: ['Correo inválido'] } } });
    renderAt(<Account />);
    await screen.findByText('Datos Personales');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo inválido');
  });

  it('valida la coincidencia de contraseñas sin llamar a la API', async () => {
    const { container } = renderAt(<Account />, '/?section=security');
    await screen.findByText('Actualizar Contraseña');
    fireEvent.change(named(container, 'current_password'), { target: { value: 'a' } });
    fireEvent.change(named(container, 'new_password'), { target: { value: 'Nueva-123!' } });
    fireEvent.change(named(container, 'confirm_password'), { target: { value: 'Otra-123!' } });
    fireEvent.submit(named(container, 'current_password').closest('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('no coinciden');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('cambia la contraseña, confirma y programa el cierre de sesión', async () => {
    api.post.mockResolvedValue({ data: {} });
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const { container } = renderAt(<Account />, '/?section=security');
    await screen.findByText('Actualizar Contraseña');
    for (const name of ['current_password', 'new_password', 'confirm_password']) {
      fireEvent.change(named(container, name), { target: { value: 'Nueva-123!' } });
    }
    fireEvent.submit(named(container, 'current_password').closest('form'));
    expect(await screen.findByText(/Contraseña actualizada/)).toBeInTheDocument();
    expect(timer).toHaveBeenCalledWith(logout, 1500);
  });

  it('primer acceso: bloquea el perfil y avisa', async () => {
    renderAt(<Account />, '/?firstLogin=1');
    expect(await screen.findByText(/debes cambiar tu contraseña temporal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Información del perfil/ })).toBeDisabled();
  });

  it('BUG-56 un fallo de carga muestra el error', async () => {
    api.get.mockRejectedValue(new Error('red'));
    renderAt(<Account />);
    expect(await screen.findByText(/No pudimos cargar/, {}, { timeout: 300 })).toBeInTheDocument();
  });

  it('BUG-20 no envía una fecha vacía', async () => {
    api.get.mockResolvedValue({ data: { ...account, birth_date: null } });
    api.patch.mockResolvedValue({ data: account });
    renderAt(<Account />);
    await screen.findByText('Datos Personales');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(api.patch.mock.calls[0][1].birth_date).not.toBe('');
  });
});
