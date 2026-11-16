"""Asistente conversacional del autorreporte.

Cada mensaje del paciente pasa primero por el PLN local (spaCy), que extrae síntomas, duración y
cuidados. El modelo de lenguaje, si está disponible, redacta la respuesta y elige la siguiente
pregunta; si no, el sistema pregunta siguiendo el protocolo del tratamiento. Al enviar, el reporte se
clasifica con el mismo motor local de siempre: la conversación nunca decide el nivel de alerta.
"""
import json
import re
from datetime import timedelta
from typing import Literal

from django.db import transaction
from django.utils import timezone
from pydantic import BaseModel, Field
from rest_framework.exceptions import ValidationError

from ..models import AIInteraction, AssistantConversation, AssistantMessage
from ..nlp import affirmed_symptoms, care_mentions, extract_entities, longest_duration, plain
from ..reports import NO_ACTIVE_PLAN, active_plan, save_patient_report
from ..serializers_reports import PatientReportSerializer
from .anonymize import mask, plan_context
from .client import AIUnavailable, structured_call, structured_stream
from .prompts import CARE_CATEGORIES, SYMPTOM_CATEGORIES, assistant_system

CONVERSATION_TTL = timedelta(hours=12)
MAX_REPORT_TEXT = 2000
GENERAL_QUESTIONS = (
    '¿Cómo te sientes hoy comparado con ayer?',
    '¿Hay algo más que quieras contarle a tu odontólogo?',
)
PAIN_QUESTION = 'Del 0 al 10, ¿cuánto dolor sientes ahora? (0 es nada de dolor y 10 el peor dolor imaginable)'
COMPARISON_QUESTION = '¿Te sientes mejor, igual o peor que ayer?'
COMPARISON_WORDS = {
    'lower': ('mejor', 'menos', 'disminuy', 'bajo', 'mejorando'),
    'higher': ('peor', 'mas dolor', 'aumento', 'empeor', 'subio'),
    'same': ('igual', 'lo mismo', 'sin cambio', 'parecido'),
}
NUMBER_WORDS = {'cero': 0, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7,
                'ocho': 8, 'nueve': 9, 'diez': 10}


class ExtractedSymptom(BaseModel):
    categoria: Literal[tuple(SYMPTOM_CATEGORIES)]
    intensidad: Literal['leve', 'moderada', 'alta'] | None = None
    negado: bool = False


class CareMention(BaseModel):
    categoria: Literal[tuple(CARE_CATEGORIES)]
    cumplido: bool


class AssistantTurn(BaseModel):
    respuesta: str = Field(description='Respuesta breve y empática al último mensaje del paciente.')
    pregunta: str | None = Field(default=None, description='Única pregunta siguiente, o null si ya está listo.')
    dolor_eva: int | None = Field(default=None, description='Dolor 0-10 solo si el paciente lo dijo explícitamente.')
    comparacion: Literal['lower', 'same', 'higher'] | None = None
    sintomas: list[ExtractedSymptom] = Field(default_factory=list)
    cuidados: list[CareMention] = Field(default_factory=list)
    listo_para_enviar: bool = False


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


def is_complete(collected, patient_turns):
    """Basta el dolor, la comparación y al menos un mensaje describiendo cómo está."""
    return collected.get('pain_level') is not None and bool(collected.get('comparison')) and patient_turns >= 1


# --- Alternativa local: preguntas del protocolo ------------------------------------------------------

def protocol_questions(plan, collected):
    questions = (plan.clinical_procedure.follow_up_questions if plan.clinical_procedure_id else None) or {}
    ordered = []
    for category in collected.get('symptoms', {}):
        ordered += questions.get(category, [])
    ordered += questions.get('*', [])
    return ordered + list(GENERAL_QUESTIONS)


def local_turn(plan, collected, patient_turns):
    asked = collected.setdefault('asked', [])
    if collected.get('pain_level') is None:
        question = PAIN_QUESTION
    elif not collected.get('comparison'):
        question = COMPARISON_QUESTION
    else:
        question = next((item for item in protocol_questions(plan, collected) if item not in asked), None)
    ready = is_complete(collected, patient_turns) and (question is None or len(asked) >= 3)
    if ready:
        found = ', '.join(category.lower() for category in collected.get('symptoms', {})) or 'ningún síntoma nuevo'
        return {
            'reply': f'Gracias. Registré dolor {collected["pain_level"]}/10 y {found}. '
                     '¿Quieres enviar este reporte a tu odontólogo?',
            'question': None,
            'ready': True,
        }
    asked.append(question)
    return {'reply': 'Gracias por contarme.', 'question': question, 'ready': False}


# --- Turno con el modelo de lenguaje -----------------------------------------------------------------

def _llm_request(plan, conversation, collected, patient):
    history = [
        {'rol': message.role, 'texto': mask(message.text, patient)}
        for message in conversation.messages.order_by('-created_at', '-id')[:12]
    ][::-1]
    payload = {
        'contexto_del_tratamiento': plan_context(plan),
        'codigo_de_protocolo': plan.clinical_procedure.code if plan.clinical_procedure_id else None,
        'datos_reunidos': {key: value for key, value in collected.items() if key != 'asked'},
        'preguntas_ya_hechas': collected.get('asked', []),
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


def handle_message(patient, text, pain_level=None, comparison=None):
    """Procesa un mensaje del paciente y devuelve la respuesta del asistente."""
    for kind, value in message_events(patient, text, pain_level, comparison):
        if kind == 'done':
            return value


def message_events(patient, text, pain_level=None, comparison=None, stream=False):
    """Procesa un mensaje del paciente como una secuencia de eventos.

    Con stream=True produce ('delta', texto parcial) mientras el modelo escribe; siempre termina con
    ('done', resultado). Los errores de validación se lanzan antes del primer evento.
    """
    text = (text or '').strip()
    if not text and pain_level is None and comparison is None:
        raise ValidationError({'text': 'Escribe cómo te sientes.'})
    if len(text) > 1000:
        raise ValidationError({'text': 'El mensaje no puede superar 1000 caracteres.'})
    if pain_level is not None and not 0 <= int(pain_level) <= 10:
        raise ValidationError({'pain_level': 'El nivel de dolor debe estar entre 0 y 10.'})
    plan = active_plan(patient)
    if plan is None:
        raise ValidationError({'detail': NO_ACTIVE_PLAN})
    # Todo el turno es una sola transacción: si el paciente cierra la página a mitad, no queda nada a medias.
    with transaction.atomic():
        result = yield from _turn(patient, plan, text, pain_level, comparison, stream)
    yield 'done', result


def _turn(patient, plan, text, pain_level, comparison, stream):
    conversation = open_conversation(patient, plan)
    extracted = local_extraction(text)
    previous = conversation.collected
    last_question = (previous.get('asked') or [None])[-1]
    if pain_level is None and previous.get('pain_level') is None:
        pain_level = parse_pain(text, answering_pain=last_question == PAIN_QUESTION)
    if not comparison and not previous.get('comparison'):
        comparison = parse_comparison(text)
    collected = merge(dict(conversation.collected), extracted, pain_level, comparison)
    shown = text or ' · '.join(filter(None, (
        f'Dolor {pain_level}/10' if pain_level is not None else None,
        {'lower': 'Mejor que ayer', 'same': 'Igual que ayer', 'higher': 'Peor que ayer'}.get(comparison),
    )))
    AssistantMessage.objects.create(
        conversation=conversation, role=AssistantMessage.Role.PATIENT, text=shown, extracted=extracted,
    )
    patient_turns = conversation.messages.filter(role=AssistantMessage.Role.PATIENT).exclude(text='').count()

    source, model = 'local', ''
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
        if turn.pregunta:
            collected.setdefault('asked', []).append(turn.pregunta)
        ready = turn.listo_para_enviar and is_complete(collected, patient_turns)
        reply = {'reply': turn.respuesta, 'question': None if ready else turn.pregunta, 'ready': ready}
        llm_view = {
            'sintomas': [item.model_dump() for item in turn.sintomas],
            'cuidados': [item.model_dump() for item in turn.cuidados],
        }
    except AIUnavailable:
        reply = local_turn(plan, collected, patient_turns)
        llm_view = None

    text_out = ' '.join(filter(None, (reply['reply'], reply['question'])))
    answer = AssistantMessage.objects.create(
        conversation=conversation, role=AssistantMessage.Role.ASSISTANT, text=text_out, source=source,
        extracted={'llm': llm_view, 'model': model} if llm_view else {},
    )
    conversation.collected = collected
    conversation.save(update_fields=['collected', 'updated_at'])
    return {
        'conversation': conversation_payload(conversation),
        'message': message_payload(answer),
        'ready_to_submit': reply['ready'],
        'source': source,
    }


def open_conversation(patient, plan):
    conversation = (
        AssistantConversation.objects.select_for_update()
        .filter(patient=patient, is_open=True).order_by('-created_at').first()
    )
    stale = conversation and (conversation.treatment_plan_id != plan.pk
                              or timezone.now() - conversation.updated_at > CONVERSATION_TTL)
    if stale:
        conversation.is_open = False
        conversation.save(update_fields=['is_open', 'updated_at'])
        conversation = None
    return conversation or AssistantConversation.objects.create(patient=patient, treatment_plan=plan)


def current_conversation(patient):
    conversation = AssistantConversation.objects.filter(patient=patient, is_open=True).order_by('-created_at').first()
    if conversation and timezone.now() - conversation.updated_at > CONVERSATION_TTL:
        return None
    return conversation


@transaction.atomic
def submit(patient, conversation_id):
    """Convierte la conversación en un autorreporte, clasificado por el motor local."""
    conversation = (
        AssistantConversation.objects.select_for_update()
        .filter(pk=conversation_id, patient=patient, is_open=True).first()
    )
    if conversation is None:
        raise ValidationError({'detail': 'Esta conversación ya se envió o no existe. Empieza una nueva.'})
    collected = conversation.collected
    if collected.get('pain_level') is None or not collected.get('comparison'):
        raise ValidationError({'detail': 'Antes de enviar, indica tu nivel de dolor y si estás mejor, igual o peor.'})
    texts = list(
        conversation.messages.filter(role=AssistantMessage.Role.PATIENT).exclude(text='').values_list('text', flat=True)
    )
    serializer = PatientReportSerializer(data={
        'pain_level': collected['pain_level'],
        'comparison': collected['comparison'],
        'message': '. '.join(texts)[:MAX_REPORT_TEXT],
    })
    serializer.is_valid(raise_exception=True)
    report = save_patient_report(serializer, patient, conversation.treatment_plan or active_plan(patient))
    conversation.report = report
    conversation.is_open = False
    conversation.save(update_fields=['report', 'is_open', 'updated_at'])
    return report


def message_payload(message):
    return {'id': message.id, 'role': message.role, 'text': message.text, 'source': message.source,
            'created_at': message.created_at}


def conversation_payload(conversation):
    collected = conversation.collected or {}
    return {
        'id': conversation.id,
        'collected': {
            'pain_level': collected.get('pain_level'),
            'comparison': collected.get('comparison'),
            'symptoms': collected.get('symptoms', {}),
            'duration': collected.get('duration'),
            'care': collected.get('care', {}),
        },
        'messages': [message_payload(message) for message in conversation.messages.all()],
    }
