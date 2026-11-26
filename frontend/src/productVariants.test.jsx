import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import api from './services/api';
import { hasFeature, productLabel } from './services/features';

vi.mock('./services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

// Simula un odontólogo con sesión iniciada en la variante indicada del producto.
const doctorIn = (features) => {
  localStorage.setItem('access_token', 'a');
  localStorage.setItem('user_role', 'DOC');
  const responses = {
    '/me/': { role: 'DOC', username: 'laura', full_name: 'Laura Mendoza', features },
    '/discharges/': [],
    '/reports/summary/': {
      days: 30, patients_monitored: 0, reports_total: 0, alerts_medium: 0, alerts_high: 0,
      average_followup_days: null, risk_distribution: { Bajo: 0, Medio: 0, Alto: 0 },
      pain_by_day: [], top_symptoms: [], high_pain_threshold: 7,
    },
  };
  api.get.mockImplementation(async (url) => ({ data: responses[url] ?? { count: 0, next: null, results: [] } }));
};
const visit = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};
const VARIANT_A = { product: 'DentalSense Básico', variant: 'A', reports: false, notifications: false, ai: false };
const VARIANT_B = { product: 'DentalSense Completo', variant: 'B', reports: true, notifications: true, ai: true };

describe('Línea de productos: características por variante', () => {
  beforeEach(() => {
    api.get.mockReset();
    localStorage.clear();
  });

  it('hasFeature: solo una característica apagada explícitamente se oculta', () => {
    expect(hasFeature({ features: { reports: false } }, 'reports')).toBe(false);
    expect(hasFeature({ features: { reports: true } }, 'reports')).toBe(true);
    expect(hasFeature({ features: {} }, 'reports')).toBe(true);
    expect(hasFeature(null, 'reports')).toBe(true);
  });

  it('productLabel muestra el nombre de la variante', () => {
    expect(productLabel({ features: VARIANT_A })).toBe('DentalSense Básico · variante A');
    expect(productLabel({})).toBe('');
  });

  it('variante A: el menú del odontólogo no ofrece Informes', async () => {
    doctorIn(VARIANT_A);
    visit('/panel-doctor/historial');
    expect(await screen.findByText('DentalSense Básico · variante A')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Informes/ })).not.toBeInTheDocument();
  });

  it('variante B: el menú del odontólogo ofrece Informes', async () => {
    doctorIn(VARIANT_B);
    visit('/panel-doctor/historial');
    expect(await screen.findByText('DentalSense Completo · variante B')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Informes/ })).toBeInTheDocument();
  });

  it('variante A: escribir la dirección de Informes devuelve al panel', async () => {
    doctorIn(VARIANT_A);
    visit('/panel-doctor/informes');
    await waitFor(() => expect(window.location.pathname).toBe('/panel-doctor'));
    expect(screen.queryByRole('heading', { level: 1, name: 'Informes clínicos' })).not.toBeInTheDocument();
  });

  it('variante B: Informes se abre con normalidad', async () => {
    doctorIn(VARIANT_B);
    visit('/panel-doctor/informes');
    expect(await screen.findByRole('heading', { level: 1, name: 'Informes clínicos' })).toBeInTheDocument();
  });
});
