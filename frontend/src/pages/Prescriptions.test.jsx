import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { apiRoutes, page, renderAt } from '../test/utils';
import Prescriptions from './Prescriptions';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const PATIENT = { full_name: 'Carlos Pérez', username: 'carlos', professional_title: 'Paciente' };
let mockUser = PATIENT;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: mockUser }),
}));

const activePlan = {
  id: 5, title: 'Paracetamol', is_active: true, instructions: 'Compresas frías', schedule_description: 'Cada 8 horas',
  procedure: 'Exodoncia simple', surgery_date: '2026-11-02', postoperative_day: 2, specialty: 'cirugia',
  specialty_label: 'Cirugía oral', teeth: [], phases: [{ id: 1, order: 1, name: 'Cicatrización inicial', status: 'active', status_label: 'En curso' }],
  next_control: null,
  procedure_detail: { name: 'Exodoncia simple', monitoring_days: 3, follow_up_unit: 'days', expected_curve: [5, 3, 2, 1] },
};
const orthoPlan = {
  ...activePlan, id: 6, title: 'Brackets', procedure: 'Ortodoncia con brackets', specialty: 'ortodoncia',
  specialty_label: 'Ortodoncia', postoperative_day: 40, teeth: [13, 23],
  procedure_detail: { name: 'Ortodoncia con brackets', monitoring_days: 30, follow_up_unit: 'weeks', expected_curve: [5, 4] },
  phases: [
    { id: 1, order: 1, name: 'Alineación y nivelación', status: 'active', status_label: 'En curso' },
    { id: 2, order: 2, name: 'Corrección de la mordida', status: 'pending', status_label: 'Pendiente' },
  ],
  next_control: { date: '2026-12-01', days_left: 5, overdue: false },
};
const routes = (overrides = {}) => ({
  '/prescriptions/': page([]),
  '/patient-reports/': page([]),
  '/treatment-plans/': page([activePlan]),
  '/patient-profile/': page([{ age: 30, phone: '099' }]),
  '/reminders/': [],
  '/assistant/messages/': { conversation: null, ai_enabled: false },
  '/care-checkins/': { items: ['Frío local', 'Dieta blanda'], today: null, history: [], adherence_7_days: null },
  ...overrides,
});
const prescription = {
  id: 1, doctor_name: 'laura', details: 'Paracetamol cada 8 horas', is_active: true, nlp_severity: 'Alta',
  medication_name: 'Paracetamol', strength: '500 mg', frequency: 'Cada 8 horas', duration: '3 días',
  extracted_entities: [{ text: 'Paracetamol', label: 'MISC' }],
  medication_guidance: { common_effects: 'Náusea', warning_signs: 'Fiebre' },
};
const chartReport = (id, day, pain) => ({
  id, pain_level: pain, postoperative_day: day, alert_color: 'verde', comparison: 'same', message: 'Control',
  created_at: `2026-11-0${2 + day}T10:00:00Z`,
});

// Respuesta del asistente: la conversación completa y el estado reunido.
const turn = (messages, collected = {}, ready = false) => ({
  data: {
    conversation: { id: 7, collected: { pain_level: null, comparison: null, symptoms: {}, ...collected }, messages },
    message: messages[messages.length - 1],
    ready_to_submit: ready,
    source: 'local',
  },
});
const msg = (id, role, text) => ({ id, role, text, source: 'local' });

async function chartRows() {
  const table = await screen.findByRole('table', { hidden: true });
  return [...table.querySelectorAll('tbody tr')].map((row) => [...row.cells].map((cell) => cell.textContent));
}

// El menú lateral es el mismo de los otros roles: enlaces dentro de una navegación.
const menu = () => screen.getByRole('navigation', { name: 'Mi seguimiento' });
const menuLink = (name) => within(menu()).getByRole('link', { name: new RegExp(name) });
const openTab = (name) => fireEvent.click(menuLink(name));
const visibleSection = () => ['tratamiento', 'asistente', 'cuidados', 'evolucion']
  .filter((id) => !document.getElementById(`seccion-${id}`).hidden);

async function show(overrides, tab) {
  api.get.mockImplementation(apiRoutes(routes(overrides)));
  renderAt(<Prescriptions />);
  await screen.findByText('Reportes Recientes');
  if (tab) openTab(tab);
}

describe('Portal del paciente', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('tiene el menú lateral de los demás roles y la sección vive en la URL', async () => {
    await show();
    expect(within(menu()).getAllByRole('link').map((link) => link.textContent)).toEqual(['Mi tratamiento', 'Asistente', 'Mis cuidados', 'Evolución']);
    expect(menuLink('Mi tratamiento')).toHaveAttribute('aria-current', 'page');
    expect(visibleSection()).toEqual(['tratamiento']);
    openTab('Asistente');
    expect(menuLink('Asistente')).toHaveAttribute('aria-current', 'page');
    expect(menuLink('Asistente')).toHaveAttribute('href', '/panel-paciente?seccion=asistente');
    expect(visibleSection()).toEqual(['asistente']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Asistente');
    // En móvil el mismo menú es un selector.
    fireEvent.change(screen.getByLabelText('Ir a la sección'), { target: { value: '/panel-paciente?seccion=evolucion' } });
    expect(visibleSection()).toEqual(['evolucion']);
    expect(screen.getByRole('heading', { name: 'Reportes Recientes' })).toBeInTheDocument();
  });

  it('muestra un esqueleto mientras carga, con el menú ya visible', () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    renderAt(<Prescriptions />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando tu plan de recuperación...');
    expect(menu()).toBeInTheDocument();
  });

  it('muestra estados vacíos', async () => {
    await show({ '/treatment-plans/': page([]) });
    expect(screen.getByText(/Aún no tienes indicaciones/)).toBeInTheDocument();
    expect(screen.getByText(/Aún no hay puntos registrados/)).toBeInTheDocument();
    expect(screen.getByText(/primer autoreporte/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hola, Carlos Pérez' })).toBeInTheDocument();
    // El perfil viene de la sesión: el portal no vuelve a pedirlo.
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/account/');
  });

  it('muestra receta, entidades y guía', async () => {
    await show({ '/prescriptions/': page([prescription]) });
    expect(screen.getByText('Severidad: Alta')).toBeInTheDocument();
    expect(screen.getByText('(MISC)')).toBeInTheDocument();
    expect(screen.getByText(/Consulta de inmediato si: Fiebre/)).toBeInTheDocument();
  });

  it('el texto del usuario nunca se interpreta como HTML', async () => {
    await show({ '/prescriptions/': page([{ ...prescription, details: '<img src=x onerror=alert(1)>' }]) });
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('muestra el error si no carga', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    renderAt(<Prescriptions />);
    expect(await screen.findByText('No se pudo cargar el portal')).toBeInTheDocument();
  });

  it('el aviso de seguridad y el teléfono de emergencia se ven en todas las secciones', async () => {
    await show();
    for (const tab of ['Mi tratamiento', 'Asistente', 'Mis cuidados', 'Evolución']) {
      openTab(tab);
      expect(screen.getByText('Aviso médico de seguridad').closest('[hidden]')).toBeNull();
      expect(screen.getByRole('link', { name: 'Emergencias: 04 270 0000' })).toHaveAttribute('href', 'tel:042700000');
    }
  });

  it('recorre todas las páginas de indicaciones', async () => {
    api.get.mockImplementation(async (url, config) => {
      if (url === '/prescriptions/') {
        return config.params.page === 1
          ? { data: { ...page([prescription], 2), next: 'x' } }
          : { data: page([{ ...prescription, id: 2 }], 2) };
      }
      return { data: routes()[url] };
    });
    renderAt(<Prescriptions />);
    expect(await screen.findByText('3 indicaciones')).toBeInTheDocument();
  });
});

describe('Mi tratamiento', () => {
  beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });

  it('tratamiento corto: línea de tiempo por días desde la intervención', async () => {
    await show();
    expect(screen.getByText(/Cirugía oral · Exodoncia simple/)).toBeInTheDocument();
    expect(screen.getByText('Día 2 desde tu última intervención')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Línea de tiempo de recuperación' }).children;
    expect(steps).toHaveLength(4);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
  });

  it('tratamiento largo: fases, semanas, piezas y próximo control', async () => {
    await show({ '/treatment-plans/': page([orthoPlan]) });
    expect(screen.getByText('Semana 6 desde tu última intervención')).toBeInTheDocument();
    const phases = screen.getByRole('list', { name: 'Fases del tratamiento' });
    expect(within(phases).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');
    const control = screen.getByText(/Tu próximo control/).closest('p');
    expect(control).toHaveTextContent('martes, 1 de diciembre');
    expect(control).toHaveTextContent('Control en 5 días. Comunícate con el consultorio para confirmar tu turno.');
    expect(screen.getByText(/Piezas: 13: canino superior derecho; 23: canino superior izquierdo/)).toBeInTheDocument();
  });

  it('un control atrasado se avisa como pendiente', async () => {
    await show({ '/treatment-plans/': page([{ ...orthoPlan, next_control: { date: '2026-11-01', days_left: -4, overdue: true } }]) });
    const control = screen.getByText(/Tienes un control pendiente/).closest('p');
    expect(control).toHaveTextContent('Control atrasado 4 días');
  });

  it('con dos tratamientos activos usa el que empezó más recientemente', async () => {
    const older = { ...activePlan, id: 4, surgery_date: '2026-10-20', postoperative_day: 15 };
    const newer = { ...activePlan, id: 6, surgery_date: '2026-11-03', postoperative_day: 1 };
    await show({ '/treatment-plans/': page([older, newer]) });
    expect(screen.getByText('Día 1 desde tu última intervención')).toBeInTheDocument();
  });

  it('los recordatorios llevan a la sección que corresponde', async () => {
    await show({ '/reminders/': [{ kind: 'report', key: 'report:5', text: 'Hoy te toca contarle a tu odontólogo cómo te sientes.' }] });
    expect(await screen.findByText(/Hoy te toca contarle/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reportar ahora' }));
    expect(menuLink('Asistente')).toHaveAttribute('aria-current', 'page');
  });

  it('sin la característica de notificaciones (variante A) no pide ni muestra recordatorios', async () => {
    mockUser = { ...PATIENT, features: { variant: 'A', notifications: false } };
    try {
      await show({ '/reminders/': [{ kind: 'report', key: 'report:5', text: 'Hoy te toca contarle a tu odontólogo cómo te sientes.' }] });
      expect(screen.queryByText(/Hoy te toca contarle/)).not.toBeInTheDocument();
      expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/reminders/');
    } finally {
      mockUser = PATIENT;
    }
  });

  it('explica las indicaciones en lenguaje sencillo y responde dudas', async () => {
    await show({
      '/treatment-plans/5/explanation/': {
        source: 'llm', content: { resumen: 'Te sacaron una muela.', pasos: ['Pon frío en la cara.'], que_evitar: ['No escupas.'],
          medicacion: [{ nombre: 'Paracetamol 500 mg', como_tomarlo: 'cada 8 horas' }], cuando_llamar: ['Si sangra mucho'] },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Explícamelo fácil' }));
    expect(await screen.findByText('Te sacaron una muela.')).toBeInTheDocument();
    expect(screen.getByText('No escupas.')).toBeInTheDocument();
    expect(screen.getByText(/redactada con inteligencia artificial/)).toBeInTheDocument();

    api.post.mockResolvedValue({ data: { answer: 'Según tus indicaciones: dieta blanda.', grounded: true, source: 'local' } });
    fireEvent.change(screen.getByLabelText('Pregunta sobre tus indicaciones'), { target: { value: '¿Puedo comer pan?' } });
    fireEvent.click(screen.getByRole('button', { name: /Preguntar/ }));
    expect(await screen.findByText('Según tus indicaciones: dieta blanda.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/treatment-plans/5/ask/', { question: '¿Puedo comer pan?' });
  });
});

describe('Asistente conversacional', () => {
  beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });

  it('conversa, pide el EVA con botones y envía el reporte al confirmar', async () => {
    api.post.mockImplementation(async (url, body) => {
      if (url === '/assistant/submit/') {
        return { data: { id: 30, pain_level: 4, alert_color: 'amarillo', risk_level: 'Medio', evolution_status: 'Evolución estable',
          alert_reasons: ['Aparato de ortodoncia suelto'], recommendation: 'Vigila cómo te sientes.', doctor_notified: false,
          extracted_entities: [{ label: 'SINTOMA', category: 'Aparato suelto o roto', negated: false }],
          created_at: '2026-11-04T10:00:00Z', comparison: 'same', message: 'Se me despegó un bracket' } };
      }
      if (body.text === 'Se me despegó un bracket') {
        return turn([msg(1, 'patient', body.text), msg(2, 'assistant', 'Del 0 al 10, ¿cuánto dolor sientes ahora?')], { symptoms: { 'Aparato suelto o roto': null } });
      }
      if (body.pain_level === 4) {
        return turn([msg(1, 'patient', 'Se me despegó un bracket'), msg(2, 'assistant', 'Del 0 al 10...'), msg(3, 'patient', 'Dolor 4/10'),
          msg(4, 'assistant', '¿Te sientes mejor, igual o peor que ayer?')], { pain_level: 4, symptoms: { 'Aparato suelto o roto': null } });
      }
      return turn([msg(5, 'assistant', 'Gracias. ¿Quieres enviar este reporte?')], { pain_level: 4, comparison: 'same', symptoms: { 'Aparato suelto o roto': null } }, true);
    });
    await show(undefined, 'Asistente');
    fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'Se me despegó un bracket' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    expect(await screen.findByText('Del 0 al 10, ¿cuánto dolor sientes ahora?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(await screen.findByRole('button', { name: 'Igual que ayer' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/assistant/messages/', { text: '', pain_level: 4 });

    fireEvent.click(screen.getByRole('button', { name: 'Igual que ayer' }));
    expect(await screen.findByText('¿Envío este reporte a tu odontólogo?')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Dolor 4/10 · Igual que ayer · Aparato suelto o roto');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    expect(await screen.findByText('Nivel de alerta: Alerta amarilla')).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Aparato de ortodoncia suelto/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/assistant/submit/', { conversation: 7 });
    // El reporte se suma al historial sin recargar.
    expect(screen.getByText('1 registrado')).toBeInTheDocument();
  });

  it('recupera la conversación abierta y muestra si usa IA', async () => {
    await show({
      '/assistant/messages/': {
        ai_enabled: true,
        conversation: { id: 7, collected: { pain_level: 3, comparison: null, symptoms: {} }, messages: [msg(1, 'patient', 'me duele un poco')] },
      },
    }, 'Asistente');
    expect(await screen.findByText('me duele un poco')).toBeInTheDocument();
    expect(screen.getByText('IA')).toBeInTheDocument();
    // Ya dio su EVA: ahora pregunta la comparación.
    expect(screen.getByRole('button', { name: 'Peor que ayer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '10' })).toBeNull();
  });

  it('un mensaje a medio escribir no se pierde al cambiar de pestaña', async () => {
    await show(undefined, 'Asistente');
    fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'Me duele' } });
    openTab('Evolución');
    openTab('Asistente');
    expect(screen.getByLabelText('Mensaje para el asistente')).toHaveValue('Me duele');
  });

  it('los atajos guían la descripción de síntomas (RU01)', async () => {
    await show(undefined, 'Asistente');
    fireEvent.click(screen.getByRole('button', { name: '+ Sangrado' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Llaga' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Sangrado' }));
    expect(screen.getByLabelText('Mensaje para el asistente')).toHaveValue('Tengo sangrado. Tengo una llaga');
  });

  it('sin tratamiento activo no se puede conversar (RF02)', async () => {
    await show({ '/treatment-plans/': page([]) }, 'Asistente');
    expect(screen.getByText(/cuando tu odontólogo registre tu tratamiento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled();
  });

  it('informa si el mensaje no se pudo procesar', async () => {
    api.post.mockRejectedValue({ response: { data: { detail: 'Aún no tienes un tratamiento activo.' } } });
    await show(undefined, 'Asistente');
    fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Aún no tienes un tratamiento activo.');
  });
});

describe('Mis cuidados', () => {
  beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });

  it('marca los cuidados del día y muestra el cumplimiento', async () => {
    api.post.mockResolvedValue({ data: { id: 1, date: '2026-11-04', items: { 'Frío local': true, 'Dieta blanda': false }, adherence: 50 } });
    await show(undefined, 'Mis cuidados');
    fireEvent.click(await screen.findByLabelText('Frío local'));
    fireEvent.click(screen.getByRole('button', { name: /Guardar mis cuidados/ }));
    expect(await screen.findByText(/cumpliste el 50 %/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/care-checkins/', { items: { 'Frío local': true, 'Dieta blanda': false } });
  });
});

describe('Evolución', () => {
  beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });

  it('la gráfica usa el día de seguimiento, el EVA máximo diario y la curva esperada', async () => {
    await show({ '/patient-reports/': page([chartReport(3, 1, 6), chartReport(2, 1, 3), chartReport(1, 0, 5)]) }, 'Evolución');
    expect(await chartRows()).toEqual([
      ['0', '5', '5', 'Verde'],
      ['1', '6', '3', 'Verde'],
      ['2', '—', '2', '—'],
      ['3', '—', '1', '—'],
    ]);
  });

  it('BUG-33 la gráfica y el contador recorren todas las páginas de autorreportes', async () => {
    const firstPage = { count: 11, next: 'p2', previous: null, results: Array.from({ length: 10 }, (_, i) => chartReport(11 - i, 1, 2)) };
    const secondPage = page([chartReport(1, 0, 9)], 11);
    api.get.mockImplementation(async (url, config) => {
      if (url === '/patient-reports/') return { data: config?.params?.page === 2 ? secondPage : firstPage };
      return apiRoutes(routes())(url);
    });
    renderAt(<Prescriptions />);
    await screen.findByText('Reportes Recientes');
    expect(screen.getByText('11 registrados')).toBeInTheDocument();
    expect((await chartRows())[0]).toEqual(['0', '9', '5', 'Verde']);
  });

  it('BUG-40 no desplaza la página al cargar', async () => {
    await show();
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled());
  });
});
