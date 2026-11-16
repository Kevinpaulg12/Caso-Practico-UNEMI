"""Ayudas compartidas por las pruebas."""
from .consultations import INICIO, fields_for
from .models import ClinicalProcedure

SAMPLES = {'text': 'Dato de prueba', 'boolean': True}


def sample_clinical_data(protocol, moment=INICIO):
    """Valores válidos para los campos obligatorios de un protocolo (acepta el protocolo o su id)."""
    if not isinstance(protocol, ClinicalProcedure):
        protocol = ClinicalProcedure.objects.filter(pk=protocol).first()
    data = {}
    for field in fields_for(protocol, moment):
        if not field.get('required'):
            continue
        kind = field.get('type', 'text')
        if kind == 'select':
            data[field['key']] = field['options'][0]
        elif kind == 'number':
            data[field['key']] = field.get('min', 1)
        else:
            data[field['key']] = SAMPLES[kind]
    return data
