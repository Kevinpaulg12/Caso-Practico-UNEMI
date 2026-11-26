"""Asistente de acompañamiento diario del paciente.

El paciente conversa sobre cómo se siente; no llena ni «envía» reportes. Cada mensaje pasa por el PLN
local (spaCy + EntityRuler), que extrae síntomas, dolor, duración y cuidados, y actualiza en silencio el
seguimiento del día, que clasifica el motor local de reglas. El paciente nunca ve ese nivel de alerta.

- El modelo de lenguaje, si está disponible, redacta la respuesta y elige la siguiente pregunta; si no,
  el sistema pregunta siguiendo el protocolo del tratamiento. Ninguna pregunta se repite en el día.
- Las dudas sobre qué hacer se responden solo citando lo que escribió el odontólogo (ai/explain.py).
- El paciente puede pedir una cita de revisión: el asistente le pregunta el día y la franja y deja una
  solicitud que el consultorio confirma.
"""
import json
import re
from datetime import date, timedelta
from typing import Literal

from django.db import transaction
from django.utils import timezone
from django.utils.formats import date_format
from pydantic import BaseModel, Field
from rest_framework.exceptions import ValidationError

from ..appointments import (
    CLINIC_PHONE, SlotTaken, book, bookable_days, bookable_doctors, cancel, describe, free_days, free_slots, name_of, schedule_of,
    upcoming_booking,
)
from ..models import AIInteraction, AppointmentRequest, AssistantConversation, AssistantMessage
from ..nlp import affirmed_symptoms, care_mentions, extract_entities, longest_duration, plain
from ..reports import NO_ACTIVE_PLAN, latest_plan, record_daily_followup
from .anonymize import mask, plan_context
from .client import AIUnavailable, structured_call, structured_stream
from .explain import answer_question
from .prompts import CARE_CATEGORIES, SYMPTOM_CATEGORIES, assistant_system

GENERAL_QUESTIONS = (
    '¿Hay algo más que quieras contarle a tu odontólogo sobre cómo te sientes?',
)
PAIN_QUESTION = 'Del 0 al 10, ¿cuánto dolor sientes ahora? (0 es nada de dolor y 10 el peor dolor imaginable)'
COMPARISON_QUESTION = '¿Te sientes mejor, igual o peor que ayer?'
# Más preguntas al día se sienten como un interrogatorio.
MAX_QUESTIONS_PER_DAY = 4
CLOSING = 'Gracias por contarme. Sigue con tus cuidados y escríbeme si algo cambia durante el día.'
COMPARISON_WORDS = {
    'lower': ('mejor', 'menos', 'disminuy', 'bajo', 'mejorando'),
    'higher': ('peor', 'mas dolor', 'aumento', 'empeor', 'subio'),
    'same': ('igual', 'lo mismo', 'sin cambio', 'parecido'),
}
NUMBER_WORDS = {'cero': 0, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7,
                'ocho': 8, 'nueve': 9, 'diez': 10}

# Dudas sobre qué hacer: se responden citando al odontólogo, nunca con consejos propios.
CARE_QUESTION = re.compile(
    r'\bque (hago|puedo hacer|debo hacer|me tomo|tomo|me pongo)\b'
    r'|\bcomo (calmo|alivio|bajo|quito|controlo|me cuido|cuido|limpio|me cepillo)\b'
    r'|\bpuedo (tomar|comer|beber|cepillar|enjuag|fumar|hacer|usar|lavar|dormir|hacer ejercicio)\w*'
    r'|\bes normal\b|\bdebo (tomar|seguir|usar|evitar)\b|\bque (debo|puedo) (comer|evitar|tomar)\b'
    r'|\bcada cuant[oa]s?\b|\bhasta cuando\b'
)
APPOINTMENT_REQUEST = re.compile(
    r'\b(agendar|agendarme|reservar)\b'
    r'|\b(quiero|necesito|quisiera|deseo|pedir|solicitar|sacar|separar|gustaria|programar|tener)\b'
    r'[^.?!]{0,40}\b(cita|turno|revision|consulta)\b'
)
CANCEL = re.compile(r'\b(cancela|cancelar|olvidalo|ya no|mejor no|no quiero)\b')
WEEKDAYS = {'lunes': 0, 'martes': 1, 'miercoles': 2, 'jueves': 3, 'viernes': 4, 'sabado': 5, 'domingo': 6}


class ExtractedSymptom(BaseModel):
    categoria: Literal[tuple(SYMPTOM_CATEGORIES)]
    intensidad: Literal['leve', 'moderada', 'alta'] | None = None
    negado: bool = False


class CareMention(BaseModel):
    categoria: Literal[tuple(CARE_CATEGORIES)]
    cumplido: bool


class AssistantTurn(BaseModel):
    respuesta: str = Field(description='Respuesta breve y empática al último mensaje del paciente.')
    pregunta: str | None = Field(default=None, description='Única pregunta siguiente, o null si no hace falta otra.')
    dolor_eva: int | None = Field(default=None, description='Dolor 0-10 solo si el paciente lo dijo explícitamente.')
    comparacion: Literal['lower', 'same', 'higher'] | None = None
    sintomas: list[ExtractedSymptom] = Field(default_factory=list)
    cuidados: list[CareMention] = Field(default_factory=list)


# --- Extracción local ------------------------------------------------------------------------------

def parse_pain(text, answering_pain=False):
    """Nivel de dolor dicho por el paciente: «un 6», «6/10», «dolor de 7», «siete».

    Solo se lee un número si el texto habla del dolor o responde a la pregunta del dolor:
    «tengo 2 llagas» no es un EVA 2.
    """
    words = plain(text)
    talks_about_pain = re.search(r'/\s*10|de\s*10|sobre\s*10|\beva\b|dolor|duele', words)
    if not (talks_about_pain or (answering_pain and len(words.split()) <= 4)):
        return None
    match = re.search(r'\b(10|[0-9])\s*(?:/\s*10|de\s*10|sobre\s*10)?\b', words)
    if match:
        return int(match.group(1))
    for word, value in NUMBER_WORDS.items():
        if re.search(rf'\b{word}\b', words):
            return value
    return None


def parse_comparison(text):
    words = plain(text)
    for value, cues in COMPARISON_WORDS.items():
        if any(cue in words for cue in cues):
            return value
    return None


def local_extraction(text):
    entities = extract_entities(text)
    negated = sorted({item['category'] for item in entities if item.get('label') == 'SINTOMA' and item['negated']})
    return {
        'symptoms': affirmed_symptoms(entities),
        'negated': negated,
        'duration': longest_duration(entities),
        'care': care_mentions(entities),
    }


def merge(collected, extracted, pain_level=None, comparison=None):
    collected.setdefault('symptoms', {})
    collected.setdefault('negated', [])
    collected.setdefault('care', {})
    collected.setdefault('asked', [])
    for category, intensity in extracted['symptoms'].items():
        collected['symptoms'][category] = intensity or collected['symptoms'].get(category)
    collected['negated'] = sorted(set(collected['negated']) | set(extracted['negated']))
    collected['care'].update(extracted['care'])
    if extracted['duration'] is not None:
        collected['duration'] = max(collected.get('duration') or 0, extracted['duration'])
    if pain_level is not None:
        collected['pain_level'] = pain_level
    if comparison is not None:
        collected['comparison'] = comparison
    return collected


# --- Preguntas: ninguna se repite en el día ----------------------------------------------------------

def _normalized(question):
    return ' '.join(re.findall(r'\w+', plain(question or '')))


def already_asked(question, asked):
    wanted = _normalized(question)
    return any(wanted == _normalized(item) or (len(wanted) > 15 and wanted in _normalized(item)) for item in asked)


def asks_pain(question):
    words = _normalized(question)
    return bool(re.search(r'\b0 al 10\b|\bdel 0\b|\bescala\b|\beva\b', words)) or ('dolor' in words and 'cuanto' in words)


def asks_comparison(question):
    words = _normalized(question)
    return 'ayer' in words and 'mejor' in words


def redundant(question, collected):
    """Pregunta ya hecha hoy o sobre algo que el paciente ya contó."""
    return (already_asked(question, collected.get('asked', []))
            or (asks_pain(question) and collected.get('pain_level') is not None)
            or (asks_comparison(question) and bool(collected.get('comparison'))))


def protocol_questions(plan, collected):
    questions = (plan.clinical_procedure.follow_up_questions if plan.clinical_procedure_id else None) or {}
    ordered = []
    for category in collected.get('symptoms', {}):
        ordered += questions.get(category, [])
    ordered += questions.get('*', [])
    return ordered + list(GENERAL_QUESTIONS)


def next_question(plan, collected):
    """Siguiente pregunta del protocolo que aún no se hizo hoy (o None si no hace falta otra)."""
    if len(collected.get('asked', [])) >= MAX_QUESTIONS_PER_DAY:
        return None
    candidates = [PAIN_QUESTION, COMPARISON_QUESTION, *protocol_questions(plan, collected)]
    return next((item for item in candidates if not redundant(item, collected)), None)


GREETING = re.compile(r'^\s*(hola|buen(os|as)? (dias|tardes|noches)|buenas|que tal|hey)\b')
THANKS = re.compile(r'\b(gracias|muy amable|ok gracias|listo|perfecto|vale)\b')
MEDICATION_TAKEN = (
    '¡Muy bien que tomaste tu medicación! Sigue con el horario que te indicó tu odontólogo. '
    'Cuéntame más tarde cómo vas.'
)
CARE_DONE = '¡Qué bien que sigues tus cuidados! Eso ayuda mucho a tu recuperación.'


def local_turn(plan, collected, extracted=None, text=''):
    """Respuesta sin IA: responde a lo que el paciente acaba de contar antes de preguntar nada.

    - Si cuenta que tomó su medicación o cumplió un cuidado, se lo reconoce y no lo interroga.
    - Si describe un síntoma nuevo, muestra empatía y pregunta lo que el protocolo sugiere para ese síntoma.
    - Un saludo o un «gracias» recibe una respuesta breve, sin forzar la pregunta del dolor.
    """
    extracted = extracted or {'symptoms': {}, 'care': {}}
    words = plain(text)
    care = extracted.get('care', {})
    question = next_question(plan, collected)
    if care.get('Medicación') is True and not extracted['symptoms']:
        return {'reply': MEDICATION_TAKEN, 'question': None}
    if extracted['symptoms']:
        # Sin nombrar la categoría que detectó el sistema: el paciente nunca ve el triaje.
        reply = 'Lamento que estés con esa molestia; gracias por contármelo, así tu odontólogo estará al tanto.'
        return {'reply': reply, 'question': question}
    if any(care.values()):
        return {'reply': CARE_DONE + ' Cuéntame más tarde cómo sigues.', 'question': None}
    if GREETING.search(words) and not collected.get('symptoms') and collected.get('pain_level') is None:
        return {'reply': '¡Hola! Qué gusto saludarte.', 'question': '¿Cómo te sientes hoy con tu tratamiento?'
                if not already_asked('¿Cómo te sientes hoy con tu tratamiento?', collected.get('asked', [])) else question}
    if THANKS.search(words) and len(words.split()) <= 6:
        return {'reply': '¡Con gusto! Aquí estaré si necesitas algo; escríbeme cuando quieras contarme cómo vas.',
                'question': None}
    if question is None:
        return {'reply': CLOSING, 'question': None}
    return {'reply': 'Gracias por contarme.', 'question': question}


# --- Turno con el modelo de lenguaje -----------------------------------------------------------------

def _llm_request(plan, conversation, collected, patient):
    history = [
        {'rol': message.role, 'texto': mask(message.text, patient)}
        for message in conversation.messages.order_by('-created_at', '-id')[:12]
    ][::-1]
    payload = {
        'contexto_del_tratamiento': plan_context(plan),
        'codigo_de_protocolo': plan.clinical_procedure.code if plan.clinical_procedure_id else None,
        'datos_reunidos_hoy': {key: value for key, value in collected.items() if key not in ('asked', 'appointment')},
        'preguntas_ya_hechas_hoy': collected.get('asked', []),
        'conversacion': history,
    }
    return {
        'system': assistant_system(),
        'user': json.dumps(payload, ensure_ascii=False),
        'output_format': AssistantTurn,
        'max_tokens': 1200,
    }


def llm_turn(plan, conversation, collected, patient):
    return structured_call(
        AIInteraction.Feature.ASSISTANT, effort='low', **_llm_request(plan, conversation, collected, patient),
    )


def llm_turn_stream(plan, conversation, collected, patient):
    """Igual que llm_turn, pero va entregando ('delta', texto) mientras el modelo redacta la respuesta."""
    stream = structured_stream(
        AIInteraction.Feature.ASSISTANT, text_field='respuesta', **_llm_request(plan, conversation, collected, patient),
    )
    try:
        while True:
            try:
                partial = next(stream)
            except StopIteration as finished:
                return finished.value
            yield 'delta', partial
    finally:
        stream.close()


# --- Solicitud de cita -------------------------------------------------------------------------------

def wants_appointment(text):
    return bool(APPOINTMENT_REQUEST.search(plain(text)))


QUESTION_START = re.compile(r'^\s*(que|como|puedo|debo|es normal|cada|hasta|cuando|cuanto|se puede|tengo que)\b')


def wants_instructions(text):
    """Una duda real sobre qué hacer («¿qué hago si…?»), no un relato («ya me tomé la pastilla»)."""
    words = plain(text)
    asks = '?' in text or '¿' in text or bool(QUESTION_START.search(words))
    return asks and bool(CARE_QUESTION.search(words))


def parse_preferred_date(text, today):
    words = plain(text)
    if re.search(r'\bpasado manana\b', words):
        return today + timedelta(days=2)
    if re.search(r'\bmanana\b', words):
        return today + timedelta(days=1)
    if re.search(r'\bhoy\b', words):
        return today
    if re.search(r'\b(proxima|siguiente|otra) semana\b', words):
        return today + timedelta(days=7 - today.weekday())
    iso = re.search(r'\b(\d{4})-(\d{2})-(\d{2})\b', words)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None
    numeric = re.search(r'\b(\d{1,2})[/-](\d{1,2})\b', words)
    if numeric:
        try:
            chosen = date(today.year, int(numeric.group(2)), int(numeric.group(1)))
        except ValueError:
            return None
        return chosen if chosen >= today else chosen.replace(year=today.year + 1)
    for name, weekday in WEEKDAYS.items():
        if re.search(rf'\b{name}\b', words):
            return today + timedelta(days=(weekday - today.weekday() - 1) % 7 + 1)
    return None


TIME = re.compile(r'\b(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm|de la manana|de la tarde)?\b')


def parse_time(text):
    """«8:30», «08h30», «3 pm», «3 de la tarde» → (hora, minuto) o None."""
    match = TIME.search(plain(text))
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2) or 0)
    if match.group(3) in ('pm', 'de la tarde') and hour < 12:
        hour += 12
    return (hour, minute) if hour < 24 and minute < 60 else None


def long_date(value):
    return date_format(value, 'l j \\d\\e F')


def short_day(value):
    """«Lun 24 nov»: etiqueta de un día con cupo para los botones del chat."""
    return date_format(value, 'D j M').capitalize()


def hour_label(moment):
    return f'{timezone.localtime(moment):%H:%M}'


MANAGE_CHOICES = ['Cambiar mi cita', 'Cancelar mi cita', 'Mantenerla']
NO_AGENDA = (
    'Tu odontólogo todavía no tiene su agenda en línea, así que no puedo reservarte un turno. '
    f'Llama a la clínica al {CLINIC_PHONE} para agendar.'
)


def _offer_days(doctor, schedule, state, reply, after=None):
    days = free_days(doctor, limit=5, schedule=schedule, after=after)
    if not days:
        return {'reply': f'{reply} No quedan turnos libres en los próximos {schedule.max_days_ahead} días. '
                         f'Llama a la clínica al {CLINIC_PHONE} y te ayudarán.', 'question': None, 'end': True}
    state['days'] = {short_day(day): day.isoformat() for day in days}
    state['step'] = 'date'
    return {'reply': reply, 'question': '¿Qué día te queda bien?', 'choices': list(state['days']), 'input': 'date'}


def _offer_hours(doctor, schedule, state, day, reply=''):
    slots = free_slots(doctor, day, schedule)
    if not slots:
        return _offer_days(doctor, schedule, state, f'{reply} Ese día ya no hay turnos libres.'.strip(), after=day)
    state.update(step='time', date=day.isoformat())
    return {'reply': f'{reply} Estos son los horarios libres del {long_date(day)}.'.strip(),
            'question': '¿A qué hora?', 'choices': [hour_label(slot) for slot in slots]}


def doctor_label(doctor, primary=None):
    label = f'Dr(a). {name_of(doctor)}'
    return f'{label} (tu odontólogo)' if doctor == primary else label


def appointment_turn(patient, plan, collected, text, chosen_date=None):
    """Reserva de cita en la agenda del odontólogo: día con cupo → hora libre → reservada al instante.

    Siempre local y determinista. Si el paciente ya tiene una cita, puede cambiarla o cancelarla.
    """
    state = collected.get('appointment')
    words = plain(text)
    profile = getattr(patient, 'profile', None)
    primary = profile.primary_doctor if profile else None
    # Con un tratamiento en curso la cita es con su odontólogo; tras el alta puede elegir otro.
    doctor = primary
    if state and state.get('doctor'):
        from users.models import User
        doctor = User.objects.filter(pk=state['doctor'], role=User.Roles.DOCTOR, is_active=True).first() or primary
    schedule = schedule_of(doctor)

    if state is None:
        existing = upcoming_booking(patient)
        if existing:
            collected['appointment'] = {'step': 'manage', 'existing': existing.pk, 'reason': mask(text, patient)[:300]}
            return {'reply': f'Ya tienes una cita el {describe(existing.starts_at)} con Dr(a). {name_of(existing.doctor)}.',
                    'question': '¿Quieres cambiarla o cancelarla?', 'choices': MANAGE_CHOICES}
        reason = mask(text, patient)[:300]
        if not plan.is_active:
            options = bookable_doctors(primary)
            if len(options) > 1:
                labels = {doctor_label(item, primary): item.pk for item in options}
                collected['appointment'] = {'reason': reason, 'step': 'doctor', 'doctors': labels}
                return {'reply': 'Claro, te ayudo a reservar una cita. Como tu tratamiento anterior ya terminó, '
                                 'puedes elegir con qué odontólogo; quien te atienda podrá revisar tu historia clínica.',
                        'question': '¿Con quién quieres la cita?', 'choices': list(labels)}
            if options:
                doctor = options[0]
                schedule = schedule_of(doctor)
        if schedule is None:
            return {'reply': NO_AGENDA, 'question': None}
        state = collected['appointment'] = {'reason': reason, 'doctor': doctor.pk}
        reply = _offer_days(doctor, schedule, state, f'Claro, te ayudo a reservar una cita con Dr(a). {name_of(doctor)}.')
        if reply.pop('end', False):
            collected.pop('appointment', None)
        return reply

    if state.get('step') == 'manage':
        existing = AppointmentRequest.objects.filter(pk=state.get('existing'), status=AppointmentRequest.Status.BOOKED).first()
        if existing is None:
            collected.pop('appointment', None)
            return {'reply': 'Esa cita ya no está reservada. Si quieres otra, dime «quiero una cita».', 'question': None}
        if 'cancel' in words:
            cancel(existing, patient, 'El paciente canceló desde el asistente.')
            collected.pop('appointment', None)
            return {'reply': f'Listo, cancelé tu cita del {describe(existing.starts_at)}. El turno quedó libre para otro paciente.',
                    'question': None}
        if 'cambi' in words or 'otra' in words or 'mover' in words:
            doctor = existing.doctor or doctor
            schedule = schedule_of(doctor)
            if schedule is None:
                collected.pop('appointment', None)
                return {'reply': NO_AGENDA, 'question': None}
            state['replaces'] = existing.pk
            state['doctor'] = doctor.pk
            reply = _offer_days(doctor, schedule, state, 'De acuerdo, busquemos otro turno; tu cita actual se mantiene hasta que elijas uno nuevo.')
            if reply.pop('end', False):
                collected.pop('appointment', None)
            return reply
        collected.pop('appointment', None)
        return {'reply': f'Perfecto, mantenemos tu cita del {describe(existing.starts_at)}.', 'question': None}

    if CANCEL.search(words):
        collected.pop('appointment', None)
        return {'reply': 'Entendido, no reservaré la cita. Si cambias de opinión, solo escríbeme.', 'question': None}
    if state.get('step') == 'doctor':
        options = state.get('doctors', {})
        chosen = next((pk for label, pk in options.items() if plain(label) == words.strip()), None)
        if chosen is None:
            # También vale escribir solo el nombre o el apellido.
            chosen = next((pk for label, pk in options.items() if words.strip() and words.strip() in plain(label)), None)
        if chosen is None:
            return {'reply': 'No encontré a ese odontólogo.', 'question': 'Elige uno de la lista.', 'choices': list(options)}
        from users.models import User
        doctor = User.objects.filter(pk=chosen, role=User.Roles.DOCTOR, is_active=True).first()
        schedule = schedule_of(doctor)
        if schedule is None:
            collected.pop('appointment', None)
            return {'reply': NO_AGENDA, 'question': None}
        state.pop('doctors', None)
        state['doctor'] = doctor.pk
        reply = _offer_days(doctor, schedule, state, f'Perfecto, con Dr(a). {name_of(doctor)}.')
        if reply.pop('end', False):
            collected.pop('appointment', None)
        return reply
    if schedule is None:
        collected.pop('appointment', None)
        return {'reply': NO_AGENDA, 'question': None}

    today = timezone.localdate()
    if state.get('step') == 'date':
        chosen = chosen_date
        if chosen is None and text.strip():
            label = next((key for key in state.get('days', {}) if plain(key) == words.strip()), None)
            chosen = date.fromisoformat(state['days'][label]) if label else parse_preferred_date(text, today)
        if chosen is None:
            return {'reply': 'No entendí la fecha.', 'question': 'Elige uno de los días o escribe una fecha, por ejemplo 25/11.',
                    'choices': list(state.get('days', {})), 'input': 'date'}
        first, last = bookable_days(schedule, today)
        if not first <= chosen <= last:
            reply = _offer_days(doctor, schedule, state, f'Puedo reservar desde hoy y hasta {schedule.max_days_ahead} días adelante.')
            if reply.pop('end', False):
                collected.pop('appointment', None)
            return reply
        reply = _offer_hours(doctor, schedule, state, chosen)
        if reply.pop('end', False):
            collected.pop('appointment', None)
        return reply

    # Paso de la hora.
    day = date.fromisoformat(state['date'])
    wanted = parse_time(text)
    slots = free_slots(doctor, day, schedule)
    slot = next((item for item in slots if wanted and timezone.localtime(item).timetuple()[3:5] == wanted), None)
    if slot is None:
        reply = _offer_hours(doctor, schedule, state, day, 'Esa hora no está libre.' if wanted else 'No entendí la hora.')
        if reply.pop('end', False):
            collected.pop('appointment', None)
        return reply
    try:
        item = book(patient, plan, doctor, slot, state.get('reason', ''))
    except SlotTaken:
        reply = _offer_hours(doctor, schedule, state, day, 'Esa hora se acaba de ocupar.')
        if reply.pop('end', False):
            collected.pop('appointment', None)
        return reply
    previous = state.get('replaces')
    if previous:
        old = AppointmentRequest.objects.filter(pk=previous, status=AppointmentRequest.Status.BOOKED).first()
        if old:
            cancel(old, patient, 'El paciente cambió su cita por otro turno.')
    collected.pop('appointment', None)
    return {'reply': f'Listo: tu cita quedó reservada para el {describe(item.starts_at)} con Dr(a). {name_of(doctor)}. '
                     'Te enviamos la confirmación por correo. Si no puedes asistir, avísame para liberar el turno.',
            'question': None}


DISCHARGED_REPLY = (
    'Tu tratamiento ya terminó y tu odontólogo te dio de alta, así que ya no hago seguimiento diario. '
    'Si quieres volver a consulta, dime «quiero una cita» y te reservo un turno con el odontólogo que elijas. '
    'Si tienes una molestia, comunícate con la clínica: 04 270 0000.'
)


# --- Turno completo ----------------------------------------------------------------------------------

def handle_message(patient, text, pain_level=None, comparison=None, appointment_date=None):
    """Procesa un mensaje del paciente y devuelve la respuesta del asistente."""
    for kind, value in message_events(patient, text, pain_level, comparison, appointment_date=appointment_date):
        if kind == 'done':
            return value


def message_events(patient, text, pain_level=None, comparison=None, stream=False, appointment_date=None):
    """Procesa un mensaje del paciente como una secuencia de eventos.

    Con stream=True produce ('delta', texto parcial) mientras el modelo escribe; siempre termina con
    ('done', resultado). Los errores de validación se lanzan antes del primer evento.
    """
    text = (text or '').strip()
    if not text and pain_level is None and comparison is None and appointment_date is None:
        raise ValidationError({'text': 'Escribe cómo te sientes.'})
    if len(text) > 1000:
        raise ValidationError({'text': 'El mensaje no puede superar 1000 caracteres.'})
    if pain_level is not None and not 0 <= int(pain_level) <= 10:
        raise ValidationError({'pain_level': 'El nivel de dolor debe estar entre 0 y 10.'})
    # Tras el alta el último tratamiento sigue sirviendo para pedir una cita o consultar sus indicaciones;
    # ya no hay seguimiento diario de síntomas.
    plan = latest_plan(patient)
    if plan is None:
        raise ValidationError({'detail': NO_ACTIVE_PLAN})
    # Todo el turno es una sola transacción: si el paciente cierra la página a mitad, no queda nada a medias.
    with transaction.atomic():
        result = yield from _turn(patient, plan, text, pain_level, comparison, appointment_date, stream)
    yield 'done', result


def _turn(patient, plan, text, pain_level, comparison, appointment_date, stream):
    conversation = open_conversation(patient, plan)
    previous = conversation.collected
    collected = dict(previous)
    in_appointment = bool(collected.get('appointment'))
    starts_appointment = not in_appointment and wants_appointment(text)
    closed = not plan.is_active
    # Responder al asistente con una fecha o una franja no describe cómo se siente; tras el alta,
    # lo que cuente tampoco abre un seguimiento clínico.
    clinical = not in_appointment and appointment_date is None and not closed
    extracted = local_extraction(text) if clinical else {'symptoms': {}, 'negated': [], 'duration': None, 'care': {}}
    if clinical:
        last_question = (previous.get('asked') or [None])[-1]
        if pain_level is None and previous.get('pain_level') is None:
            pain_level = parse_pain(text, answering_pain=last_question == PAIN_QUESTION)
        if not comparison and not previous.get('comparison'):
            comparison = parse_comparison(text)
    collected = merge(collected, extracted, pain_level, comparison)
    shown = text or ' · '.join(filter(None, (
        f'Dolor {pain_level}/10' if pain_level is not None else None,
        {'lower': 'Mejor que ayer', 'same': 'Igual que ayer', 'higher': 'Peor que ayer'}.get(comparison),
        long_date(appointment_date) if appointment_date else None,
    )))
    AssistantMessage.objects.create(
        conversation=conversation, role=AssistantMessage.Role.PATIENT, text=shown,
        extracted={**extracted, 'clinical': clinical},
    )

    source, model, llm_view = 'local', '', None
    if in_appointment or starts_appointment:
        reply = appointment_turn(patient, plan, collected, text, appointment_date)
    elif text and wants_instructions(text):
        answer = answer_question(plan, text)
        source, model = answer['source'], answer['model']
        reply = {'reply': answer['answer'], 'question': None}
    elif closed:
        reply = {'reply': DISCHARGED_REPLY, 'question': None}
    else:
        try:
            if stream:
                turn, model = yield from llm_turn_stream(plan, conversation, collected, patient)
            else:
                turn, model = llm_turn(plan, conversation, collected, patient)
            source = 'llm'
            # Lo que el modelo entiende queda registrado para comparar con el PLN local, pero el triaje
            # solo usa el texto del paciente: el EVA del modelo se acepta si el paciente escribió ese número.
            if collected.get('pain_level') is None and turn.dolor_eva is not None and str(turn.dolor_eva) in text:
                collected['pain_level'] = turn.dolor_eva
            if not collected.get('comparison') and turn.comparacion:
                collected['comparison'] = turn.comparacion
            for mention in turn.cuidados:
                collected.setdefault('care', {}).setdefault(mention.categoria, mention.cumplido)
            question = turn.pregunta
            if question and redundant(question, collected):
                # El modelo no puede volver a preguntar lo que ya se preguntó o ya se sabe.
                question = next_question(plan, collected)
            if len(collected.get('asked', [])) >= MAX_QUESTIONS_PER_DAY:
                question = None
            reply = {'reply': turn.respuesta, 'question': question}
            llm_view = {
                'sintomas': [item.model_dump() for item in turn.sintomas],
                'cuidados': [item.model_dump() for item in turn.cuidados],
            }
        except AIUnavailable:
            reply = local_turn(plan, collected, extracted, text)
    # Las preguntas para pedir la cita no cuentan: no son preguntas sobre cómo se siente.
    if reply.get('question') and not (in_appointment or starts_appointment):
        collected.setdefault('asked', []).append(reply['question'])

    text_out = ' '.join(filter(None, (reply['reply'], reply.get('question'))))
    answer = AssistantMessage.objects.create(
        conversation=conversation, role=AssistantMessage.Role.ASSISTANT, text=text_out, source=source,
        extracted={'llm': llm_view, 'model': model, 'choices': reply.get('choices', []), 'input': reply.get('input')}
        if (llm_view or reply.get('choices')) else {},
    )
    conversation.collected = collected
    # El seguimiento del día se actualiza en silencio con todo lo que el paciente contó hoy.
    if not closed:
        conversation.report = record_daily_followup(
            patient, plan, clinical_texts(conversation), collected.get('pain_level'), collected.get('comparison'),
            report=conversation.report,
        )
    conversation.save(update_fields=['collected', 'report', 'updated_at'])
    return {
        'conversation': conversation_payload(conversation),
        'message': message_payload(answer),
        'source': source,
    }


def clinical_texts(conversation):
    return [
        message.text for message in conversation.messages.filter(role=AssistantMessage.Role.PATIENT).exclude(text='')
        if message.extracted.get('clinical', True)
    ]


def open_conversation(patient, plan):
    """Una conversación por tratamiento y día: al día siguiente empieza otra (y otro seguimiento)."""
    conversation = (
        AssistantConversation.objects.select_for_update()
        .filter(patient=patient, is_open=True).order_by('-created_at').first()
    )
    stale = conversation and (conversation.treatment_plan_id != plan.pk
                              or timezone.localtime(conversation.created_at).date() != timezone.localdate())
    if stale:
        conversation.is_open = False
        conversation.save(update_fields=['is_open', 'updated_at'])
        conversation = None
    return conversation or AssistantConversation.objects.create(patient=patient, treatment_plan=plan)


def current_conversation(patient):
    conversation = AssistantConversation.objects.filter(patient=patient, is_open=True).order_by('-created_at').first()
    if conversation and timezone.localtime(conversation.created_at).date() != timezone.localdate():
        return None
    return conversation


def message_payload(message):
    payload = {'id': message.id, 'role': message.role, 'text': message.text, 'source': message.source,
               'created_at': message.created_at}
    if message.role == AssistantMessage.Role.ASSISTANT and message.extracted.get('choices'):
        payload['choices'] = message.extracted['choices']
        payload['input'] = message.extracted.get('input')
    return payload


def conversation_payload(conversation):
    """Lo que ve el paciente: solo la conversación, nunca lo que el sistema extrajo ni el nivel de alerta."""
    return {
        'id': conversation.id,
        'messages': [message_payload(message) for message in conversation.messages.all()],
    }
