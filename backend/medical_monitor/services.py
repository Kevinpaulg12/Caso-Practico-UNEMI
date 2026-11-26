import http.client
import json
import re
import unicodedata
from urllib.parse import quote
from urllib.request import Request, urlopen

from django.conf import settings

from . import rules
from .caching import medication_guides
from .models import AlertSettings
from .nlp import affirmed_symptoms, extract_entities, longest_duration

ALERT_COLORS = {'Bajo': 'verde', 'Medio': 'amarillo', 'Alto': 'rojo'}
RISK_RANK = {'Bajo': 0, 'Medio': 1, 'Alto': 2}

# Los patrones se escriben sin tildes: se comparan contra el texto normalizado.
SYMPTOM_PATTERNS = {
    'Sangrado': r'hemorragia|sangrado (?:muy )?(?:abundante|persistente|continuo|constante|que no para)',
    'Dificultad para respirar o tragar': (
        r'dificultad (?:para|al) (?:respirar|tragar|deglutir)|no puedo (?:respirar|tragar)|disnea|disfagia'
    ),
    'Apertura bucal limitada': r'no puedo abrir la boca|trismo',
    'Fiebre': r'fiebre alta|fiebre de (?:3[89]|4\d)',
    # La inflamación de la mejilla es esperable los primeros días: solo alerta si es marcada o llega al cuello u ojo.
    'Inflamación severa': (
        r'(?:cara|mejilla) (?:\w+ )?(?:muy|demasiado) (?:hinchad|inflamad)\w*'
        r'|(?:cuello|ojo|parpado) (?:\w+ )?(?:muy )?(?:hinchad|inflamad)\w*'
    ),
    'Dolor severo': r'dolor (?:\w+ ){0,2}(?:intenso|insoportable|severo)',
}
GENERAL_HIGH_PATTERN = r'urgente|sever[oa]|critic[oa]|inmediat[oa]'
MEDIUM_PATTERN = re.compile(r'\b(?:moderad[oa]|control|observacion|cada 8 horas|tratamiento prolongado)\b')
# Negación explícita justo antes del síntoma. Es deliberadamente estrecha: "no para la
# hemorragia" sigue siendo una alarma; ante la duda se prefiere una falsa alerta.
NEGATION = re.compile(
    r'\b(?:no (?:tengo|hay|presento|presenta|tiene|siento|he tenido|tuve|hubo)|sin|ni|niega|niego)'
    r' (?:(?:la|el|una|un|mas|ninguna|ningun) )?$'
)


def _compile(pattern):
    return re.compile(rf'\b(?:{pattern})\b')


COMPILED_SYMPTOMS = {label: _compile(pattern) for label, pattern in SYMPTOM_PATTERNS.items()}
COMPILED_GENERAL_HIGH = _compile(GENERAL_HIGH_PATTERN)


def normalize_text(text):
    decomposed = unicodedata.normalize('NFKD', text or '')
    without_marks = ''.join(char for char in decomposed if not unicodedata.combining(char))
    return ' '.join(without_marks.casefold().split())


def _affirmed(pattern, normalized):
    return any(
        not NEGATION.search(normalized[:match.start()])
        for match in pattern.finditer(normalized)
    )


def detect_symptoms(text):
    """Devuelve las categorías de signos de alarma afirmados en el texto."""
    normalized = normalize_text(text)
    return [label for label, pattern in COMPILED_SYMPTOMS.items() if _affirmed(pattern, normalized)]


def analyze_medical_text(text):
    """
    Extrae entidades y calcula una severidad preliminar para texto médico.
    """
    entities = extract_entities(text)

    normalized = normalize_text(text)
    if detect_symptoms(text) or _affirmed(COMPILED_GENERAL_HIGH, normalized):
        severity = 'Alta'
    elif MEDIUM_PATTERN.search(normalized):
        severity = 'Media'
    else:
        severity = 'Baja'

    return {
        'severity': severity,
        'entities': entities,
    }


def find_medication_guide(text, guides=None):
    normalized_text = text.casefold()
    for guide in (medication_guides() if guides is None else guides):
        if any(term.casefold() in normalized_text for term in guide.search_terms):
            return {
                'name': guide.name,
                'common_effects': guide.common_effects,
                'what_to_do': guide.what_to_do,
                'warning_signs': guide.warning_signs,
                'source_note': guide.source_note,
            }
    return None


def search_medications(term, limit=8):
    """Search public RxNav data without sending patient or clinical information."""
    normalized = ' '.join((term or '').split())[:80]
    if len(normalized) < 2:
        return {'source': 'local', 'items': [], 'message': 'Escribe al menos dos letras.'}

    items = []
    try:
        request = Request(
            f'https://rxnav.nlm.nih.gov/REST/drugs.json?name={quote(normalized)}',
            headers={'User-Agent': 'DentalSenseAI/1.0'},
        )
        with urlopen(request, timeout=4) as response:
            payload = json.loads(response.read().decode('utf-8'))
        for group in payload.get('drugGroup', {}).get('conceptGroup', []):
            for concept in group.get('conceptProperties', []):
                name = concept.get('name', '').strip()
                if name:
                    items.append({
                        'name': name,
                        'rxcui': concept.get('rxcui'),
                        'source': 'RxNav',
                    })
    except (OSError, ValueError, TimeoutError, http.client.HTTPException):
        items = []

    if not items:
        normalized_term = normalized.casefold()
        for guide in medication_guides():
            if normalized_term in guide.name.casefold() or any(
                normalized_term in term.casefold() for term in guide.search_terms
            ):
                items.append({
                    'name': guide.name,
                    'rxcui': None,
                    'source': 'Catálogo local',
                })
        return {
            'source': 'local',
            'items': items[:limit],
            'message': 'Catálogo externo no disponible; se muestran coincidencias locales.',
        }

    unique = {}
    for item in items:
        unique[item['name'].casefold()] = item
    return {'source': 'RxNav', 'items': list(unique.values())[:limit], 'message': ''}


def parse_medication_strength(name):
    match = re.search(r'(\d+(?:[.,]\d+)?)\s*(mcg|mg|ml|g|%)(?![a-z])', name or '', re.IGNORECASE)
    return f'{match.group(1)} {match.group(2)}' if match else ''


def evaluate_patient_status(pain_level, comparison, message, previous_report=None, postoperative_day=None,
                            protocol=None):
    """Clasifica el reporte (verde, amarillo, rojo) y genera una orientación para el paciente.

    `protocol` es el ClinicalProcedure del tratamiento: define la especialidad y qué síntomas son
    esperables hasta qué día. Sin protocolo se aplican las reglas de cirugía oral.
    """
    analysis = analyze_medical_text(message)
    thresholds = AlertSettings.load()
    findings = []

    if pain_level >= thresholds.high_pain:
        findings.append(('Alto', f'Dolor EVA {pain_level} (umbral de riesgo alto: {thresholds.high_pain})'))
    elif pain_level >= thresholds.medium_pain:
        findings.append(('Medio', f'Dolor EVA {pain_level} (umbral de riesgo medio: {thresholds.medium_pain})'))
    if comparison == 'higher' and pain_level >= thresholds.rising_pain:
        findings.append(('Alto', f'El dolor aumentó y está en EVA {pain_level}'))
    findings += [('Alto', f'Signo de alarma: {label}') for label in detect_symptoms(message)]
    if analysis['severity'] == 'Alta' and not any(level == 'Alto' for level, _ in findings):
        findings.append(('Alto', 'El mensaje describe una situación urgente'))
    elif analysis['severity'] == 'Media':
        findings.append(('Medio', 'El mensaje describe una molestia moderada'))
    findings += rules.evaluate(rules.RuleContext(
        symptoms=affirmed_symptoms(analysis['entities']),
        pain_level=pain_level,
        comparison=comparison,
        day=postoperative_day,
        thresholds=thresholds,
        protocol=protocol,
        duration=longest_duration(analysis['entities']),
    ))

    risk_level = max((level for level, _ in findings), key=RISK_RANK.get, default='Bajo')
    reasons = list(dict.fromkeys(reason for level, reason in findings if level == risk_level))

    pain_increased = previous_report is not None and pain_level > previous_report.pain_level
    if comparison == 'higher':
        evolution_status = 'Requiere revisión'
    elif comparison == 'lower' and (risk_level == 'Alto' or pain_increased):
        # La percepción del paciente no prevalece sobre un riesgo alto o un dolor mayor al registrado.
        evolution_status = 'Requiere revisión'
    elif comparison == 'lower':
        evolution_status = 'Evolución favorable'
    elif comparison == 'same':
        evolution_status = 'Evolución estable'
    else:
        evolution_status = 'Evolución esperada'

    if risk_level == 'Alto':
        recommendation = (
            'Tu molestia necesita atención. Descansa, sigue las indicaciones recibidas '
            'y comunícate hoy con tu doctor. Si tienes dificultad para respirar, '
            'sangrado abundante o fiebre alta, busca atención urgente.'
        )
    elif risk_level == 'Medio':
        recommendation = (
            'Vigila cómo te sientes durante las próximas horas, toma tus medicamentos '
            'tal como fueron indicados y registra nuevamente tu molestia. Si aumenta '
            'o no mejora, contacta a tu doctor.'
        )
    else:
        recommendation = (
            'Tu evolución parece tranquila. Continúa con tus cuidados, respeta tus '
            'horarios y vuelve a registrar cómo te sientes mañana.'
        )

    return {
        'severity': analysis['severity'],
        'entities': analysis['entities'],
        'risk_level': risk_level,
        'alert_color': ALERT_COLORS[risk_level],
        'alert_reasons': reasons,
        'postoperative_day': postoperative_day,
        'recommendation': recommendation,
        'evolution_status': evolution_status,
        'doctor_notified': risk_level == 'Alto',
    }


def evaluate_treatment_plan(title, procedure, instructions, side_effects):
    text = ' '.join((title, procedure, instructions, side_effects)).lower()
    third_molar = any(term in text for term in ('3 molar', 'tercer molar', 'muela del juicio', 'cordal'))
    high = any(term in text for term in ('cirugía', 'cirugia', 'extracción', 'extraccion', 'implante'))
    if third_molar or high:
        severity = 'Media'
    else:
        severity = 'Baja'

    if third_molar:
        recommendations = (
            'Aplica compresas frías por fuera de la mejilla durante 15 minutos y descansa '
            'otros 15 minutos. Sigue los horarios indicados, evita fumar y no hagas enjuagues '
            'fuertes durante el primer día. Consulta al doctor si el dolor o la inflamación aumentan.'
        )
    else:
        recommendations = (
            'Sigue los horarios indicados, descansa y observa cualquier cambio. '
            'Si la molestia aumenta, comunícate con tu doctor.'
        )
    return {'severity': severity, 'recommendations': recommendations}
