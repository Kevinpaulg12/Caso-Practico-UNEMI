"""Indicaciones en lenguaje sencillo y preguntas del paciente sobre ellas.

El modelo solo puede usar el texto que escribió el odontólogo (receta e indicaciones): si una duda
no se responde con ese texto, se deriva al odontólogo. La explicación se guarda y solo se regenera
cuando cambian las indicaciones.
"""
import hashlib
import json
import re

from pydantic import BaseModel, Field

from ..models import AIInteraction, PlainExplanation
from ..nlp import plain
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


class AnswerOutput(BaseModel):
    respuesta: str
    basada_en_indicaciones: bool


def source_text(plan):
    """Lo que escribió el odontólogo: es la única fuente que puede usar el modelo."""
    medication = ' '.join(filter(None, (plan.medication_name, plan.strength, plan.dosage_form, plan.frequency,
                                        f'durante {plan.duration}' if plan.duration else '')))
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
    medication = []
    if plan.medication_name:
        medication.append(MedicationStep(
            nombre=' '.join(filter(None, (plan.medication_name, plan.strength))),
            como_tomarlo=', '.join(filter(None, (plan.dosage_form, plan.frequency.lower() if plan.frequency else '',
                                                 f'durante {plan.duration}' if plan.duration else ''))),
        ))
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



def local_answer(parts, question):
    """Busca en las indicaciones la frase que más palabras comparte con la pregunta."""
    words = {word for word in re.findall(r'\w+', plain(question)) if word not in STOPWORDS and len(word) > 2}
    candidates = [sentence for text in parts.values() for sentence in _sentences(text)]
    scored = sorted(
        ((len(words & set(re.findall(r'\w+', plain(sentence)))), sentence) for sentence in candidates),
        reverse=True,
    )
    if scored and scored[0][0] > 0:
        return AnswerOutput(respuesta=f'Según tus indicaciones: {scored[0][1]}.', basada_en_indicaciones=True)
    return AnswerOutput(respuesta=ASK_DOCTOR, basada_en_indicaciones=False)


def answer_question(plan, question):
    parts = source_text(plan)
    payload = {'texto_del_odontologo': parts, 'pregunta_del_paciente': question}
    try:
        output, model = structured_call(
            AIInteraction.Feature.QUESTION,
            system=question_system(),
            user=json.dumps(payload, ensure_ascii=False),
            output_format=AnswerOutput,
            effort='low',
            max_tokens=600,
        )
        source = 'llm'
        if not output.basada_en_indicaciones:
            # Lo que no está en las indicaciones siempre se deriva al odontólogo.
            output = AnswerOutput(respuesta=output.respuesta or ASK_DOCTOR, basada_en_indicaciones=False)
    except AIUnavailable:
        output, model, source = local_answer(parts, question), '', 'local'
    return {'answer': output.respuesta, 'grounded': output.basada_en_indicaciones, 'source': source, 'model': model}


def explanation_payload(explanation):
    return {'content': explanation.content, 'source': explanation.source, 'model': explanation.model,
            'updated_at': explanation.updated_at}
