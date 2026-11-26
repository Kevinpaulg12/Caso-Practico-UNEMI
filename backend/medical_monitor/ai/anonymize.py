"""Anonimización de lo que se envía al modelo de lenguaje (LOPDP).

Nunca salen del servidor nombres, cédulas, teléfonos, correos ni fechas exactas (tampoco la de
nacimiento). El contexto clínico se reduce a lo necesario: edad en años, tratamiento, día de
seguimiento, fase, piezas y medicación.
"""
import re
import unicodedata

PHONE = re.compile(r'(?<!\d)(?:\+?\d[\d\s-]{6,}\d)(?!\d)')
EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+')
DATE = re.compile(r'\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b')


def _fold(text):
    decomposed = unicodedata.normalize('NFKD', text)
    return ''.join(char for char in decomposed if not unicodedata.combining(char)).casefold()


def _names_of(user):
    if user is None:
        return []
    words = f'{user.first_name} {user.last_name}'.split()
    return sorted({word for word in words if len(word) >= 3}, key=len, reverse=True)


def mask(text, *people):
    """Reemplaza los datos personales del texto por marcadores neutros."""
    text = text or ''
    text = EMAIL.sub('[CORREO]', text)
    text = DATE.sub('[FECHA]', text)
    # Cédulas y teléfonos: secuencias largas de dígitos.
    text = PHONE.sub('[NÚMERO]', text)
    text = re.sub(r'\b\d{8,}\b', '[NÚMERO]', text)
    for person in people:
        for name in _names_of(person):
            # Insensible a mayúsculas y tildes: «josé», «JOSE» y «José» se enmascaran por igual.
            text = re.sub(rf'\b{_accent_insensitive(name)}\b', '[NOMBRE]', text, flags=re.IGNORECASE)
    return text


ACCENTS = {'a': '[aáàä]', 'e': '[eéèë]', 'i': '[iíìï]', 'o': '[oóòö]', 'u': '[uúùü]', 'n': '[nñ]'}


def _accent_insensitive(word):
    return ''.join(ACCENTS.get(char, re.escape(char)) for char in _fold(word))


def age_text(age):
    """Edad en años cumplidos. La fecha de nacimiento, que sí identifica, nunca se envía."""
    if age is None:
        return 'edad no registrada'
    return f'{age} {"año" if age == 1 else "años"}'


def plan_context(plan):
    """Contexto clínico mínimo y sin identificadores para el modelo."""
    from ..treatments import active_medications, medication_text  # evita un ciclo de importación
    procedure = plan.clinical_procedure
    phase = plan.current_phase
    return {
        'edad': age_text(plan.patient.age),
        'especialidad': procedure.get_specialty_display() if procedure else 'Cirugía oral',
        'tratamiento': (procedure.name if procedure else plan.procedure) or plan.title,
        'dia_de_seguimiento': plan.postoperative_day,
        'unidad_de_seguimiento': procedure.get_follow_up_unit_display() if procedure else 'Días',
        'fase_actual': phase.name if phase else None,
        'piezas_dentales_fdi': plan.teeth or [],
        'medicacion': '; '.join(medication_text(item) for item in active_medications(plan)) or None,
    }
