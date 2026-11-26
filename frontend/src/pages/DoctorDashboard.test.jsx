import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { page, renderAt } from '../test/utils';
import DoctorDashboard from './DoctorDashboard';

vi.mock('../services/api', () => ({ default: { get: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

const patient = (id, full_name, risk_level = 'Sin seguimiento', extra = {}) => ({
  id, full_name, username: `p${id}`, national_id: `1000000${id}`, risk_level,
  has_active_treatment: false, latest_report: null, age: 30, ...extra,
});
const ana = patient(1, 'Ana Ruiz', 'Alto', { latest_report: { pain_level: 9 }, has_active_treatment: true });
const beto = patient(2, 'Beto Paz', 'Bajo', { latest_report: { pain_level: 2 } });

const anaReport = {
  id: 7, pain_level: 9, postoperative_day: 2, alert_color: 'rojo', created_at: '2026-10-30T10:00:00Z',
  alert_reasons: ['Dolor EVA 9 (umbral de riesgo alto: 7)'], message: 'Me duele mucho',
  extracted_entities: [{ text: 'duele', label: 'SINTOMA', category: 'Dolor', intensity: 'alta', negated: false }],
};
const anaPlan = {
  id: 3, is_active: true, procedure: 'Exodoncia', surgery_date: '2026-10-28', postoperative_day: 2,
  procedure_detail: { name: 'Exodoncia', monitoring_days: 3, expected_curve: [7, 5, 3, 1] },
};

const betoPlans = [
  { id: 8, is_active: true, title: 'Ibuprofeno', medication_name: 'Ibuprofeno', strength: '400 mg', dosage_form: 'Tableta', frequency: 'Cada 8 horas', duration: '3 días', procedure: 'Endodoncia', surgery_date: '2026-11-04', postoperative_day: 2, created_at: '2026-11-04T10:00:00Z' },
  { id: 5, is_active: false, title: 'Paracetamol', medication_name: 'Paracetamol', procedure: 'Exodoncia', surgery_date: '2026-09-01', postoperative_day: 66, created_at: '2026-09-01T10:00:00Z' },
];

function mock({ patients = [ana, beto], search = {} } = {}) {
  api.get.mockImplementation(async (url, config) => {
    if (url === '/me/') return { data: { full_name: 'Dra. Laura' } };
    if (url === '/patient-reports/') return { data: page(config.params.patient === 1 ? [anaReport] : []) };
    if (url === '/treatment-plans/') return { data: page({ 1: [anaPlan], 2: betoPlans }[config.params.patient] ?? []) };
    if (url === '/patients/') {
      const term = config?.params?.search;
      return { data: term ? (search[term] ?? []) : patients };
    }
    throw new Error(url);
  });
}

describe('Panel del doctor', () => {
  beforeEach(() => { api.get.mockReset(); });

  it('muestra el total, las alertas y selecciona al primero', async () => {
    mock();
    renderAt(<DoctorDashboard />);
    expect(await screen.findByText('2 pacientes')).toBeInTheDocument();
    expect(screen.getByText('1 alerta crítica')).toBeInTheDocument();
    expect(screen.getByText(/Riesgo Alto Detectado/)).toBeInTheDocument();
    expect(await screen.findByText(/Alerta roja · EVA 9/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Dolor EVA 9/)).toBeInTheDocument();
    expect(screen.getByText('Dolor (alta)')).toBeInTheDocument();
  });

  it('cambiar de paciente actualiza la ficha y sus tratamientos', async () => {
    mock();
    renderAt(<DoctorDashboard />);
    await screen.findByText('2 pacientes');
    expect(screen.queryByText('Ibuprofeno')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Beto Paz/ }));
    expect(await screen.findByText('Ibuprofeno')).toBeInTheDocument();
    expect(screen.queryByText(/Riesgo Alto Detectado/)).toBeNull();
    expect(screen.getByText('1 vigente · 2 en total')).toBeInTheDocument();
    // El vigente va primero y se puede editar; el cerrado solo muestra su historial.
    const links = screen.getAllByRole('link', { name: /Ver historial|Editar tratamiento/ }).map((link) => link.getAttribute('href'));
    expect(links).toEqual(['/panel-doctor/tratamientos/8', '/panel-doctor/tratamientos/8?editar=1', '/panel-doctor/tratamientos/5']);
  });

  it('la búsqueda del panel se limita a pacientes en tratamiento activo', async () => {
    mock({ search: { beto: [beto] } });
    renderAt(<DoctorDashboard />);
    await screen.findByText('2 pacientes');
    fireEvent.change(screen.getByPlaceholderText(/Tus pacientes/), { target: { value: 'beto' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/patients/', { params: { search: 'beto', active: 'true' } }));
  });

  it('tras el alta el paciente sale de la lista y se avisa cuántos tratamientos se cerraron', async () => {
    mock();
    api.post = vi.fn().mockImplementation(async () => {
      mock({ patients: [beto] });
      return { data: { plans_closed: 2, prescriptions_closed: 2 } };
    });
    renderAt(<DoctorDashboard />);
    await screen.findByText('2 pacientes');
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de alta' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Alta registrada para Ana Ruiz: se cerraron sus 2 tratamientos');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('1 paciente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana Ruiz/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /Beto Paz/ })).toBeInTheDocument();
  });

  it.each([
    ['Alto', true, 'Rojo · riesgo alto'],
    ['Medio', true, 'Amarillo · en observación'],
    ['Bajo', true, 'Verde · estable'],
    ['Sin seguimiento', true, 'Pendiente de reporte'],
    ['Sin seguimiento', false, 'Sin tratamiento'],
  ])('riesgo %s con tratamiento %s se rotula %s', async (risk, active, label) => {
    mock({ patients: [patient(1, 'Ana', risk, { has_active_treatment: active })] });
    renderAt(<DoctorDashboard />);
    await screen.findByText('1 paciente');
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('busca en el servidor y muestra el vacío', async () => {
    mock({ search: { beto: [beto] } });
    renderAt(<DoctorDashboard />);
    await screen.findByText('2 pacientes');
    const input = screen.getByPlaceholderText(/Tus pacientes/);
    fireEvent.change(input, { target: { value: 'beto' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Ana Ruiz/ })).toBeNull());
    expect(screen.getByRole('button', { name: /Beto Paz/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'nadie' } });
    expect(await screen.findByText(/No se encontraron pacientes/)).toBeInTheDocument();
  });

  it('da de alta tras confirmar en una ventana propia, no en la del navegador', async () => {
    mock();
    api.post = vi.fn().mockResolvedValue({ data: {} });
    const nativeConfirm = vi.spyOn(window, 'confirm');
    renderAt(<DoctorDashboard />);
    await screen.findByText('2 pacientes');
    const trigger = screen.getByRole('button', { name: 'Dar de alta' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: '¿Dar de alta a Ana Ruiz?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('podrá pedir una cita');
    // El foco empieza en la opción segura; Escape cierra sin dar de alta y devuelve el foco.
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de alta' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Alta registrada');
    expect(api.post).toHaveBeenCalledWith('/patients/1/discharge/');
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('sin pacientes pide seleccionar uno', async () => {
    mock({ patients: [] });
    renderAt(<DoctorDashboard />);
    expect(await screen.findByText('Ningún paciente seleccionado')).toBeInTheDocument();
  });

  it('BUG-35 un fallo de la API no se presenta como "Todos estables"', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    renderAt(<DoctorDashboard />);
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
    expect(screen.queryByText('Sin alertas')).toBeNull();
  });

  it('BUG-54 el total en seguimiento no cambia al buscar', async () => {
    mock({ search: { beto: [beto] } });
    renderAt(<DoctorDashboard />);
    await screen.findByText('2 pacientes');
    fireEvent.change(screen.getByPlaceholderText(/Tus pacientes/), { target: { value: 'beto' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Ana Ruiz/ })).toBeNull());
    expect(screen.getByText('2 pacientes')).toBeInTheDocument();
  });

  it('BUG-55 "1 paciente" en singular', async () => {
    mock({ patients: [beto] });
    renderAt(<DoctorDashboard />);
    expect(await screen.findByText('1 paciente')).toBeInTheDocument();
  });

  it('HU03 CA02: al elegir un paciente se muestra su historial por día postoperatorio', async () => {
    mock();
    renderAt(<DoctorDashboard />);
    await screen.findByText(/Alerta roja · EVA 9/);
    expect(screen.getByText(/hoy es el día 2/)).toBeInTheDocument();
    const rows = [...document.querySelectorAll('details tbody tr')].map((row) => row.textContent);
    expect(rows).toEqual(['0—7—', '1—5—', '293Alerta roja', '3—1—']);
    fireEvent.click(screen.getByRole('button', { name: /Beto Paz/ }));
    expect(await screen.findByText('Este paciente aún no ha enviado autorreportes.')).toBeInTheDocument();
  });

  it('el refresco automático no cuenta como actividad del usuario (RNF01)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock();
    renderAt(<DoctorDashboard />);
    await screen.findByText('2 pacientes');
    await vi.advanceTimersByTimeAsync(60000);
    const polls = api.get.mock.calls.filter(([url, config]) => url === '/patients/' && config?.headers);
    expect(polls[0][1].headers['X-Background-Request']).toBe('1');
    vi.useRealTimers();
  });
});
