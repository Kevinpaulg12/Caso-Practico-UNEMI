import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../services/api';
import { setClinicClock } from '../../services/consultationRules';
import { page } from '../../test/utils';
import ConsultationForm from './ConsultationForm';
import ControlForm from './ControlForm';

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

// PF22: el navegador está en UTC (ya es 20/11) y el consultorio en Ecuador (aún es 19/11, 22:01).
const NOW = new Date('2026-11-20T03:01:00Z');
const field = (container, name) => container.querySelector(`[name=${name}]`);

describe('PF22: fechas del formulario según el consultorio', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setClinicClock({ clinic_timezone: 'America/Guayaquil', clinic_today: '2026-11-19' });
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockImplementation(async (url) => (url === '/procedures/'
      ? { data: page([{ id: 4, name: 'Exodoncia simple' }]) }
      : { data: { items: [], message: '' } }));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
    setClinicClock(null);
  });

  it('la consulta propone y limita la fecha de intervención al día del consultorio', async () => {
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await screen.findByRole('option', { name: 'Exodoncia simple' });
    expect(field(container, 'surgery_date')).toHaveValue('2026-11-19');
    expect(field(container, 'surgery_date')).toHaveAttribute('max', '2026-11-19');

    // La fecha del navegador (20/11) es futura para el consultorio: el cliente la rechaza igual que la API.
    fireEvent.change(field(container, 'admission_reason'), { target: { value: 'Dolor agudo' } });
    fireEvent.change(field(container, 'clinical_procedure'), { target: { value: '4' } });
    fireEvent.change(field(container, 'surgery_date'), { target: { value: '2026-11-20' } });
    fireEvent.submit(screen.getByRole('button', { name: /Guardar consulta/ }).closest('form'));
    expect(screen.getByText(/fecha de intervención que no sea futura/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('el control propone y limita la fecha al día del consultorio', () => {
    const plan = { id: 2, title: 'Exodoncia', procedure: 'Exodoncia', surgery_date: '2026-11-01', procedure_detail: null };
    const { container } = render(<ControlForm plan={plan} onSaved={() => {}} onCancel={() => {}} />);
    expect(field(container, 'date')).toHaveValue('2026-11-19');
    expect(field(container, 'date')).toHaveAttribute('max', '2026-11-19');

    fireEvent.change(field(container, 'date'), { target: { value: '2026-11-20' } });
    fireEvent.submit(screen.getByRole('button', { name: /Guardar control/ }).closest('form'));
    expect(screen.getByText(/fecha de control que no sea futura/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
