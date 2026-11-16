import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import api from './services/api';

vi.mock('./services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const visit = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};
const asRole = (role) => {
  localStorage.setItem('access_token', 'a');
  localStorage.setItem('user_role', role);
  const list = { count: 0, next: null, results: [] };
  const responses = {
    '/me/': { role, username: 'u' },
    '/admin/users/': list,
    '/admin/users/summary/': { active_users: 0, patients: 0, doctors: 0, admins: 0, audit_events: 0 },
    '/audit-events/': list,
    '/procedures/': list,
    '/medication-guides/': list,
    '/alert-settings/': { high_pain: 7, rising_pain: 6, medium_pain: 5 },
    '/discharges/': [],
    '/reports/summary/': {
      days: 30, patients_monitored: 0, reports_total: 0, alerts_medium: 0, alerts_high: 0,
      average_followup_days: null, risk_distribution: { Bajo: 0, Medio: 0, Alto: 0 },
      pain_by_day: [], top_symptoms: [], high_pain_threshold: 7,
    },
  };
  api.get.mockImplementation(async (url) => ({ data: responses[url] }));
};

describe('Rutas de la aplicación', () => {
  beforeEach(() => { api.get.mockReset(); });

  it('portada pública', () => {
    visit('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Seguimiento continuo de tu tratamiento odontológico');
  });

  it('página 404', () => {
    visit('/no-existe');
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  it.each([
    ['/panel-admin', 'ADM', 'Usuarios y roles'],
    ['/panel-admin/catalogo', 'ADM', 'Catálogo clínico'],
    ['/panel-admin/reglas', 'ADM', 'Reglas de alerta'],
    ['/panel-admin/auditoria', 'ADM', 'Registro de auditoría'],
    ['/panel-doctor/historial', 'DOC', 'Historial y altas'],
    ['/panel-doctor/informes', 'DOC', 'Informes clínicos'],
  ])('%s renderiza para %s', async (path, role, heading) => {
    asRole(role);
    visit(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it.each([
    ['/panel-admin', 'ADM'],
    ['/panel-admin/auditoria', 'ADM'],
    ['/panel-doctor/informes', 'DOC'],
    ['/panel-doctor/historial', 'DOC'],
  ])('BUG-42 %s consulta datos reales', async (path, role) => {
    asRole(role);
    visit(path);
    await waitFor(() => {
      const urls = api.get.mock.calls.map(([url]) => url).filter((url) => url !== '/me/');
      expect(urls.length).toBeGreaterThan(0);
    });
  });
});
