import re
import threading
import unicodedata

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction

from . import rules
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


GUIDE_FIELDS = ('name', 'common_effects', 'what_to_do', 'warning_signs', 'source_note', 'indications', 'mechanism')


def find_medication_guide(text, guides=None):
    """Guía para el paciente del fármaco mencionado en el texto (genérico o marca).

    Gana el nombre más largo: «amoxicilina + ácido clavulánico» antes que «amoxicilina».
    """
    from .medications import fold, guidance_catalog
    normalized = fold(text)
    best, best_length = None, 0
    for guide in (guidance_catalog() if guides is None else guides):
        for term in guide['terms']:
            folded = fold(term)
            if folded and len(folded) > best_length and re.search(rf'(?<!\w){re.escape(folded)}(?!\w)', normalized):
                best, best_length = guide, len(folded)
    if best is None:
        return None
    return {field: best.get(field, '') for field in GUIDE_FIELDS}


def evaluate_patient_status(pain_level, comparison, message, previous_report=None, postoperative_day=None,
                            protocol=None):
    """Clasifica el reporte (verde, amarillo, rojo) y genera una orientación para el paciente.

    `protocol` es el ClinicalProcedure del tratamiento: define la especialidad y qué síntomas son
    esperables hasta qué día. Sin protocolo se aplican las reglas de cirugía oral.
    """
    analysis = analyze_medical_text(message)
    thresholds = AlertSettings.load()
    findings = []

    known_pain = pain_level is not None
    if known_pain and pain_level >= thresholds.high_pain:
        findings.append(('Alto', f'Dolor EVA {pain_level} (umbral de riesgo alto: {thresholds.high_pain})'))
    elif known_pain and pain_level >= thresholds.medium_pain:
        findings.append(('Medio', f'Dolor EVA {pain_level} (umbral de riesgo medio: {thresholds.medium_pain})'))
    if known_pain and comparison == 'higher' and pain_level >= thresholds.rising_pain:
        findings.append(('Alto', f'El dolor aumentó y está en EVA {pain_level}'))
    findings += [('Alto', f'Signo de alarma: {label}') for label in detect_symptoms(message)]
    if analysis['severity'] == 'Alta' and not any(level == 'Alto' for level, _ in findings):
        findings.append(('Alto', 'El mensaje describe una situación urgente'))
    elif analysis['severity'] == 'Media':
        findings.append(('Medio', 'El mensaje describe una molestia moderada'))
    findings += rules.evaluate(rules.RuleContext(
        symptoms=affirmed_symptoms(analysis['entities']),
        # Las reglas por especialidad comparan el EVA con umbrales: un dolor no dicho no dispara ninguna.
        pain_level=pain_level if known_pain else 0,
        comparison=comparison or None,
        day=postoperative_day,
        thresholds=thresholds,
        protocol=protocol,
        duration=longest_duration(analysis['entities']),
    ))

    risk_level = max((level for level, _ in findings), key=RISK_RANK.get, default='Bajo')
    reasons = list(dict.fromkeys(reason for level, reason in findings if level == risk_level))

    pain_increased = (known_pain and previous_report is not None and previous_report.pain_level is not None
                      and pain_level > previous_report.pain_level)
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


def alert_recipients(patient):
    """(correos, motivo). El tratante con correo; si no lo tiene, los demás odontólogos activos con correo."""
    from users.models import User

    profile = getattr(patient, 'profile', None)
    doctor = profile.primary_doctor if profile else None
    if doctor and doctor.email:
        return [doctor.email], 'primary'
    others = list(
        User.objects.filter(role=User.Roles.DOCTOR, is_active=True).exclude(email='')
        .exclude(pk=getattr(doctor, 'pk', None)).values_list('email', flat=True)
    )
    return others, 'fallback'


def notify_primary_doctor(patient, report):
    """Avisa por correo de inmediato de una alerta roja: no basta con que se vea en el panel.

    Devuelve 'primary' (al tratante), 'fallback' (el tratante no tiene correo: a los demás odontólogos)
    o False (no hay a quién escribir).
    """
    recipients, target = alert_recipients(patient)
    if not recipients:
        return False
    name = patient.get_full_name() or patient.username
    plan_id = getattr(report, 'treatment_plan_id', None)
    link = f'{settings.PORTAL_URL}/panel-doctor/tratamientos/{plan_id}' if plan_id else f'{settings.PORTAL_URL}/panel-doctor/monitoreo'
    lines = [
        f'{name} reportó síntomas de riesgo alto en su seguimiento.',
        f'Motivo: {"; ".join(report.alert_reasons) or "revisa su evolución"}.',
    ]
    if report.pain_level is not None:
        lines.append(f'Dolor (EVA): {report.pain_level}/10.')
    message = ' '.join((report.message or '').split())
    if message:
        lines.append(f'Lo que contó: «{message[:400]}{"…" if len(message) > 400 else ""}»')
    if target == 'fallback':
        lines.append('Recibes este aviso porque su odontólogo tratante no tiene un correo registrado.')
    lines += ['', f'Abrir su tratamiento: {link}', 'Valora contactar al paciente lo antes posible.']

    def send():
        send_mail(f'DentalSense: alerta roja de {name}', '\n'.join(lines), settings.DEFAULT_FROM_EMAIL,
                  recipients, fail_silently=True)

    # El correo sale después de responder al paciente: un servidor SMTP lento no debe frenar el reporte.
    if settings.EMAIL_IN_BACKGROUND:
        transaction.on_commit(lambda: threading.Thread(target=send, daemon=True).start())
    else:
        transaction.on_commit(send)
    return target


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
