import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../context/AuthContext';
import { renderAt } from '../test/utils';
import ProtectedRoute from './ProtectedRoute';
import RoleRoute from './RoleRoute';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

const app = (
  <Routes>
    <Route path="/login" element={<p>login</p>} />
    <Route path="/mi-cuenta" element={<p>cuenta</p>} />
    <Route path="/consentimiento" element={<p>consentimiento</p>} />
    <Route path="/panel-doctor" element={<RoleRoute role="DOC"><p>doctor</p></RoleRoute>} />
    <Route path="/panel-admin" element={<RoleRoute role="ADM"><p>admin</p></RoleRoute>} />
    <Route path="/panel-paciente" element={<RoleRoute role="PAT"><p>paciente</p></RoleRoute>} />
    <Route path="/privado" element={<ProtectedRoute><p>privado</p></ProtectedRoute>} />
  </Routes>
);

describe('rutas protegidas', () => {
  beforeEach(() => { useAuth.mockReset(); });

  it('sin sesión todo redirige a login', () => {
    useAuth.mockReturnValue({ isAuthenticated: false });
    for (const path of ['/panel-doctor', '/privado']) {
      const { unmount } = renderAt(app, path);
      expect(screen.getByText('login')).toBeInTheDocument();
      unmount();
    }
  });

  it('ProtectedRoute deja pasar a un usuario con sesión', () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    renderAt(app, '/privado');
    expect(screen.getByText('privado')).toBeInTheDocument();
  });

  it.each([
    ['DOC', '/panel-doctor', 'doctor'],
    ['ADM', '/panel-admin', 'admin'],
    ['PAT', '/panel-paciente', 'paciente'],
  ])('el rol %s accede a %s', (role, path, text) => {
    useAuth.mockReturnValue({ isAuthenticated: true, role, user: {} });
    renderAt(app, path);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each([
    ['PAT', '/panel-admin', 'paciente'],
    ['DOC', '/panel-admin', 'doctor'],
    ['ADM', '/panel-doctor', 'admin'],
  ])('el rol %s no entra en %s', (role, path, landing) => {
    useAuth.mockReturnValue({ isAuthenticated: true, role, user: {} });
    renderAt(app, path);
    expect(screen.getByText(landing)).toBeInTheDocument();
  });

  it('un paciente con clave temporal va a su cuenta', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, role: 'PAT', user: { must_change_password: true } });
    renderAt(app, '/panel-paciente');
    expect(screen.getByText('cuenta')).toBeInTheDocument();
  });

  it('el consentimiento pendiente va antes que la clave temporal y que cualquier panel', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, role: 'PAT', user: { must_accept_terms: true, must_change_password: true } });
    for (const path of ['/panel-paciente', '/privado']) {
      const { unmount } = renderAt(app, path);
      expect(screen.getByText('consentimiento')).toBeInTheDocument();
      unmount();
    }
  });

  it('BUG-51 un doctor con clave temporal también va a su cuenta', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, role: 'DOC', user: { must_change_password: true } });
    renderAt(app, '/panel-doctor');
    expect(screen.getByText('cuenta')).toBeInTheDocument();
  });
});
