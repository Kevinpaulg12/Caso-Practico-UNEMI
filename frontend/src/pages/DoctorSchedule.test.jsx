import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { renderAt } from '../test/utils';
import DoctorSchedule from './DoctorSchedule';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn(), user: { full_name: 'Laura Mora' } }) }));

const schedule = { slot_minutes: 30, max_days_ahead: 30, published: true, hours: [{ weekday: 0, start: '08:00', end: '12:00' }] };
const agenda = { appointments: [], time_off: [], free_slots_per_day: {} };

function isoToday(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function mockApi(overrides = {}) {
  const routes = { '/doctor/schedule/': schedule, '/doctor/time-off/': [], '/doctor/agenda/': agenda, ...overrides };
  api.get.mockImplementation(async (url) => {
    if (url === '/me/') return { data: {} };
    if (url in routes) return { data: routes[url] };
    throw new Error(url);
  });
}

describe('Mi horario', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
    mockApi();
  });

  it('activa días con jornadas de un clic, copia el lunes y guarda el horario', async () => {
    api.put.mockImplementation(async (url, body) => ({ data: { ...body, published: true } }));
    renderAt(<DoctorSchedule />);
    const form = await screen.findByRole('form', { name: 'Cuándo atiendes' });
    const save = within(form).getByRole('button', { name: 'Guardar horario' });
    // El lunes guardado se reconoce como «Mañana»; sin cambios no hay nada que guardar.
    expect(within(within(form).getByRole('group', { name: 'Jornada del lunes' })).getByRole('button', { name: 'Mañana' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form).getByRole('switch', { name: 'Atiende el martes' })).toHaveAttribute('aria-checked', 'false');
    expect(save).toBeDisabled();

    fireEvent.click(within(within(form).getByRole('group', { name: 'Jornada del lunes' })).getByRole('button', { name: 'Todo el día' }));
    fireEvent.click(within(form).getByRole('button', { name: /Copiar el lunes/ }));
    // El sábado: se activa y se elige solo la mañana.
    fireEvent.click(within(form).getByRole('switch', { name: 'Atiende el sábado' }));
    fireEvent.click(within(within(form).getByRole('group', { name: 'Jornada del sábado' })).getByRole('button', { name: 'Mañana' }));
    fireEvent.click(within(within(form).getByRole('group', { name: 'Duración de cada turno' })).getByRole('button', { name: '45 min' }));
    fireEvent.click(within(within(form).getByRole('group', { name: 'Reservas con anticipación' })).getByRole('button', { name: '2 semanas' }));
    expect(within(form).getByText('Tienes cambios sin guardar.')).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const body = api.put.mock.calls[0][1];
    expect(body.slot_minutes).toBe(45);
    expect(body.max_days_ahead).toBe(14);
    const full = (weekday) => [{ weekday, start: '08:00', end: '12:00' }, { weekday, start: '14:00', end: '18:00' }];
    expect(body.hours).toEqual([...full(0), ...full(1), ...full(2), ...full(3), ...full(4), { weekday: 5, start: '08:00', end: '12:00' }]);
    expect(await screen.findByText(/los pacientes ya pueden reservar tus turnos libres/)).toBeInTheDocument();
  });

  it('«Otro» permite escribir las horas de un día', async () => {
    api.put.mockImplementation(async (url, body) => ({ data: { ...body, published: true } }));
    renderAt(<DoctorSchedule />);
    const form = await screen.findByRole('form', { name: 'Cuándo atiendes' });
    fireEvent.click(within(within(form).getByRole('group', { name: 'Jornada del lunes' })).getByRole('button', { name: 'Otro' }));
    fireEvent.change(within(form).getByLabelText('Lunes: hasta'), { target: { value: '13:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar horario' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1].hours).toEqual([{ weekday: 0, start: '08:00', end: '13:00' }]);
  });

  it('bloquear mañana con citas pide confirmación y avisa cuántas se cancelaron', async () => {
    const tomorrow = isoToday(1);
    api.get.mockImplementation(async (url) => {
      if (url === '/doctor/time-off/preview/') return { data: { appointments: [{ id: 7, patient_name: 'Juan', starts_at: `${tomorrow}T08:30:00-05:00` }] } };
      return { data: { '/doctor/schedule/': schedule, '/doctor/time-off/': [], '/doctor/agenda/': agenda }[url] ?? {} };
    });
    api.post.mockResolvedValue({ data: { id: 3, date: tomorrow, all_day: false, start: '13:00:00', end: '22:00:00', reason: 'Congreso', cancelled_appointments: 1 } });
    renderAt(<DoctorSchedule />);
    const section = await screen.findByRole('region', { name: 'No puedo atender' });
    expect(within(within(section).getByRole('group', { name: 'Qué día' })).getByRole('button', { name: 'Mañana' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(within(section).getByRole('group', { name: 'Qué parte del día' })).getByRole('button', { name: 'Tarde' }));
    fireEvent.change(within(section).getByLabelText(/Motivo/), { target: { value: 'Congreso' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Bloquear' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Se cancelarán 1 cita' });
    expect(dialog).toHaveTextContent('Juan');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bloquear y avisar' }));
    expect(await within(section).findByRole('status')).toHaveTextContent('Se cancelaron 1 cita y se avisó a cada paciente.');
    expect(api.post).toHaveBeenCalledWith('/doctor/time-off/', { date: tomorrow, reason: 'Congreso', start: '13:00', end: '22:00' });
    expect(within(section).getByRole('list', { name: 'Bloqueos próximos' })).toHaveTextContent('Tarde · Congreso');
  });

  it('«Otro día» exige elegir la fecha', async () => {
    renderAt(<DoctorSchedule />);
    const section = await screen.findByRole('region', { name: 'No puedo atender' });
    fireEvent.click(within(within(section).getByRole('group', { name: 'Qué día' })).getByRole('button', { name: 'Otro día' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Bloquear' }));
    expect(within(section).getByRole('alert')).toHaveTextContent('Elige el día que no podrás atender.');
    expect(api.get).not.toHaveBeenCalledWith('/doctor/time-off/preview/', expect.anything());
  });

  it('la semana muestra las citas del día elegido', async () => {
    const tomorrow = isoToday(1);
    mockApi({
      '/doctor/agenda/': {
        appointments: [{ id: 1, patient: 5, patient_name: 'Ana Ruiz', starts_at: `${tomorrow}T09:00:00`, kind: 'assessment', status: 'booked' }],
        time_off: [],
        free_slots_per_day: { [isoToday()]: 4, [tomorrow]: 3 },
      },
    });
    renderAt(<DoctorSchedule />);
    const week = await screen.findByRole('region', { name: 'Tu semana' });
    expect(await within(week).findByText('Sin citas · 4 turnos libres')).toBeInTheDocument();
    const days = within(within(week).getByRole('group', { name: 'Días de la semana' })).getAllByRole('button');
    expect(days).toHaveLength(7);
    fireEvent.click(days[1]);
    expect(days[1]).toHaveAttribute('aria-pressed', 'true');
    expect(within(week).getByRole('list')).toHaveTextContent('Ana Ruiz');
    expect(within(week).getByRole('list')).toHaveTextContent('Valoración');
    expect(screen.getByRole('region', { name: 'Estado de tu agenda' })).toHaveTextContent('1');
    // Desde la semana se abre la historia clínica o se cancela la cita con un motivo.
    expect(within(week).getByRole('link', { name: 'Ver la historia clínica de Ana Ruiz' })).toHaveAttribute('href', '/panel-doctor/pacientes/5/historia');
    api.post.mockResolvedValue({ data: {} });
    fireEvent.click(within(week).getByRole('button', { name: 'Cancelar la cita de Ana Ruiz' }));
    const dialog = screen.getByRole('alertdialog', { name: '¿Cancelar la cita de Ana Ruiz?' });
    fireEvent.change(within(dialog).getByLabelText(/Motivo para el paciente/), { target: { value: 'Emergencia' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar la cita' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/appointment-requests/1/cancel/', { reason: 'Emergencia' }));
  });

  it('sin horario publicado avisa que nadie puede reservar', async () => {
    mockApi({ '/doctor/schedule/': { ...schedule, hours: [], published: false } });
    renderAt(<DoctorSchedule />);
    expect(await screen.findByText(/los pacientes no pueden reservar contigo/)).toBeInTheDocument();
  });
});
