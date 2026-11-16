"""Periodoncia: raspado y alisado, cirugía periodontal, injertos de encía."""

HANDLED = frozenset({'Sangrado', 'Sangrado de encías', 'Sensibilidad dental', 'Movilidad dental', 'Retracción de encía'})


def rules(ctx):
    found = []
    symptoms = ctx.symptoms
    if symptoms.get('Sangrado') == 'alta' or symptoms.get('Sangrado de encías') == 'alta':
        found.append(('Alto', 'Sangrado abundante o que no se detiene'))
    elif 'Sangrado de encías' in symptoms and ctx.beyond('Sangrado de encías', 7):
        found.append(('Medio', f'Las encías siguen sangrando después de {ctx.window("Sangrado de encías", 7)} días'))
    elif 'Sangrado' in symptoms and ctx.beyond('Sangrado', 1):
        found.append(('Medio', 'Sangrado después de las primeras 48 horas'))

    if 'Sensibilidad dental' in symptoms and ctx.beyond('Sensibilidad dental', 21):
        found.append(('Medio', 'La sensibilidad dura más de lo esperado tras el tratamiento periodontal'))
    if 'Movilidad dental' in symptoms:
        found.append(('Medio', 'Movilidad dental: requiere valoración periodontal'))
    if 'Retracción de encía' in symptoms:
        found.append(('Medio', 'Refiere retracción de la encía'))
    return found
