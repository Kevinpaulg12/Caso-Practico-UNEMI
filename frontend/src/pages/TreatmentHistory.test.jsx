import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { renderAt } from '../test/utils';
import TreatmentHistory from './TreatmentHistory';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

const plan = {
  id: 8, is_active: true, title: 'Paracetamol', medication_name: 'Paracetamol', strength: '500 mg', dosage_form: 'Tableta',
  frequency: 'Cada 8 horas', duration: '3 días', instructions: 'Compresas frías 15 minutos.', side_effects: '', clinical_notes: '',
  procedure: 'Exodoncia simple', surgery_date: '2026-11-04', postoperative_day: 2,
  procedure_detail: { name: 'Exodoncia simple', expected_curve: [6, 4, 2] },
};
const events = [
  { type: 'start', date: '2026-11-04T10:00:00Z', title: 'Inicio del tratamiento', procedure: 'Exodoncia simple', surgery_date: '2026-11-04', admission_reason: 'Dolor en molar', clinical_notes: '' },
  { type: 'medication', date: '2026-11-04T10:00:01Z', title: 'Medicación recetada', prescription_id: 1, medication_name: 'Paracetamol', strength: '500 mg', frequency: 'Cada 8 horas', duration: '3 días', details: 'Paracetamol 500 mg', is_active: false, author: 'Laura Mendoza' },
  { type: 'report', date: '2026-11-05T09:00:00Z', title: 'Reporte del paciente', report_id: 4, pain_level: 7, alert_color: 'rojo', postoperative_day: 1, alert_reasons: ['Dolor EVA 7'], message: 'Me duele mucho', symptoms: [{ label: 'SINTOMA', category: 'Dolor', intensity: 'alta', negated: false }] },
  { type: 'change', date: '2026-11-05T11:00:00Z', title: 'Modificación', summary: 'Frecuencia: Cada 8 horas → Cada 6 horas', author: 'Laura Mendoza' },
  { type: 'medication', date: '2026-11-05T11:00:01Z', title: 'Medicación recetada', prescription_id: 2, medication_name: 'Paracetamol', strength: '500 mg', frequency: 'Cada 6 horas', duration: '3 días', details: '', is_active: true, author: 'Laura Mendoza' },
];
const history = (overrides = {}) => ({ plan: { ...plan, ...overrides }, patient: { id: 3, full_name: 'Ana Ruiz', national_id: '1712345678' }, events });

const timelineItems = () => within(screen.getByRole('list', { name: 'Línea de tiempo del tratamiento' })).getAllByRole('listitem');

function render(path = '/panel-doctor/tratamientos/8') {
  return renderAt(
    <Routes><Route path="/panel-doctor/tratamientos/:planId" element={<TreatmentHistory />} /></Routes>,
    path,
  );
}

describe('Historial del tratamiento', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.patch.mockReset();
    api.get.mockImplementation(async (url) => (url === '/me/' ? { data: {} } : { data: history() }));
  });

  it('une medicación, cambios y reportes en una línea de tiempo', async () => {
    render();
    expect(await screen.findByRole('heading', { level: 2, name: 'Paracetamol' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/treatment-plans/8/history/');
    expect(screen.getByText(/Ana Ruiz · HC-00003 · C.I. 1712345678/)).toBeInTheDocument();
    const items = timelineItems().map((item) => item.textContent);
    expect(items).toHaveLength(5);
    expect(items[0]).toContain('Motivo de consulta: Dolor en molar');
    expect(items[1]).toContain('Reemplazada');
    expect(items[2]).toContain('Alerta roja · EVA 7 · Día 1');
    expect(items[2]).toContain('Dolor (alta)');
    expect(items[3]).toContain('Frecuencia: Cada 8 horas → Cada 6 horas');
    expect(items[4]).toContain('Vigente');
  });

  it('filtra la línea de tiempo por tipo de evento', async () => {
    render();
    await screen.findByRole('heading', { level: 2, name: 'Paracetamol' });
    fireEvent.click(screen.getByRole('button', { name: 'Reportes' }));
    expect(timelineItems()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Medicación' }));
    expect(timelineItems()).toHaveLength(2);
  });

  it('edita el medicamento recetado enviando la receta como lista', async () => {
    api.patch.mockResolvedValue({ data: {} });
    const { container } = render('/panel-doctor/tratamientos/8?editar=1');
    await screen.findByText('Editar tratamiento en curso');
    // El medicamento vigente aparece plegado, con editar y eliminar.
    const card = screen.getByRole('region', { name: 'Medicamento 1' });
    expect(card).toHaveTextContent('Paracetamol 500 mg');
    fireEvent.click(within(card).getByRole('button', { name: 'Editar el medicamento 1: Paracetamol' }));
    fireEvent.change(container.querySelector('[name=frequency]'), { target: { value: 'Cada 6 horas' } });
    fireEvent.change(container.querySelector('[name=duration]'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body] = api.patch.mock.calls[0];
    expect(url).toBe('/treatment-plans/8/');
    expect(Object.keys(body)).toEqual(['medications']);
    expect(body.medications).toHaveLength(1);
    expect(body.medications[0]).toMatchObject({ medication_name: 'Paracetamol', strength: '500 mg', frequency: 'Cada 6 horas', duration: '5 días' });
    expect(await screen.findByRole('status')).toHaveTextContent('se emitió la receta nueva');
    await waitFor(() => expect(screen.queryByText('Editar tratamiento en curso')).toBeNull(), { timeout: 4000 });
  });

  it('añade otro medicamento al tratamiento en curso', async () => {
    api.patch.mockResolvedValue({ data: {} });
    const { container } = render('/panel-doctor/tratamientos/8?editar=1');
    await screen.findByText('Editar tratamiento en curso');
    fireEvent.click(screen.getByRole('button', { name: 'Añadir otro medicamento' }));
    const second = screen.getByRole('region', { name: 'Medicamento 2' });
    fireEvent.change(within(second).getByLabelText('Medicamento'), { target: { value: 'Ibuprofeno' } });
    const set = (name, value) => fireEvent.change(container.querySelector(`[name=${name}]`), { target: { value } });
    set('active_ingredient', 'Ibuprofeno');
    set('strength', '400 mg');
    set('dosage_form', 'Tableta');
    set('frequency', 'Cada 8 horas');
    set('duration', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1].medications.map((item) => item.medication_name)).toEqual(['Paracetamol', 'Ibuprofeno']);
  });

  it('sin cambios en la medicación no la envía; valida antes de enviar', async () => {
    const { container } = render('/panel-doctor/tratamientos/8?editar=1');
    await screen.findByText('Editar tratamiento en curso');
    fireEvent.click(screen.getByRole('button', { name: 'Añadir otro medicamento' }));
    fireEvent.change(within(screen.getByRole('region', { name: 'Medicamento 2' })).getByLabelText('Medicamento'), { target: { value: 'Ibuprofeno' } });
    fireEvent.change(container.querySelector('[name=instructions]'), { target: { value: 'corto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText(/entre 10 y 1000 caracteres/)).toBeInTheDocument();
    expect(screen.getByText('Selecciona una concentración.', { selector: 'span' })).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('muestra los errores del servidor en el medicamento', async () => {
    api.patch.mockRejectedValue({ response: { data: { medications: [{ strength: ['Indica la concentración.'] }] } } });
    const { container } = render('/panel-doctor/tratamientos/8?editar=1');
    await screen.findByText('Editar tratamiento en curso');
    fireEvent.click(screen.getByRole('button', { name: 'Editar el medicamento 1: Paracetamol' }));
    fireEvent.change(container.querySelector('[name=frequency]'), { target: { value: 'Cada 6 horas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Indica la concentración.')).toBeInTheDocument();
  });

  it('un tratamiento cerrado no se puede editar', async () => {
    api.get.mockImplementation(async (url) => (url === '/me/' ? { data: {} } : { data: history({ is_active: false }) }));
    render('/panel-doctor/tratamientos/8?editar=1');
    expect(await screen.findByText('Tratamiento cerrado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar tratamiento' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('no se puede modificar');
  });

  it('un tratamiento ajeno o inexistente se informa', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/me/') return { data: {} };
      throw Object.assign(new Error('404'), { response: { status: 404 } });
    });
    render('/panel-doctor/tratamientos/99');
    expect(await screen.findByText(/no existe o pertenece a un paciente que no atiendes/)).toBeInTheDocument();
  });
});

describe('Historial: fases, controles y cuidados', () => {
  const phases = [
    { id: 1, order: 1, name: 'Alineación', status: 'active', status_label: 'En curso', planned_days: 180, start_date: '2026-09-01' },
    { id: 2, order: 2, name: 'Retención', status: 'pending', status_label: 'Pendiente', planned_days: 365 },
  ];
  const longPlan = { ...plan, phases, teeth: [13, 23], specialty_label: 'Ortodoncia',
    next_control: { date: '2026-12-01', days_left: 12, overdue: false },
    clinical_data_display: [{ label: 'Tipo de aparato', value: 'Brackets metálicos' }],
    procedure_detail: {
      name: 'Ortodoncia con brackets', control_every_days: 28, expected_curve: [],
      consultation_fields: [
        { key: 'aparato', label: 'Tipo de aparato', type: 'select', options: ['Brackets metálicos'], required: true, en: ['inicio'] },
        { key: 'higiene', label: 'Higiene oral', type: 'select', options: ['Buena', 'Regular', 'Deficiente'], required: true, en: ['control'] },
      ],
    } };
  const longEvents = [
    ...events,
    { type: 'control', date: '2026-11-06T12:00:00-05:00', title: 'Control realizado', notes: 'Cambio de arco', next_control_in_days: 28, author: 'Laura',
      clinical_data: [{ label: 'Higiene oral', value: 'Regular' }] },
    { type: 'care', date: '2026-11-06T21:00:00Z', title: 'Cuidados del día', adherence: 50, missed: ['Usar elásticos'] },
    { type: 'summary', date: '2026-11-07T10:00:00Z', title: 'Resumen clínico (IA)', summary: 'Evolución favorable.', source: 'llm' },
  ];

  beforeEach(() => {
    api.get.mockReset();
    api.patch.mockReset();
    api.post = vi.fn();
    api.get.mockImplementation(async (url) => (url === '/me/' ? { data: {} }
      : { data: { plan: longPlan, patient: { id: 3, full_name: 'Ana Ruiz', national_id: '1712345678' }, events: longEvents } }));
  });

  it('muestra fases, piezas, próximo control y los nuevos eventos', async () => {
    render();
    expect(await screen.findByText('Fases del tratamiento')).toBeInTheDocument();
    expect(screen.getByText(/Control en 12 días/)).toHaveTextContent('martes, 1 de diciembre');
    expect(screen.getByText('Tipo de aparato:').closest('div')).toHaveTextContent('Brackets metálicos');
    expect(screen.getByText(/Piezas: 13: canino superior derecho/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Controles' }));
    const timeline = screen.getByRole('list', { name: 'Línea de tiempo del tratamiento' });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(1);
    expect(timeline).toHaveTextContent('Cambio de arco');
    expect(timeline).toHaveTextContent('Higiene oral:Regular');
    expect(timeline).toHaveTextContent('Debe volver en 28 días · Laura');
    // Un control solo tiene fecha: no se muestra una hora inventada.
    expect(within(timeline).getByText('6/11/2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cuidados' }));
    expect(screen.getByText(/Cumplió el 50 % de sus cuidados · faltó: Usar elásticos/)).toBeInTheDocument();
  });

  it('registra un control con los datos de su protocolo', async () => {
    api.post.mockResolvedValue({ data: { control: { id: 1 }, treatment: { ...longPlan, next_control: { date: '2026-12-15', days_left: 28, overdue: false } } } });
    render();
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar control' }));
    expect(screen.getByRole('heading', { name: 'Registrar control de ortodoncia con brackets' })).toBeInTheDocument();
    // Solo se piden los datos del control, no los del inicio del tratamiento.
    expect(screen.queryByLabelText('Tipo de aparato')).toBeNull();
    expect(screen.getByLabelText(/Próximo control/)).toHaveValue('28');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar control' }));
    expect(screen.getByText('Completa este dato.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Higiene oral/), { target: { value: 'Regular' } });
    fireEvent.change(screen.getByLabelText(/Notas del control/), { target: { value: 'Cambio de arco' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar control' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Control registrado. El paciente recibirá el aviso para volver el martes, 15 de diciembre.');
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/treatment-plans/8/controls/');
    expect(body).toMatchObject({ clinical_data: { higiene: 'Regular' }, notes: 'Cambio de arco', next_control_in_days: 28, prescribes_medication: false, advance_phase: false });
    expect(body).not.toHaveProperty('medication_name');
  });

  it('la fase avanza al registrar el control que la cierra, no con un botón aparte', async () => {
    api.post.mockResolvedValue({ data: { control: { id: 1 }, treatment: longPlan } });
    render();
    await screen.findByText('Fases del tratamiento');
    expect(screen.queryByRole('button', { name: /siguiente fase/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar control' }));
    fireEvent.change(screen.getByLabelText(/^Higiene oral/), { target: { value: 'Buena' } });
    fireEvent.click(screen.getByLabelText(/Este control completa la fase «Alineación» e inicia «Retención»/));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar control' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/treatment-plans/8/controls/');
    expect(body.advance_phase).toBe(true);
  });

  it('edita las piezas tratadas', async () => {
    api.patch.mockResolvedValue({ data: {} });
    render('/panel-doctor/tratamientos/8?editar=1');
    await screen.findByText('Editar tratamiento en curso');
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^11:/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/treatment-plans/8/', { teeth: [11, 13, 23] }));
  });
});
