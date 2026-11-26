"""Indicaciones en lenguaje sencillo y preguntas del paciente sobre ellas.

Las dudas del paciente se responden citando literalmente lo que escribió el odontólogo (indicaciones,
dieta y receta): si una duda no se responde con ese texto, se deriva al odontólogo. La explicación se guarda y solo se regenera
cuando cambian las indicaciones.
"""
import hashlib
import json
import re

from pydantic import BaseModel, Field

from ..models import AIInteraction, PlainExplanation
from ..nlp import plain
from ..treatments import active_medications, medication_text
from .anonymize import plan_context
from .client import AIUnavailable, ai_enabled, structured_call
from .prompts import explanation_system, question_system

ASK_DOCTOR = 'Esa duda no está en tus indicaciones. Consúltala con tu odontólogo o llama a la clínica al 04 270 0000.'
GENERAL_ALARMS = [
    'Sangrado que no se detiene después de 30 minutos de presión',
    'Fiebre alta o hinchazón que crece hacia el cuello o el ojo',
    'Dificultad para respirar, tragar o abrir la boca',
]
STOPWORDS = {'de', 'la', 'el', 'los', 'las', 'que', 'y', 'a', 'en', 'un', 'una', 'mi', 'me', 'puedo', 'debo',
             'para', 'con', 'por', 'es', 'se', 'lo', 'al', 'del', 'como', 'cuando', 'cuanto', 'cuantas', 'si', 'no'}


class MedicationStep(BaseModel):
    nombre: str
    como_tomarlo: str
    para_que_sirve: str | None = None


class ExplanationOutput(BaseModel):
    resumen: str = Field(description='Una o dos frases sobre de qué trata el tratamiento.')
    pasos: list[str] = Field(default_factory=list, description='Qué hacer, en orden y con palabras sencillas.')
    que_evitar: list[str] = Field(default_factory=list)
    medicacion: list[MedicationStep] = Field(default_factory=list)
    cuando_llamar: list[str] = Field(default_factory=list, description='Señales para llamar a la clínica.')


def source_text(plan):
    """Lo que escribió el odontólogo: es la única fuente que puede usar el modelo."""
    medication = '; '.join(medication_text(item) for item in active_medications(plan))
    parts = {
        'tratamiento': plan.procedure or plan.title,
        'receta': medication,
        'indicaciones': plan.instructions,
        'efectos_a_observar': plan.side_effects,
        'recomendaciones_del_sistema': plan.care_recommendations,
    }
    return {key: value for key, value in parts.items() if value}


def _hash(parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _sentences(text):
    return [sentence.strip(' .') for sentence in re.split(r'[\n.;]+', text or '') if len(sentence.strip()) > 3]


def local_explanation(plan, parts):
    instructions = _sentences(parts.get('indicaciones', ''))
    avoid = [item for item in instructions if plain(item).startswith(('no ', 'evita', 'evitar'))]
    steps = [item for item in instructions if item not in avoid]
    alarms = list(getattr(plan.clinical_procedure, 'alarm_symptoms', None) or [])
    medication = [
        MedicationStep(
            nombre=' '.join(filter(None, (item['medication_name'], item['strength']))),
            como_tomarlo=', '.join(filter(None, (item['dosage_form'], (item['frequency'] or '').lower(),
                                                 f'durante {item["duration"]}' if item['duration'] else ''))),
        )
        for item in active_medications(plan)
    ]
    return ExplanationOutput(
        resumen=f'Estas son las indicaciones de tu odontólogo para tu {(parts.get("tratamiento") or "tratamiento").lower()}.',
        pasos=steps,
        que_evitar=avoid,
        medicacion=medication,
        cuando_llamar=[f'Si notas {item.lower()}' for item in alarms] + GENERAL_ALARMS,
    )


def explanation_for(plan):
    """Devuelve la explicación vigente (la regenera si cambiaron las indicaciones)."""
    parts = source_text(plan)
    digest = _hash(parts)
    current = PlainExplanation.objects.filter(treatment_plan=plan).first()
    if current and current.source_hash == digest and (current.source == 'llm' or not ai_enabled()):
        return current
    payload = {'contexto': plan_context(plan), 'texto_del_odontologo': parts}
    try:
        output, model = structured_call(
            AIInteraction.Feature.EXPLANATION,
            system=explanation_system(),
            user=json.dumps(payload, ensure_ascii=False),
            output_format=ExplanationOutput,
            effort='low',
            max_tokens=1500,
        )
        source = 'llm'
    except AIUnavailable:
        output, model, source = local_explanation(plan, parts), '', 'local'
    explanation, _ = PlainExplanation.objects.update_or_create(
        treatment_plan=plan,
        defaults={'source_hash': digest, 'content': output.model_dump(), 'source': source, 'model': model},
    )
    return explanation



PERSISTS = 'Si la molestia persiste o aumenta, comunícate con la clínica al 04 270 0000.'
MIN_QUOTE = 10


class GroundedAnswer(BaseModel):
    cita: str | None = Field(
        default=None, description='Fragmento copiado literalmente de las indicaciones que responde la duda, o null.',
    )


def doctor_text(plan):
    """Lo que el odontólogo dejó escrito para el paciente: lo único que el asistente puede citar."""
    medication = '; '.join(medication_text(item) for item in active_medications(plan))
    parts = {
        'indicaciones': plan.instructions,
        'dieta': getattr(plan, 'diet_instructions', ''),
        'receta': medication,
        'efectos_a_observar': plan.side_effects,
    }
    return {key: value for key, value in parts.items() if value}


def _doctor_sentences(parts):
    return [sentence for text in parts.values() for sentence in _sentences(text)]


def quoted_sentence(parts, quote):
    """La frase del odontólogo que contiene la cita; None si la cita no está en su texto (la IA inventó)."""
    wanted = ' '.join(plain(quote or '').split()).strip(' .«»"')
    if len(wanted) < MIN_QUOTE:
        return None
    return next((sentence for sentence in _doctor_sentences(parts) if wanted in ' '.join(plain(sentence).split())), None)


def local_quote(parts, question):
    """Frase de las indicaciones que más palabras comparte con la pregunta."""
    words = {word for word in re.findall(r'\w+', plain(question)) if word not in STOPWORDS and len(word) > 2}
    scored = sorted(
        ((len(words & set(re.findall(r'\w+', plain(sentence)))), sentence) for sentence in _doctor_sentences(parts)),
        reverse=True,
    )
    return scored[0][1] if scored and scored[0][0] > 0 else None


def grounded_reply(quote):
    if quote is None:
        return ASK_DOCTOR
    return f'Según las indicaciones de tu odontólogo: «{quote}». {PERSISTS}'


def answer_question(plan, question):
    """Responde una duda solo citando lo que escribió el odontólogo; nunca con recomendaciones propias.

    El modelo solo elige el fragmento. El servidor comprueba que exista en el texto del odontólogo y
    redacta la respuesta; si el modelo cita algo que no está, se usa la búsqueda local.
    """
    parts = doctor_text(plan)
    source, model = 'local', ''
    quote = None
    if parts:
        try:
            output, model = structured_call(
                AIInteraction.Feature.QUESTION,
                system=question_system(),
                user=json.dumps({'texto_del_odontologo': parts, 'pregunta_del_paciente': question}, ensure_ascii=False),
                output_format=GroundedAnswer,
                effort='low',
                max_tokens=400,
            )
            source = 'llm'
            quote = quoted_sentence(parts, output.cita) if output.cita else None
            if output.cita and quote is None:
                # La cita no está en las indicaciones: se descarta y decide la búsqueda local.
                source, quote = 'local', local_quote(parts, question)
        except AIUnavailable:
            quote = local_quote(parts, question)
    return {'answer': grounded_reply(quote), 'grounded': quote is not None, 'quote': quote, 'source': source,
            'model': model}


def explanation_payload(explanation):
    return {'content': explanation.content, 'source': explanation.source, 'model': explanation.model,
            'updated_at': explanation.updated_at}
