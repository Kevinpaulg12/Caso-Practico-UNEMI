import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { renderAt } from '../test/utils';
import DoctorNotifications from './DoctorNotifications';

vi.mock('../services/api', () => ({ default: { get: vi.fn() } }));

const recent = new Date(Date.now() - 30 * 60000).toISOString();
const payload = {
  alerts: [{ id: 4, patient_id: 3, patient_name: 'Ana Ruiz', treatment_plan: 8, pain_level: 9, reasons: ['Dolor EVA 9'], created_at: recent }],
  appointments: [{
    id: 1, patient: 5, patient_id: 5, patient_name: 'Juan Paz', starts_at: '2099-01-15T08:30:00-05:00', kind: 'assessment',
    treatment: null, reason: 'Revisión', created_at: recent,
  }],
};

describe('Campana de notificaciones del odontólogo', () => {
  beforeEach(() => {
    localStorage.clear();
    api.get.mockReset();
    api.get.mockResolvedValue({ data: payload });
  });

  it('cuenta lo nuevo y muestra alertas y citas al abrirla', async () => {
    renderAt(<DoctorNotifications />);
    const bell = await screen.findByRole('button', { name: 'Notificaciones (2 nuevas)' });
    expect(api.get).toHaveBeenCalledWith('/doctor/notifications/');
    fireEvent.click(bell);
    const panel = screen.getByRole('dialog', { name: 'Notificaciones' });
    const alerts = within(panel).getByRole('region', { name: 'Alertas rojas' });
    expect(alerts).toHaveTextContent('Ana Ruiz');
    expect(alerts).toHaveTextContent('Dolor EVA 9');
    expect(within(alerts).getByRole('link')).toHaveAttribute('href', '/panel-doctor/tratamientos/8');
    const appointments = within(panel).getByRole('region', { name: 'Próximas citas' });
    expect(appointments).toHaveTextContent('Juan Paz');
    expect(appointments).toHaveTextContent('Valoración');
    expect(within(appointments).getByRole('link', { name: 'Ver la historia clínica de Juan Paz' })).toHaveAttribute('href', '/panel-doctor/pacientes/5/historia');
    // Al abrirla, lo pendiente queda visto: el número desaparece.
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sin nada pendiente lo dice', async () => {
    api.get.mockResolvedValue({ data: { alerts: [], appointments: [] } });
    renderAt(<DoctorNotifications />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }));
    expect(await screen.findByText('No tienes alertas ni citas próximas.')).toBeInTheDocument();
  });
});
