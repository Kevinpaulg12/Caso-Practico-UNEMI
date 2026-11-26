import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { page, renderAt } from '../test/utils';
import AdminUsers from './AdminUsers';
import AlertRules from './AlertRules';
import AuditLog from './AuditLog';
import ClinicalCatalog from './ClinicalCatalog';
import Discharges from './Discharges';
import Reports from './Reports';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const session = vi.hoisted(() => ({ user: null }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn(), user: session.user }) }));

function mockGet(routes) {
  api.get.mockImplementation(async (url) => {
    if (url === '/me/') return { data: {} };
    if (url in routes) return { data: routes[url] };
    throw new Error(url);
  });
}

describe('Módulos con datos reales', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
  });

  describe('AdminUsers', () => {
    const doctor = { id: 2, username: 'doc', full_name: 'Laura Paz', email: 'l@example.com', role_label: 'Doctor', is_active: true };
    const routes = {
      '/admin/users/': page([doctor]),
      '/admin/users/summary/': { active_users: 5, patients: 3, doctors: 1, admins: 1, audit_events: 9 },
    };

    it('muestra cifras y usuarios de la API', async () => {
      mockGet(routes);
      renderAt(<AdminUsers />);
      expect(await screen.findByText('Laura Paz')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('desactiva una cuenta', async () => {
      mockGet(routes);
      api.patch.mockResolvedValue({ data: {} });
      renderAt(<AdminUsers />);
      fireEvent.click(await screen.findByRole('button', { name: /^Desactivar a / }));
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/users/2/', { is_active: false }));
    });

    it('el administrador no puede desactivarse a sí mismo', async () => {
      session.user = { id: 2 };
      mockGet(routes);
      renderAt(<AdminUsers />);
      expect(await screen.findByRole('button', { name: 'No puedes desactivar tu propia cuenta' })).toBeDisabled();
      session.user = null;
    });

    it('si la sesión cambió de cuenta en otra pestaña lo explica', async () => {
      mockGet(routes);
      api.patch.mockRejectedValue({ response: { status: 403, data: { detail: 'Solo el administrador puede realizar esta acción.' } } });
      renderAt(<AdminUsers />);
      fireEvent.click(await screen.findByRole('button', { name: /^Desactivar a / }));
      expect(await screen.findByRole('alert')).toHaveTextContent('otra cuenta en otra pestaña');
    });

    it('crea una cuenta y muestra la clave temporal', async () => {
      mockGet(routes);
      api.post.mockResolvedValue({ data: { username: 'eva', temporary_password: 'Temp-9' } });
      const { container } = renderAt(<AdminUsers />);
      await screen.findByText('Laura Paz');
      fireEvent.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
      fireEvent.change(container.querySelector('[name=username]'), { target: { value: 'eva' } });
      fireEvent.submit(container.querySelector('[name=username]').closest('form'));
      expect(await screen.findByText(/eva \/ Temp-9/)).toBeInTheDocument();
    });

    it('informa si la API falla', async () => {
      api.get.mockRejectedValue(new Error('red'));
      renderAt(<AdminUsers />);
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar');
    });
  });

  it('AuditLog lista los eventos', async () => {
    mockGet({ '/audit-events/': page([{ id: 1, actor_label: 'Ana', action: 'Inició sesión', module: 'Seguridad', created_at: '2026-10-30T10:00:00Z' }]) });
    renderAt(<AuditLog />);
    expect(await screen.findByText('Inició sesión')).toBeInTheDocument();
    expect(screen.getByText('1 evento')).toBeInTheDocument();
  });

  it('Reports muestra el resumen y su estado vacío', async () => {
    mockGet({
      '/reports/summary/': {
        days: 30, patients_monitored: 2, reports_total: 4, alerts_medium: 1, alerts_high: 1,
        average_followup_days: 3.5, risk_distribution: { Bajo: 1, Medio: 1, Alto: 0 },
        pain_by_day: [], top_symptoms: [{ label: 'Sangrado', count: 2 }], high_pain_threshold: 7,
      },
    });
    renderAt(<Reports />);
    expect(await screen.findByText('3.5 días')).toBeInTheDocument();
    // La gráfica se carga aparte (D3): la primera importación en la prueba puede tardar más de 1 s.
    expect(await screen.findByRole('img', { name: 'Sangrado: 2' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('No hay reportes en este periodo.')).toBeInTheDocument();
  });

  it('Reports muestra los tratamientos que realizó el odontólogo', async () => {
    mockGet({
      '/reports/summary/': {
        days: 30, patients_monitored: 1, reports_total: 2, alerts_medium: 0, alerts_high: 1,
        average_followup_days: 2, risk_distribution: { Bajo: 1, Medio: 0, Alto: 0 },
        pain_by_day: [], top_symptoms: [], high_pain_threshold: 7,
        activity: {
          doctor_name: 'Laura Mora', treatments_started: 3, treatments_active: 2, treatments_discharged: 1, patients_treated: 2,
          controls_given: 4, discharges_given: 1, prescriptions_issued: 5, appointments_attended: 3, appointments_cancelled: 1,
          treatments_with_high_alerts: 1, reports_received: 6,
          by_procedure: [{ procedure: 'Exodoncia simple', specialty: 'Cirugía oral', total: 2, active: 1, discharged: 1, patients: 2 }],
          top_medications: [{ name: 'Amoxicilina', count: 3 }, { name: 'Ibuprofeno', count: 2 }],
          treatments: [{
            id: 8, patient_id: 3, patient_name: 'Ana Ruiz', procedure: 'Exodoncia simple', teeth: [38], start_date: '2026-11-02',
            status: 'Alta', discharged_at: '2026-11-10T10:00:00Z', controls: 2, medications: ['Amoxicilina', 'Ibuprofeno'], high_alerts: 1,
          }],
        },
      },
    });
    renderAt(<Reports />);
    expect(await screen.findByText('Tu actividad clínica')).toBeInTheDocument();
    expect(screen.getByText('Tratamientos iniciados').closest('article')).toHaveTextContent('32 en curso · 1 con alta');
    expect(screen.getByRole('region', { name: 'Tratamientos por procedimiento' })).toHaveTextContent('Exodoncia simpleCirugía oral');
    expect(screen.getByRole('region', { name: 'Medicamentos más recetados' })).toHaveTextContent('Amoxicilina3');
    const detail = screen.getByRole('region', { name: 'Detalle de tratamientos' });
    expect(within(detail).getByRole('link', { name: 'Ana Ruiz' })).toHaveAttribute('href', '/panel-doctor/tratamientos/8');
    expect(detail).toHaveTextContent('Piezas 38');
    expect(detail).toHaveTextContent('Amoxicilina, Ibuprofeno');
    // El encabezado del PDF nombra al odontólogo.
    expect(screen.getByText(/Informe de tratamientos · Dr\(a\). Laura Mora/)).toBeInTheDocument();
  });

  it('Discharges lista los tratamientos cerrados', async () => {
    mockGet({
      '/discharges/': [{
        id: 1, patient_id: 3, patient_name: 'Ana Ruiz', procedure: 'Exodoncia',
        start_date: '2026-10-01', discharged_at: '2026-10-05', followup_days: 5, high_alerts: 0,
      }],
    });
    renderAt(<Discharges />);
    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('HC-00003')).toBeInTheDocument();
  });

  it('AlertRules guarda los umbrales modificados', async () => {
    mockGet({ '/alert-settings/': { high_pain: 7, rising_pain: 6, medium_pain: 5 } });
    api.patch.mockResolvedValue({ data: { high_pain: 8, rising_pain: 6, medium_pain: 5 } });
    renderAt(<AlertRules />);
    fireEvent.click(await screen.findByRole('button', { name: /Subir: Riesgo alto: EVA igual o mayor a$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar umbrales' }));
    expect(await screen.findByText(/Umbrales guardados/)).toBeInTheDocument();
    expect(api.patch.mock.calls[0][1].high_pain).toBe(8);
  });

  it('ClinicalCatalog edita un protocolo', async () => {
    const procedure = {
      id: 4, code: 'COD-1', name: 'Exodoncia', complexity: 'high', complexity_label: 'Compleja',
      specialty: 'cirugia', specialty_label: 'Cirugía oral', monitoring_days: 5, follow_up_unit: 'days',
      checkin_every_days: 1, expected_curve: [7, 5], expected_symptoms: { Sangrado: 1 }, alarm_symptoms: [],
      care_items: ['Frío local'], follow_up_questions: { '*': ['¿Cómo estás?'] },
      default_phases: [{ name: 'Cicatrización', days: 7, description: '' }],
    };
    mockGet({
      '/procedures/': page([procedure]), '/medication-guides/': page([]),
      '/nlp/vocabulary/': { symptoms: ['Dolor', 'Sangrado', 'Fiebre'], care: [] },
    });
    api.patch.mockResolvedValue({ data: procedure });
    renderAt(<ClinicalCatalog />);
    fireEvent.click(await screen.findByRole('button', { name: /COD-1/ }));
    // Ajusta la ventana del sangrado, marca la fiebre como alarma y añade un cuidado.
    fireEvent.change(screen.getByLabelText('Último día esperado'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Fiebre'));
    fireEvent.change(screen.getByLabelText('Cuidados diarios'), { target: { value: 'Frío local\nDieta blanda' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar protocolo' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Protocolo guardado');
    const payload = api.patch.mock.calls[0][1];
    expect(payload.expected_curve).toEqual([7, 5]);
    expect(payload.expected_symptoms).toEqual({ Sangrado: 2 });
    expect(payload.alarm_symptoms).toEqual(['Fiebre']);
    expect(payload.care_items).toEqual(['Frío local', 'Dieta blanda']);
    expect(payload.follow_up_questions).toEqual({ '*': ['¿Cómo estás?'] });
    expect(payload.default_phases).toEqual([{ name: 'Cicatrización', days: 7, description: '' }]);
  });
});
