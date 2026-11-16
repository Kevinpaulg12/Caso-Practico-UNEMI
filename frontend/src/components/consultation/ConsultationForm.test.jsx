import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../services/api';
import { page } from '../../test/utils';
import ConsultationForm from './ConsultationForm';

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const field = (container, name) => container.querySelector(`[name=${name}]`);

// El catálogo de cirugías siempre responde; el resto de GET es la búsqueda de medicamentos.
function mockGet(search) {
  api.get.mockImplementation(async (url) => {
    if (url === '/procedures/') return { data: page([{ id: 4, name: 'Exodoncia simple' }]) };
    if (search instanceof Error) throw search;
    return search;
  });
}

async function fill(container, overrides = {}) {
  await fillConsultation(container, overrides);
  const values = {
    active_ingredient: 'Paracetamol', strength: '500 mg', dosage_form: 'Tableta',
    frequency: 'Cada 8 horas', duration: '3', instructions: 'Tomar con abundante agua.',
    ...overrides,
  };
  fireEvent.change(screen.getByLabelText('Medicamento'), { target: { value: 'Paracetamol' } });
  for (const [name, value] of Object.entries(values)) {
    if (!(name in CONSULTATION)) fireEvent.change(field(container, name), { target: { value } });
  }
}

// Primer bloque: motivo, intervención y fecha.
const CONSULTATION = { admission_reason: 'Dolor agudo', clinical_procedure: '4', surgery_date: '2026-10-30' };

async function fillConsultation(container, overrides = {}) {
  await screen.findByRole('option', { name: 'Exodoncia simple' });
  for (const name of Object.keys(CONSULTATION)) {
    fireEvent.change(field(container, name), { target: { value: overrides[name] ?? CONSULTATION[name] } });
  }
}

// Envía el formulario aunque el botón esté desactivado, para comprobar la validación del cliente.
const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Guardar consulta/ }).closest('form'));

describe('ConsultationForm', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    mockGet({ data: { items: [], message: '' } });
  });

  it('el botón queda desactivado sin los datos mínimos', () => {
    render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    expect(screen.getByRole('button', { name: /Guardar consulta/ })).toBeDisabled();
  });

  it('la medicación y las indicaciones se habilitan tras registrar el motivo y la intervención', async () => {
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await screen.findByRole('option', { name: 'Exodoncia simple' });
    const medication = screen.getByRole('group', { name: /Medicación/ });
    const instructions = screen.getByRole('group', { name: /Indicaciones y próximo control/ });
    expect(medication).toBeDisabled();
    expect(instructions).toBeDisabled();
    expect(screen.getAllByText(/Se habilita cuando completes el motivo/)).toHaveLength(2);

    await fillConsultation(container);
    expect(medication).toBeEnabled();
    expect(instructions).toBeEnabled();
    expect(screen.getByText(/Receta para exodoncia simple del 30 de octubre de 2026/)).toBeInTheDocument();

    fireEvent.change(field(container, 'admission_reason'), { target: { value: '' } });
    expect(medication).toBeDisabled();
  });

  it('envía la consulta con el formato que espera la API', async () => {
    const onAdded = vi.fn();
    const onTreatment = vi.fn();
    api.post.mockResolvedValue({ data: { prescription: { id: 1 }, treatment: { id: 2 } } });
    const { container } = render(<ConsultationForm patientId={7} onPrescriptionAdded={onAdded} onTreatmentAdded={onTreatment} />);
    await fill(container);
    submit();
    await screen.findByText(/Consulta registrada/);
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/consultations/');
    expect(body).toMatchObject({ patient: 7, duration: '3 días', medication_name: 'Paracetamol', clinical_procedure: 4, surgery_date: '2026-10-30' });
    expect(body.details).toContain('Paracetamol 500 mg');
    expect(body.details).toContain('durante 3 días');
    expect(onAdded).toHaveBeenCalledWith({ id: 1 });
    expect(onTreatment).toHaveBeenCalledWith({ id: 2 });
    expect(field(container, 'instructions').value).toBe('');
  });

  it.each([
    ['clinical_procedure', '', /tratamiento o intervención/],
    ['admission_reason', 'abc', /motivo entre 5 y 240/],
    ['instructions', 'corto', /indicaciones entre 10 y 1000/],
    ['active_ingredient', 'x', /principio activo/],
  ])('valida %s en el cliente', async (name, value, message) => {
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fill(container, { [name]: value });
    submit();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('la duración solo admite dígitos y rechaza cero', async () => {
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fillConsultation(container);
    fireEvent.change(field(container, 'duration'), { target: { value: 'a1b2c34' } });
    expect(field(container, 'duration').value).toBe('123');
    await fill(container, { duration: '0' });
    submit();
    expect(screen.getByText(/entre 1 y 999/)).toBeInTheDocument();
  });

  it('muestra los errores de la API junto a su campo', async () => {
    api.post.mockRejectedValue({ response: { data: { procedure: ['Procedimiento rechazado'] } } });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fill(container);
    submit();
    expect(await screen.findByText('Procedimiento rechazado')).toBeInTheDocument();
    expect(screen.getByText(/No se pudo guardar la consulta/)).toBeInTheDocument();
  });

  it('busca en el catálogo y rellena el medicamento elegido', async () => {
    mockGet({ data: { message: '', items: [{ name: 'Ibuprofen 400 MG Oral Tablet', source: 'RxNav', strength: '400 MG', rxcui: '1' }] } });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fillConsultation(container);
    await userEvent.type(screen.getByLabelText('Medicamento'), 'ibu');
    fireEvent.click(await screen.findByRole('button', { name: /Ibuprofen 400 MG/ }));
    expect(field(container, 'active_ingredient').value).toBe('Ibuprofen');
  });

  it('BUG-57 conserva la concentración del medicamento elegido', async () => {
    mockGet({ data: { message: '', items: [{ name: 'Ibuprofen 400 MG Oral Tablet', source: 'RxNav', strength: '400 MG', rxcui: '1' }] } });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fillConsultation(container);
    await userEvent.type(screen.getByLabelText('Medicamento'), 'ibu');
    fireEvent.click(await screen.findByRole('button', { name: /Ibuprofen 400 MG/ }));
    expect(field(container, 'strength').value).toBe('400 MG');
  });

  it('avisa si el catálogo no responde y permite seguir', async () => {
    mockGet(new Error('red'));
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fillConsultation(container);
    await userEvent.type(screen.getByLabelText('Medicamento'), 'ibu');
    expect(await screen.findByText(/escribir el medicamento manualmente/)).toBeInTheDocument();
  });

  it('BUG-38 la lista no se reabre tras elegir', async () => {
    mockGet({ data: { message: '', items: [{ name: 'Ibuprofen 400 MG', source: 'RxNav', rxcui: '1' }] } });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fillConsultation(container);
    await userEvent.type(screen.getByLabelText('Medicamento'), 'ibu');
    fireEvent.click(await screen.findByRole('button', { name: /Ibuprofen 400 MG/ }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByRole('button', { name: /Ibuprofen 400 MG/ })).toBeNull();
  });

  it('BUG-39 se pueden elegir dosis habituales sin catálogo externo', () => {
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    const options = [...field(container, 'strength').options].map((option) => option.value);
    expect(options).toContain('400 mg');
  });

  it('BUG-52 el error de details de la API se muestra al usuario', async () => {
    api.post.mockRejectedValue({ response: { data: { details: 'Escribe indicaciones claras para el paciente.' } } });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fill(container);
    submit();
    expect(await screen.findByText('Escribe indicaciones claras para el paciente.')).toBeInTheDocument();
  });

  it('RF04 CA01: el tratamiento se elige del catálogo y la fecha no puede ser futura', async () => {
    mockGet({ data: { items: [], message: '' } });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fill(container, { surgery_date: '2999-01-01' });
    submit();
    expect(screen.getByText(/fecha de intervención que no sea futura/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('ConsultationForm: tratamientos de cualquier especialidad', () => {
  const catalog = [
    { id: 4, name: 'Exodoncia simple', specialty: 'cirugia', specialty_label: 'Cirugía oral', follow_up_unit: 'days', checkin_every_days: 1, default_phases: [{ name: 'Cicatrización', days: 7 }], care_items: ['Frío local'] },
    { id: 9, name: 'Ortodoncia con brackets', specialty: 'ortodoncia', specialty_label: 'Ortodoncia', follow_up_unit: 'weeks', checkin_every_days: 7, control_every_days: 28,
      default_phases: [{ name: 'Alineación', days: 180 }, { name: 'Retención', days: 365 }], care_items: ['Usar elásticos'] },
  ];

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockImplementation(async (url) => (url === '/procedures/' ? { data: page(catalog) } : { data: { items: [], message: '' } }));
  });

  it('filtra por especialidad, muestra el protocolo y envía piezas y próximo control', async () => {
    api.post.mockResolvedValue({ data: { prescription: { id: 1 }, treatment: { id: 2 } } });
    const { container } = render(<ConsultationForm patientId={7} onPrescriptionAdded={() => {}} />);
    await screen.findByRole('option', { name: 'Ortodoncia' });
    fireEvent.change(field(container, 'specialty'), { target: { value: 'ortodoncia' } });
    const options = [...field(container, 'clinical_procedure').options].map((option) => option.textContent);
    expect(options).toEqual(['Selecciona el tratamiento realizado', 'Ortodoncia con brackets']);

    fireEvent.change(field(container, 'clinical_procedure'), { target: { value: '9' } });
    expect(screen.getByText(/Ortodoncia · seguimiento en semanas, reporte cada 7 días/)).toBeInTheDocument();
    expect(screen.getByText('Control en consultorio cada 28 días')).toBeInTheDocument();
    expect(screen.getByText('Fases: Alineación → Retención')).toBeInTheDocument();
    // El protocolo propone cuándo vuelve el paciente; el odontólogo lo ajusta.
    expect(field(container, 'next_control_in_days').value).toBe('28');

    fireEvent.click(screen.getByRole('button', { name: /^13:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^23:/ }));
    fireEvent.change(field(container, 'admission_reason'), { target: { value: 'Apiñamiento dental' } });
    fireEvent.change(field(container, 'surgery_date'), { target: { value: '2026-10-30' } });
    fireEvent.change(field(container, 'next_control_in_days'), { target: { value: '8' } });
    expect(screen.getByText(/recibirá el aviso para volver el sábado, 7 de noviembre/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Medicamento'), { target: { value: 'Ibuprofeno' } });
    for (const [name, value] of Object.entries({
      active_ingredient: 'Ibuprofeno', strength: '400 mg', dosage_form: 'Tableta', frequency: 'Cada 8 horas', duration: '3',
      instructions: 'Usa cera si el alambre lastima.',
    })) {
      fireEvent.change(field(container, name), { target: { value } });
    }
    submit();
    await screen.findByText(/Consulta registrada/);
    expect(api.post.mock.calls[0][1]).toMatchObject({ clinical_procedure: 9, teeth: [13, 23], next_control_in_days: 8, prescribes_medication: true });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('first_appointment');
  });

  it('elegir un tratamiento infantil cambia a la dentición temporal', async () => {
    api.get.mockImplementation(async (url) => (url === '/procedures/'
      ? { data: page([...catalog, { id: 11, name: 'Pulpotomía', specialty: 'odontopediatria', specialty_label: 'Odontopediatría', default_phases: [], care_items: [] }]) }
      : { data: { items: [], message: '' } }));
    const { container } = render(<ConsultationForm patientId={7} onPrescriptionAdded={() => {}} />);
    await screen.findByRole('option', { name: 'Pulpotomía' });
    fireEvent.change(field(container, 'clinical_procedure'), { target: { value: '11' } });
    expect(field(container, 'specialty').value).toBe('odontopediatria');
    expect(screen.getByRole('button', { name: /^55:/ })).toBeInTheDocument();
  });

  it('el próximo control admite hasta 730 días y vacío significa que no hace falta', async () => {
    api.post.mockResolvedValue({ data: { prescription: { id: 1 }, treatment: { id: 2 } } });
    const { container } = render(<ConsultationForm patientId={7} onPrescriptionAdded={() => {}} />);
    await fill(container, { next_control_in_days: '900' });
    submit();
    expect(screen.getByText(/Indica entre 0 y 730 días/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(field(container, 'next_control_in_days'), { target: { value: '' } });
    expect(screen.getByText('Con 0 o vacío no se le avisará de un control.')).toBeInTheDocument();
    submit();
    await screen.findByText(/Consulta registrada/);
    expect(api.post.mock.calls[0][1].next_control_in_days).toBe(0);
  });
});

describe('ConsultationForm: cada tratamiento tiene su propio registro', () => {
  const brackets = {
    id: 9, name: 'Ortodoncia con brackets', specialty: 'ortodoncia', specialty_label: 'Ortodoncia', follow_up_unit: 'weeks',
    checkin_every_days: 7, control_every_days: 28, medication_default: false, uses_teeth: false, default_phases: [], care_items: [],
    consultation_fields: [
      { key: 'aparato', label: 'Tipo de aparato', type: 'select', options: ['Brackets metálicos', 'Brackets estéticos'], required: true, en: ['inicio'] },
      { key: 'arcadas', label: 'Arcadas tratadas', type: 'select', options: ['Superior', 'Inferior', 'Ambas'], required: true, en: ['inicio'] },
      { key: 'arco', label: 'Arco colocado', type: 'text', required: false, en: ['control'] },
    ],
  };
  const implant = {
    id: 5, name: 'Implante unitario', specialty: 'implantologia', specialty_label: 'Implantología', follow_up_unit: 'weeks',
    checkin_every_days: 2, control_every_days: 14, medication_default: true, uses_teeth: true, default_phases: [], care_items: [],
    consultation_fields: [
      { key: 'implante', label: 'Medidas del implante', type: 'text', required: true, en: ['inicio'] },
      { key: 'torque', label: 'Torque de inserción (N·cm)', type: 'number', min: 0, max: 80, required: false, en: ['inicio'] },
      { key: 'injerto', label: 'Se colocó injerto óseo', type: 'boolean', required: false, en: ['inicio'] },
    ],
  };
  const start = async (container, id) => {
    await screen.findByRole('option', { name: 'Implante unitario' });
    fireEvent.change(field(container, 'admission_reason'), { target: { value: 'Motivo de la consulta' } });
    fireEvent.change(field(container, 'clinical_procedure'), { target: { value: String(id) } });
  };

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockImplementation(async (url) => (url === '/procedures/' ? { data: page([brackets, implant]) } : { data: { items: [], message: '' } }));
  });

  it('brackets: pide sus datos, no muestra odontograma ni obliga a recetar', async () => {
    api.post.mockResolvedValue({ data: { prescription: null, treatment: { id: 2 } } });
    const onPrescription = vi.fn();
    const { container } = render(<ConsultationForm patientId={7} onPrescriptionAdded={onPrescription} />);
    await start(container, 9);
    expect(screen.getByRole('group', { name: '2. Datos de ortodoncia con brackets' })).toBeEnabled();
    // Solo los datos del inicio; «Arco colocado» se pide en cada control.
    expect(screen.getByLabelText('Tipo de aparato')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Arco colocado/)).toBeNull();
    expect(screen.queryByText(/Piezas tratadas/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Recetar medicación en esta consulta/ })).not.toBeChecked();
    expect(screen.getByText(/Este tratamiento no suele llevar receta/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Medicamento')).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar consulta' })).toBeDisabled();

    fireEvent.change(field(container, 'instructions'), { target: { value: 'Cepíllate después de cada comida.' } });
    fireEvent.change(screen.getByLabelText('Tipo de aparato'), { target: { value: 'Brackets estéticos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar consulta' }));
    expect(screen.getByText('Completa este dato.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Arcadas tratadas/), { target: { value: 'Ambas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar consulta' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Consulta registrada: el tratamiento quedó activo, sin receta.');
    const body = api.post.mock.calls[0][1];
    expect(body).toMatchObject({
      clinical_procedure: 9, prescribes_medication: false, teeth: [], next_control_in_days: 28,
      clinical_data: { aparato: 'Brackets estéticos', arcadas: 'Ambas' },
    });
    for (const name of ['medication_name', 'strength', 'details']) expect(body).not.toHaveProperty(name);
    expect(onPrescription).not.toHaveBeenCalled();
  });

  it('implante: valida números, envía sí/no y propone receta', async () => {
    api.post.mockRejectedValue({ response: { data: { clinical_data: { implante: 'Dato rechazado por el servidor' } } } });
    const { container } = render(<ConsultationForm patientId={7} onPrescriptionAdded={() => {}} />);
    await start(container, 5);
    expect(screen.getByRole('checkbox', { name: /Recetar medicación en esta consulta/ })).toBeChecked();
    expect(screen.getByText(/Piezas tratadas/)).toBeInTheDocument();
    // El odontólogo puede decidir no recetar aunque el tratamiento suela llevarlo.
    fireEvent.click(screen.getByRole('checkbox', { name: /Recetar medicación en esta consulta/ }));
    fireEvent.change(field(container, 'instructions'), { target: { value: 'Dieta blanda durante una semana.' } });
    fireEvent.change(screen.getByLabelText('Medidas del implante'), { target: { value: '4.1 × 10 mm' } });
    fireEvent.change(screen.getByLabelText(/Torque de inserción/), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar consulta' }));
    expect(screen.getByText('Indica un número entre 0 y 80.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Torque de inserción/), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Se colocó injerto óseo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar consulta' }));
    // Los errores del servidor aparecen junto al dato del tratamiento.
    expect(await screen.findByText('Dato rechazado por el servidor')).toBeInTheDocument();
    expect(api.post.mock.calls[0][1].clinical_data).toEqual({ implante: '4.1 × 10 mm', torque: 35, injerto: true });
  });

  it('al cambiar de tratamiento se descartan los datos del anterior', async () => {
    const { container } = render(<ConsultationForm patientId={7} onPrescriptionAdded={() => {}} />);
    await start(container, 5);
    fireEvent.change(screen.getByLabelText('Medidas del implante'), { target: { value: '4.1 × 10 mm' } });
    fireEvent.change(field(container, 'clinical_procedure'), { target: { value: '9' } });
    expect(screen.queryByLabelText('Medidas del implante')).toBeNull();
    fireEvent.change(field(container, 'clinical_procedure'), { target: { value: '5' } });
    expect(screen.getByLabelText('Medidas del implante')).toHaveValue('');
  });
});

describe('ConsultationForm: catálogo oficial de medicamentos', () => {
  const ibuprofen = {
    name: 'Ibuprofeno', active_ingredient: 'Ibuprofeno', source: 'CIMA', strength: '', rxcui: null,
    presentations: [
      { strength: '400 mg', form: 'Comprimido' }, { strength: '600 mg', form: 'Comprimido' },
      { strength: '600 mg', form: 'Granulado oral' }, { strength: '20 mg/ml', form: 'Suspensión oral' },
    ],
  };

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('al elegir el principio activo ofrece sus concentraciones y presentaciones reales', async () => {
    mockGet({ data: { source: 'CIMA', message: '', items: [ibuprofen] } });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fillConsultation(container);
    await userEvent.type(screen.getByLabelText('Medicamento'), 'ibu');
    const option = await screen.findByRole('button', { name: /Ibuprofeno/ });
    expect(option).toHaveTextContent('400 mg · 600 mg · 20 mg/ml');
    fireEvent.click(option);
    expect(field(container, 'active_ingredient').value).toBe('Ibuprofeno');
    const strengths = [...field(container, 'strength').options].map((item) => item.value);
    expect(strengths).toEqual(['', '400 mg', '600 mg', '20 mg/ml']);
    fireEvent.change(field(container, 'strength'), { target: { value: '600 mg' } });
    expect([...field(container, 'dosage_form').options].map((item) => item.value)).toEqual(['', 'Comprimido', 'Granulado oral']);
  });

  it('muestra la ficha oficial del medicamento cuando el odontólogo la pide', async () => {
    api.get.mockImplementation(async (url, config) => {
      if (url === '/procedures/') return { data: page([{ id: 4, name: 'Exodoncia simple' }]) };
      if (url === '/medications/sheet/') {
        if (config.params.name === 'Inventado') throw Object.assign(new Error('404'), { response: { status: 404 } });
        return { data: {
          name: 'Ibuprofeno', indications: 'Alivia el dolor y la inflamación.', mechanism: 'Reduce las prostaglandinas.',
          common_effects: 'Molestias de estómago.', warning_signs: 'Heces negras.', what_to_do: 'Tómalo con comida.',
          source_note: 'Fuente: prospecto autorizado (CIMA-AEMPS), resumido por IA.',
        } };
      }
      return { data: { items: [], message: '' } };
    });
    const { container } = render(<ConsultationForm patientId={1} onPrescriptionAdded={() => {}} />);
    await fillConsultation(container);
    expect(screen.queryByRole('button', { name: /Ver ficha/ })).toBeNull();
    fireEvent.change(field(container, 'active_ingredient'), { target: { value: 'Ibuprofeno' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver ficha de Ibuprofeno' }));
    const sheet = await screen.findByRole('region', { name: 'Ficha de Ibuprofeno' });
    expect(sheet).toHaveTextContent('Para qué sirveAlivia el dolor y la inflamación.');
    expect(sheet).toHaveTextContent('Cómo actúaReduce las prostaglandinas.');
    expect(sheet).toHaveTextContent('Fuente: prospecto autorizado (CIMA-AEMPS), resumido por IA.');
    expect(api.get).toHaveBeenCalledWith('/medications/sheet/', { params: { name: 'Ibuprofeno' } });
    // Al cambiar de medicamento, la ficha anterior deja de mostrarse.
    fireEvent.change(field(container, 'active_ingredient'), { target: { value: 'Inventado' } });
    expect(screen.queryByRole('region', { name: 'Ficha de Ibuprofeno' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver ficha de Inventado' }));
    expect(await screen.findByText(/No hay una ficha oficial para «Inventado»/)).toBeInTheDocument();
  });
});
