import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../context/AuthContext';
import Login from './Login';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

describe('Login', () => {
  const login = vi.fn();
  beforeEach(() => {
    login.mockReset();
    useAuth.mockReturnValue({ login });
  });

  const fill = (username, password) => {
    fireEvent.change(screen.getByLabelText('Usuario o cédula'), { target: { value: username } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: /Iniciar sesión/ }));
  };

  it('exige usuario y contraseña', () => {
    render(<Login />);
    fill('   ', '');
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa tu usuario');
    expect(login).not.toHaveBeenCalled();
  });

  it('recorta el usuario pero respeta los espacios de la contraseña', async () => {
    login.mockResolvedValue({ success: true });
    render(<Login />);
    fill('  ana  ', ' clave ');
    await waitFor(() => expect(login).toHaveBeenCalledWith('ana', ' clave '));
  });

  it('muestra el error y vuelve a habilitar el formulario', async () => {
    login.mockResolvedValue({ success: false, message: 'Credenciales malas' });
    render(<Login />);
    fill('ana', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales malas');
    expect(screen.getByRole('button', { name: /Iniciar sesión/ })).toBeEnabled();
  });

  it('RNF01: avisa que la sesión se cerró por inactividad aunque la URL no lo indique', () => {
    sessionStorage.setItem('logout_reason', 'inactividad');
    render(<Login />);
    expect(screen.getByRole('status')).toHaveTextContent('5 minutos de inactividad');
    expect(sessionStorage.getItem('logout_reason')).toBeNull();
  });

  it('muestra y oculta la contraseña', () => {
    render(<Login />);
    const input = screen.getByLabelText('Contraseña');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByLabelText('Mostrar contraseña'));
    expect(input).toHaveAttribute('type', 'text');
  });

  describe('perfil recordado', () => {
    const remember = () => localStorage.setItem('last_profile', JSON.stringify({
      username: 'paciente.1712345678', full_name: 'Kevin Davila', role: 'PAT',
    }));

    it('muestra al último usuario y pide solo la contraseña', async () => {
      remember();
      login.mockResolvedValue({ success: true });
      render(<Login />);
      expect(screen.getByText('Kevin Davila')).toBeInTheDocument();
      expect(screen.getByText('Paciente · paciente.1712345678')).toBeInTheDocument();
      expect(screen.getByText('KD')).toBeInTheDocument();
      expect(screen.queryByLabelText('Usuario o cédula')).toBeNull();
      expect(screen.getByLabelText('Contraseña')).toHaveFocus();
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave' } });
      fireEvent.click(screen.getByRole('button', { name: /^Iniciar sesión$/ }));
      await waitFor(() => expect(login).toHaveBeenCalledWith('paciente.1712345678', 'clave'));
    });

    it('sin contraseña avisa solo de la contraseña', () => {
      remember();
      render(<Login />);
      fireEvent.click(screen.getByRole('button', { name: /^Iniciar sesión$/ }));
      expect(screen.getByRole('alert')).toHaveTextContent('Ingresa tu contraseña para continuar.');
      expect(login).not.toHaveBeenCalled();
    });

    it('«Iniciar sesión con otra cuenta» vuelve al formulario clásico y permite regresar', async () => {
      remember();
      login.mockResolvedValue({ success: true });
      render(<Login />);
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión con otra cuenta' }));
      expect(screen.queryByText('Kevin Davila')).toBeNull();
      fill('doctora', 'x');
      await waitFor(() => expect(login).toHaveBeenCalledWith('doctora', 'x'));
      fireEvent.click(screen.getByRole('button', { name: 'Volver a Kevin' }));
      expect(screen.getByText('Kevin Davila')).toBeInTheDocument();
    });

    it('un perfil guardado dañado se ignora', () => {
      localStorage.setItem('last_profile', '{roto');
      render(<Login />);
      expect(screen.getByLabelText('Usuario o cédula')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /otra cuenta/ })).toBeNull();
    });
  });

  it('avisa si la sesión se cerró por no aceptar los términos', () => {
    sessionStorage.setItem('logout_reason', 'terminos');
    render(<Login />);
    expect(screen.getByRole('status')).toHaveTextContent('aceptar los Términos y Condiciones');
  });

  it('BUG-53 recuperar contraseña hace algo', () => {
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: /Olvidaste/ }));
    expect(screen.getByText(/recuperar|restablecer|contacta/i)).toBeInTheDocument();
  });
});
