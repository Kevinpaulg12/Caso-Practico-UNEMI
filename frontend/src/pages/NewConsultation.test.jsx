import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { renderAt } from '../test/utils';
import NewConsultation from './NewConsultation';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

const search = (value) => {
  fireEvent.change(screen.getByPlaceholderText(/1723456789/), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar ficha' }));
};
const mockSearch = (patients) => api.get.mockImplementation(async (url) => (url === '/me/' ? { data: {} } : { data: patients }));

function fillNew(container, overrides = {}) {
  const values = {
    first_name: 'Ana', last_name: 'López', birth_date: '1990-01-01',
    phone: '0991234567', emergency_contact: '0987654321', ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(container.querySelector(`[name=${name}]`), { target: { value } });
  }
  fireEvent.submit(container.querySelector('[name=first_name]').closest('form'));
}

describe('Nueva consulta', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('una cédula incompleta o una sola letra no se buscan', () => {
    mockSearch([]);
    renderAt(<NewConsultation />);
    search('1234');
    expect(screen.getByText('Escribe entre 8 y 20 números.')).toBeInTheDocument();
    search('a');
    expect(screen.getByText(/al menos 2 letras/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/patients/', expect.anything());
  });

  it('busca por nombre mientras se escribe y deja elegir al paciente', async () => {
    mockSearch([
      { id: 1, full_name: 'Ana Ruiz', national_id: '12345678', age: 30, has_active_treatment: true },
      { id: 2, full_name: 'Ana Mora', national_id: '87654321', age: 41, has_active_treatment: false },
    ]);
    renderAt(<NewConsultation />);
    const input = screen.getByRole('searchbox', { name: /Nombres, apellidos o cédula/ });
    // Varias teclas seguidas producen una sola petición (debounce).
    for (const value of ['a', 'an', 'ana']) fireEvent.change(input, { target: { value } });
    const list = await screen.findByRole('list', { name: 'Pacientes encontrados' });
    const searches = api.get.mock.calls.filter(([url]) => url === '/patients/');
    expect(searches).toHaveLength(1);
    expect(searches[0][1].params).toEqual({ search: 'ana' });
    expect(list).toHaveTextContent('Ana Mora');
    fireEvent.click(screen.getByRole('button', { name: /Ana Ruiz/ }));
    expect(screen.getByRole('heading', { name: 'Registrar tratamiento' })).toBeInTheDocument();
    expect(screen.getByText(/C\.I\. 12345678/)).toBeInTheDocument();
  });

  it('avisa si el nombre no coincide con ningún paciente propio', async () => {
    mockSearch([]);
    renderAt(<NewConsultation />);
    search('zoila');
    expect(await screen.findByText(/No encontramos pacientes tuyos con ese nombre/)).toBeInTheDocument();
  });

  it('un paciente existente pasa al paso 2', async () => {
    mockSearch([{ id: 1, full_name: 'Ana Ruiz', national_id: '12345678', age: 30 }]);
    renderAt(<NewConsultation />);
    search('12345678');
    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Registrar tratamiento' })).toBeInTheDocument();
  });

  it('con un tratamiento en curso ofrece registrar el control en lugar de repetir la consulta', async () => {
    const plan = {
      id: 8, is_active: true, title: 'Ortodoncia con brackets', procedure: 'Ortodoncia con brackets', surgery_date: '2026-10-01',
      procedure_detail: { name: 'Ortodoncia con brackets', control_every_days: 28, consultation_fields: [] },
    };
    api.get.mockImplementation(async (url) => {
      if (url === '/treatment-plans/') return { data: { results: [{ ...plan, id: 3, is_active: false }, plan] } };
      if (url === '/procedures/') return { data: { count: 0, next: null, results: [] } };
      return { data: url === '/me/' ? {} : [{ id: 1, full_name: 'Ana Ruiz', national_id: '12345678', age: 30, has_active_treatment: true }] };
    });
    api.post.mockResolvedValue({ data: { control: { id: 1 }, treatment: { ...plan, next_control: { date: '2026-12-15', days_left: 28, overdue: false } } } });
    renderAt(<NewConsultation />);
    search('12345678');
    expect(await screen.findByRole('heading', { name: 'Registrar control del tratamiento' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/treatment-plans/', { params: { patient: 1 } });
    expect(screen.getByRole('button', { name: 'Control de ortodoncia con brackets' })).toHaveAttribute('aria-pressed', 'true');
    // Un control no obliga a recetar: no hay campos de medicación hasta que el odontólogo los pide.
    expect(screen.queryByLabelText('Medicamento')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar control' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Control registrado. El paciente recibirá el aviso para volver el martes, 15 de diciembre.');
    expect(api.post.mock.calls[0][0]).toBe('/treatment-plans/8/controls/');
    // También puede iniciar otro tratamiento distinto.
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar otro tratamiento' }));
    expect(screen.getByRole('heading', { name: 'Registrar tratamiento' })).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo de consulta')).toBeInTheDocument();
  });

  it('una coincidencia parcial no se toma como el paciente', async () => {
    mockSearch([{ id: 1, full_name: 'Otro', national_id: '123456789' }]);
    renderAt(<NewConsultation />);
    search('12345678');
    expect(await screen.findByText(/No encontramos una ficha/)).toBeInTheDocument();
  });

  it.each([
    [401, /sesión ya no es válida/],
    [403, /no tiene permiso/],
    [500, /servidor no respondió/],
  ])('informa del error %s al buscar', async (code, message) => {
    api.get.mockImplementation(async (url) => {
      if (url === '/me/') return { data: {} };
      throw Object.assign(new Error('http'), { response: { status: code } });
    });
    renderAt(<NewConsultation />);
    search('12345678');
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('crea la ficha y muestra las credenciales', async () => {
    mockSearch([]);
    api.post.mockResolvedValue({ data: { id: 3, username: 'paciente.12345678', full_name: 'Ana López', temporary_password: 'Temp-1' } });
    const { container } = renderAt(<NewConsultation />);
    search('12345678');
    await screen.findByText(/No encontramos/);
    fillNew(container);
    expect(await screen.findByText('Temp-1')).toBeInTheDocument();
    expect(api.post.mock.calls[0][1]).toMatchObject({ national_id: '12345678', first_name: 'Ana' });
    fireEvent.click(screen.getByText('Ocultar credenciales'));
    expect(screen.queryByText('Temp-1')).toBeNull();
  });

  it('valida los datos antes de crear la ficha', async () => {
    mockSearch([]);
    const { container } = renderAt(<NewConsultation />);
    search('12345678');
    await screen.findByText(/No encontramos/);
    fillNew(container, { first_name: 'A1', birth_date: '2999-01-01', phone: '12' });
    expect(screen.getByText(/nombres válidos/)).toBeInTheDocument();
    expect(screen.getByText(/fecha de nacimiento no es válida/)).toBeInTheDocument();
    expect(screen.getByText('Escribe un teléfono válido.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('muestra los errores de la API por campo', async () => {
    mockSearch([]);
    api.post.mockRejectedValue({ response: { data: { national_id: ['Ya existe un paciente con esta identificación.'] } } });
    const { container } = renderAt(<NewConsultation />);
    search('12345678');
    await screen.findByText(/No encontramos/);
    fillNew(container);
    expect(await screen.findByText(/Ya existe un paciente/)).toBeInTheDocument();
  });

  it('BUG-45 una ficha nueva no rompe la edad', async () => {
    mockSearch([]);
    api.post.mockResolvedValue({ data: { id: 3, username: 'u', full_name: 'Ana', temporary_password: 'T' } });
    const { container } = renderAt(<NewConsultation />);
    search('12345678');
    await screen.findByText(/No encontramos/);
    fillNew(container);
    await screen.findByText('Credenciales temporales del paciente');
    expect(screen.queryByText(/Edad no registrada años/)).toBeNull();
  });

  it('Consulta médica: el registro de pacientes se abre sin buscar y muestra la edad', async () => {
    mockSearch([]);
    api.post.mockResolvedValue({ data: { id: 3, username: 'u', full_name: 'Ana López', temporary_password: 'T' } });
    const { container } = renderAt(<NewConsultation />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Consulta médica');
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar paciente nuevo' }));
    fireEvent.change(container.querySelector('[name=birth_date]'), { target: { value: '2000-01-01' } });
    expect(screen.getByText(/Edad calculada:/)).toHaveTextContent(/\d+ años/);
    // El consentimiento ya no lo marca el médico: lo da el paciente en su primer acceso.
    expect(container.querySelector('[type=checkbox]')).toBeNull();
    expect(screen.getByText(/el propio paciente leerá y aceptará los Términos/)).toBeInTheDocument();
    fillNew(container, { national_id: '12345678' });
    expect(await screen.findByText('Credenciales temporales del paciente')).toBeInTheDocument();
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('consent');
  });

  it('el antiguo enlace «Nuevo paciente» abre el registro directamente', () => {
    mockSearch([]);
    const { container } = renderAt(<NewConsultation />, '/panel-doctor/consulta-medica?registro=1');
    expect(container.querySelector('[name=first_name]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(container.querySelector('[name=first_name]')).toBeNull();
  });

  it('BUG-47 acepta nombres con diacríticos no españoles', async () => {
    mockSearch([]);
    api.post.mockResolvedValue({ data: { id: 3, username: 'u', temporary_password: 'T' } });
    const { container } = renderAt(<NewConsultation />);
    search('12345678');
    await screen.findByText(/No encontramos/);
    fillNew(container, { last_name: 'Wiśniewska-Kowalczyk' });
    expect(screen.queryByText(/apellidos válidos/)).toBeNull();
  });
});
