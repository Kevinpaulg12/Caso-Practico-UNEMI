import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { apiRoutes, page, renderAt } from '../test/utils';
import Prescriptions from './Prescriptions';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: { full_name: 'Carlos Pérez', username: 'carlos', professional_title: 'Paciente' } }),
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
  '/patient-profile/': page([{ age: 30, phone: '099', doctor_contact: { name: 'Laura Mora', phone: '0991112233', email: 'laura@clinica.ec' } }]),
  '/reminders/': [],
  '/assistant/messages/': { conversation: null, ai_enabled: false },
  '/care-checkins/': { items: ['Frío local', 'Dieta blanda'], today: null, history: [], adherence_7_days: null },
  '/appointment-requests/': page([]),
  ...overrides,
});
const prescription = {
  id: 1, doctor_name: 'laura', details: 'Paracetamol cada 8 horas', is_active: true, nlp_severity: 'Alta',
  medication_name: 'Paracetamol', strength: '500 mg', frequency: 'Cada 8 horas', duration: '3 días',
  extracted_entities: [{ text: 'Paracetamol', label: 'MISC' }],
  medication_guidance: { name: 'Paracetamol', common_effects: 'Náusea', warning_signs: 'Fiebre', indications: 'Alivia el dolor.',
    mechanism: 'Reduce las sustancias del dolor.', what_to_do: 'Con o sin alimentos.', source_note: 'Fuente: prospecto autorizado (CIMA-AEMPS), resumido por IA.' },
};

// Respuesta del asistente: solo la conversación (el paciente nunca recibe lo que el sistema extrajo).
const turn = (messages) => ({
  data: { conversation: { id: 7, messages }, message: messages[messages.length - 1], source: 'local' },
});
const msg = (id, role, text, extra = {}) => ({ id, role, text, source: 'local', ...extra });

// El menú lateral es el mismo de los otros roles: enlaces dentro de una navegación.
const menu = () => screen.getByRole('navigation', { name: 'Mi seguimiento' });
const menuLink = (name) => within(menu()).getByRole('link', { name: new RegExp(name) });
const openTab = (name) => fireEvent.click(menuLink(name));
const visibleSection = () => ['tratamiento', 'asistente', 'cuidados']
  .filter((id) => !document.getElementById(`seccion-${id}`).hidden);

async function show(overrides, tab) {
  api.get.mockImplementation(apiRoutes(routes(overrides)));
  renderAt(<Prescriptions />);
  await screen.findByRole('heading', { name: /^Hola, / });
  if (tab) openTab(tab);
}

describe('Portal del paciente', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('tiene el menú lateral de los demás roles y la sección vive en la URL', async () => {
    await show();
    // La curva de evolución del dolor ya no se muestra al paciente: la ve su odontólogo.
    expect(within(menu()).getAllByRole('link').map((link) => link.textContent)).toEqual(['Mi tratamiento', 'Asistente', 'Mis cuidados']);
    expect(menuLink('Mi tratamiento')).toHaveAttribute('aria-current', 'page');
    expect(visibleSection()).toEqual(['tratamiento']);
    openTab('Asistente');
    expect(menuLink('Asistente')).toHaveAttribute('aria-current', 'page');
    expect(menuLink('Asistente')).toHaveAttribute('href', '/panel-paciente?seccion=asistente');
    expect(visibleSection()).toEqual(['asistente']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Asistente');
    // En móvil el mismo menú es un selector.
    fireEvent.change(screen.getByLabelText('Ir a la sección'), { target: { value: '/panel-paciente?seccion=cuidados' } });
    expect(visibleSection()).toEqual(['cuidados']);
    expect(screen.getByRole('heading', { name: 'Mi medicación' })).toBeInTheDocument();
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/patient-reports/');
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
    expect(screen.getByRole('heading', { name: 'Hola, Carlos Pérez' })).toBeInTheDocument();
    // El perfil viene de la sesión: el portal no vuelve a pedirlo.
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/account/');
  });

  it('Mis cuidados muestra la medicación recetada y sus posibles efectos, sin severidades ni entidades', async () => {
    await show({ '/prescriptions/': page([prescription]) });
    // Desde la tarjeta de Mi tratamiento se llega a la ficha del medicamento.
    fireEvent.click(screen.getByRole('button', { name: 'Cómo tomarlo y posibles efectos' }));
    expect(visibleSection()).toEqual(['cuidados']);
    const about = screen.getByRole('article', { name: 'Sobre Paracetamol' });
    expect(about).toHaveTextContent('500 mgCada 8 horas3 días');
    expect(about).toHaveTextContent('Para qué sirveAlivia el dolor.');
    expect(about).toHaveTextContent('Cómo tomarloCon o sin alimentos.');
    expect(about).toHaveTextContent('Posibles efectos secundariosNáusea');
    expect(about).toHaveTextContent('Llama a la clínica de inmediato siFiebre');
    expect(about).toHaveTextContent('Fuente: prospecto autorizado (CIMA-AEMPS), resumido por IA.');
    expect(screen.queryByText(/Severidad/)).toBeNull();
    expect(screen.queryByText('(MISC)')).toBeNull();
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

  it('sin franja de aviso ni botón flotante: el contacto está junto a Enviar en el chat', async () => {
    await show(undefined, 'Asistente');
    expect(screen.queryByRole('complementary', { name: 'Aviso médico de seguridad' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Llamar a urgencias/ })).toBeNull();
    const button = screen.getByRole('button', { name: 'Contacto' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    const card = screen.getByRole('region', { name: 'Contacto de tu odontólogo' });
    expect(card).toHaveTextContent('Dr(a). Laura Mora');
    expect(within(card).getByRole('link', { name: '0991112233' })).toHaveAttribute('href', 'tel:0991112233');
    expect(within(card).getByRole('link', { name: 'laura@clinica.ec' })).toHaveAttribute('href', 'mailto:laura@clinica.ec');
    expect(within(card).getByRole('link', { name: /Urgencias de la clínica: 04 270 0000/ })).toHaveAttribute('href', 'tel:042700000');
    expect(card).toHaveTextContent(/no reemplaza la atención de urgencia/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Contacto de tu odontólogo' })).toBeNull();
    expect(button).toHaveFocus();
  });

  it('el contacto sigue disponible aunque aún no pueda conversar', async () => {
    await show({ '/treatment-plans/': page([]), '/patient-profile/': page([{ age: 30, doctor_contact: null }]) }, 'Asistente');
    fireEvent.click(screen.getByRole('button', { name: 'Contacto' }));
    expect(screen.getByRole('region', { name: 'Contacto de tu odontólogo' })).toHaveTextContent('Aún no tienes un odontólogo asignado');
  });

  it('BUG-40 no desplaza la página al cargar', async () => {
    await show();
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled());
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

  it('pide también lo cerrado y, tras el alta, muestra los tratamientos anteriores y deja pedir una cita', async () => {
    const closed = { ...activePlan, is_active: false, admission_reason: 'Dolor en el 38', instructions: 'Dieta blanda tres días' };
    await show({
      '/treatment-plans/': page([closed]),
      '/prescriptions/': page([{ ...prescription, is_active: false }]),
    });
    for (const url of ['/treatment-plans/', '/prescriptions/']) {
      expect(api.get).toHaveBeenCalledWith(url, { params: { include_closed: 'true', page: 1, page_size: 100 } });
    }
    expect(screen.getByText(/Aquí siguen tus tratamientos anteriores/)).toBeInTheDocument();
    expect(screen.getByText('No tienes indicaciones vigentes: tu tratamiento terminó.')).toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'Mis tratamientos anteriores' });
    expect(history).toHaveTextContent('Exodoncia simple');
    expect(history).toHaveTextContent('Terminado');
    expect(history).toHaveTextContent('Dieta blanda tres días');
    // Puede pedir una cita: se ve el estado de sus citas y el asistente está disponible, sin atajos de síntomas.
    expect(screen.getByRole('region', { name: 'Mis citas' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Pedir una cita' })[0]);
    expect(menuLink('Asistente')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Mensaje para el asistente')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Sangrado' })).toBeNull();
    expect(screen.getByText(/Si necesitas volver a consulta, puedo pedir una cita por ti/)).toBeInTheDocument();
    // La receta cerrada queda como medicación anterior.
    openTab('Mis cuidados');
    expect(screen.getByText('Medicación anterior (1)')).toBeInTheDocument();
  });

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

  it('los recordatorios llevan a la sección que corresponde, sin el aviso de «¿Cómo te sientes hoy?»', async () => {
    await show({ '/reminders/': [
      { kind: 'report', key: 'report:5', text: '¿Cómo te sientes hoy? Cuéntaselo al asistente.' },
      { kind: 'care', key: 'care:5', text: 'Aún no marcas tus cuidados de hoy.' },
    ] });
    expect(await screen.findByText('Aún no marcas tus cuidados de hoy.')).toBeInTheDocument();
    expect(screen.queryByText(/Cuéntaselo al asistente/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver mis cuidados' }));
    expect(menuLink('Mis cuidados')).toHaveAttribute('aria-current', 'page');
  });

  it('muestra su próxima cita reservada y permite cancelarla', async () => {
    api.post.mockResolvedValue({ data: { id: 1, status: 'cancelled', status_label: 'Cancelada', starts_at: '2099-11-20T08:30:00-05:00', note: '' } });
    await show({ '/appointment-requests/': page([
      { id: 1, status: 'booked', status_label: 'Reservada', starts_at: '2099-11-20T08:30:00-05:00', doctor_name: 'Laura Mora', note: '' },
      { id: 2, status: 'cancelled', status_label: 'Cancelada', starts_at: '2026-11-10T09:00:00-05:00', note: 'Tu odontólogo no podrá atender.' },
    ]) });
    const section = screen.getByRole('region', { name: 'Mis citas' });
    await within(section).findByText('Tu próxima cita');
    expect(section).toHaveTextContent('con Dr(a). Laura Mora');
    expect(section).toHaveTextContent('Tu odontólogo no podrá atender.');
    fireEvent.click(within(section).getByRole('button', { name: 'Cancelar mi cita' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar la cita' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/appointment-requests/1/cancel/', {}));
    expect(await within(section).findByRole('button', { name: /Pedir una cita/ })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: /Pedir una cita/ }));
    expect(menuLink('Asistente')).toHaveAttribute('aria-current', 'page');
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

  it('conversa sin «enviar reportes» ni mostrar niveles de alerta', async () => {
    api.post.mockImplementation(async (url, body) => {
      if (body.text === 'Se me despegó un bracket') {
        return turn([msg(1, 'patient', body.text), msg(2, 'assistant', 'Gracias. Del 0 al 10, ¿cuánto dolor sientes ahora?')]);
      }
      if (body.pain_level === 4) {
        return turn([msg(1, 'patient', 'Se me despegó un bracket'), msg(2, 'assistant', 'Del 0 al 10...'), msg(3, 'patient', 'Dolor 4/10'),
          msg(4, 'assistant', '¿Te sientes mejor, igual o peor que ayer?')]);
      }
      return turn([msg(5, 'assistant', 'Gracias por contarme. Sigue con tus cuidados.')]);
    });
    await show(undefined, 'Asistente');
    // Sin pregunta del dolor aún, no hay botones de EVA.
    expect(screen.queryByRole('button', { name: '4' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'Se me despegó un bracket' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    expect(await screen.findByText(/cuánto dolor sientes ahora/)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Tu dolor ahora, de 0 a 10' })).getByRole('button', { name: '4' }));
    expect(await screen.findByRole('button', { name: 'Igual que ayer' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/assistant/messages/', { text: '', pain_level: 4 });

    fireEvent.click(screen.getByRole('button', { name: 'Igual que ayer' }));
    expect(await screen.findByText('Gracias por contarme. Sigue con tus cuidados.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar reporte/ })).toBeNull();
    expect(screen.queryByText(/Nivel de alerta|Alerta amarilla|reporte/i)).toBeNull();
    expect(api.post.mock.calls.map(([url]) => url)).not.toContain('/assistant/submit/');
    // Cada mensaje refresca en segundo plano las citas pedidas.
    await waitFor(() => expect(api.get.mock.calls.filter(([url]) => url === '/appointment-requests/').length).toBeGreaterThan(1));
  });

  it('pide una cita en la conversación con respuestas sugeridas y una fecha', async () => {
    const choices = { choices: ['Mañana', 'Pasado mañana', 'La próxima semana'], input: 'date' };
    api.post.mockImplementation(async (url, body) => {
      if (body.text === 'Quiero pedir una cita de revisión') {
        return turn([msg(1, 'patient', body.text), msg(2, 'assistant', 'Claro. ¿Qué día prefieres?', choices)]);
      }
      if (body.appointment_date) {
        return turn([msg(3, 'assistant', '¿Prefieres por la mañana o por la tarde?', { choices: ['Por la mañana', 'Por la tarde'] })]);
      }
      return turn([msg(4, 'assistant', 'Listo: pedí tu cita. El consultorio la confirmará.')]);
    });
    await show(undefined, 'Asistente');
    fireEvent.click(screen.getByRole('button', { name: 'Pedir una cita' }));
    const suggested = await screen.findByRole('group', { name: 'Respuestas sugeridas' });
    expect(within(suggested).getAllByRole('button').map((button) => button.textContent)).toEqual(['Mañana', 'Pasado mañana', 'La próxima semana', 'Elegir']);
    fireEvent.change(within(suggested).getByLabelText('Otra fecha'), { target: { value: '2099-01-15' } });
    fireEvent.click(within(suggested).getByRole('button', { name: 'Elegir' }));
    expect(api.post).toHaveBeenLastCalledWith('/assistant/messages/', { text: '', appointment_date: '2099-01-15' });
    fireEvent.click(await screen.findByRole('button', { name: 'Por la tarde' }));
    expect(api.post).toHaveBeenLastCalledWith('/assistant/messages/', { text: 'Por la tarde' });
    expect(await screen.findByText(/El consultorio la confirmará/)).toBeInTheDocument();
  });

  it('recupera la conversación abierta y muestra si usa IA', async () => {
    await show({
      '/assistant/messages/': {
        ai_enabled: true,
        conversation: { id: 7, messages: [msg(1, 'patient', 'me duele un poco'), msg(2, 'assistant', '¿Te sientes mejor, igual o peor que ayer?')] },
      },
    }, 'Asistente');
    expect(await screen.findByText('me duele un poco')).toBeInTheDocument();
    expect(screen.getByText('IA')).toBeInTheDocument();
    // La última pregunta fue la comparación: se ofrecen esas respuestas, no el EVA.
    expect(screen.getByRole('button', { name: 'Peor que ayer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '10' })).toBeNull();
  });

  it('un mensaje a medio escribir no se pierde al cambiar de pestaña', async () => {
    await show(undefined, 'Asistente');
    fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'Me duele' } });
    openTab('Mis cuidados');
    openTab('Asistente');
    expect(screen.getByLabelText('Mensaje para el asistente')).toHaveValue('Me duele');
  });

  it('los atajos guían la descripción de síntomas (RU01)', async () => {
    await show(undefined, 'Asistente');
    fireEvent.click(screen.getByRole('button', { name: 'Sangrado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Llaga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sangrado' }));
    expect(screen.getByLabelText('Mensaje para el asistente')).toHaveValue('Tengo sangrado. Tengo una llaga');
  });

  it('sin tratamiento activo no se puede conversar (RF02)', async () => {
    await show({ '/treatment-plans/': page([]) }, 'Asistente');
    expect(screen.getByText(/cuando tu odontólogo registre tu tratamiento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir una cita' })).toBeDisabled();
    expect(screen.getByLabelText('Mensaje para el asistente')).toBeDisabled();
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

  it('sin receta vigente lo dice', async () => {
    await show(undefined, 'Mis cuidados');
    expect(screen.getByText('No tienes medicación recetada en este momento.')).toBeInTheDocument();
  });

  it('un medicamento sin ficha lo indica en lugar de inventar efectos, y la medicación anterior queda plegada', async () => {
    await show({ '/prescriptions/': page([{ ...prescription, medication_guidance: null }, { ...prescription, id: 2, is_active: false }]) }, 'Mis cuidados');
    expect(screen.getByText(/Aún no hay información de efectos para este medicamento/)).toBeInTheDocument();
    expect(screen.getByText('Medicación anterior (1)')).toBeInTheDocument();
  });
});
