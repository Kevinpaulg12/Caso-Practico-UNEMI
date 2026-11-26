import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { renderAt } from '../test/utils';
import ClinicalHistory from './ClinicalHistory';

vi.mock('../services/api', () => ({ default: { get: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

const history = {
  patient: { id: 3, full_name: 'Ana López', national_id: '1712345678', age: 30, primary_doctor: 'Laura Mora' },
  summary: { treatments: 2, active_treatments: 1, dentists: ['Pedro Ruiz', 'Laura Mora'], frequent_symptoms: [{ label: 'Dolor', days: 2 }] },
  medications: [{ name: 'Amoxicilina', strength: '500 mg', frequency: 'Cada 8 horas', duration: '7 días', date: '2026-05-01T10:00:00Z',
    doctor: 'Laura Mora', treatment: 'Exodoncia simple', treatment_id: 1, is_active: false, red_alerts_in_treatment: 1 }],
  treatments: [
    { plan: { id: 2, procedure: 'Ortodoncia con brackets', specialty_label: 'Ortodoncia', surgery_date: '2026-10-18', is_active: true, teeth: [],
      clinical_data_display: [{ label: 'Tipo de aparato', value: 'Brackets metálicos' }] },
      dentists: ['Pedro Ruiz'], outcome: { days_with_followup: 0, max_pain: null, last_pain: null, red_alerts: 0, yellow_alerts: 0 },
      events: [{ type: 'control', date: '2026-11-15T12:00:00-05:00', title: 'Control realizado', notes: 'Cambio de arco', clinical_data: [], next_control_in_days: 28, author: 'Pedro Ruiz' }] },
    { plan: { id: 1, procedure: 'Exodoncia simple', specialty_label: 'Cirugía oral', surgery_date: '2026-05-01', is_active: false, teeth: [38], clinical_data_display: [] },
      dentists: ['Laura Mora'], outcome: { days_with_followup: 1, max_pain: 9, last_pain: 9, red_alerts: 1, yellow_alerts: 0 }, events: [] },
  ],
};

const show = () => renderAt(<Routes><Route path="/panel-doctor/pacientes/:patientId/historia" element={<ClinicalHistory />} /></Routes>, '/panel-doctor/pacientes/3/historia');

describe('Historia clínica compartida', () => {
  beforeEach(() => api.get.mockReset());

  it('muestra todos los tratamientos con quien los atendió y la medicación previa', async () => {
    api.get.mockResolvedValue({ data: history });
    show();
    expect(await screen.findByRole('heading', { name: 'Ana López' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/patients/3/clinical-history/');
    expect(screen.getByText('Pedro Ruiz, Laura Mora')).toBeInTheDocument();
    expect(screen.getByText('2 (1 en curso)')).toBeInTheDocument();
    const medication = screen.getByRole('region', { name: 'Medicación recetada' });
    expect(within(medication).getByRole('row', { name: /Amoxicilina/ })).toHaveTextContent('Laura Mora1');
    const treatments = within(screen.getByRole('list', { name: 'Tratamientos del paciente' })).getAllByRole('article');
    expect(treatments.map((item) => within(item).getByRole('heading').textContent)).toEqual(['Ortodoncia con brackets', 'Exodoncia simple']);
    expect(treatments[1]).toHaveTextContent('Alertas rojas:1');
    expect(treatments[0]).toHaveTextContent('Tipo de aparato:Brackets metálicos');
    expect(within(treatments[1]).getByRole('img', { name: 'Arcada inferior: 38' })).toBeInTheDocument();
    fireEvent.click(within(treatments[0]).getByText(/Ver la línea de tiempo/));
    expect(within(treatments[0]).getByRole('list', { name: /Línea de tiempo de Ortodoncia/ })).toHaveTextContent('Cambio de arco');
    expect(within(treatments[0]).getByRole('link', { name: /Abrir el tratamiento en curso/ })).toHaveAttribute('href', '/panel-doctor/tratamientos/2');
  });

  it('informa si el paciente no existe', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/patients/3/clinical-history/') throw Object.assign(new Error('404'), { response: { status: 404 } });
      return { data: {} };
    });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Este paciente no existe.');
  });
});
