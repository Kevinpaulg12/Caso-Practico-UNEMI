"""Operatoria (resinas), estética (blanqueamiento, carillas) y odontopediatría."""

HANDLED = frozenset({'Sensibilidad dental', 'Dolor al morder', 'Restauración caída o fractura', 'Dolor'})


def rules(ctx):
    found = []
    symptoms = ctx.symptoms
    if 'Sensibilidad dental' in symptoms and ctx.beyond('Sensibilidad dental', 14):
        found.append(('Medio', f'La sensibilidad dura más de {ctx.window("Sensibilidad dental", 14)} días'))

    if ctx.known and ctx.comparison == 'higher' and ctx.pain_level >= ctx.thresholds.rising_pain:
        found.append(('Alto', 'El dolor aumenta después del tratamiento (posible pulpitis)'))
    elif 'Dolor' in symptoms and ctx.beyond('Dolor', 1) and ctx.pain_level >= ctx.thresholds.medium_pain:
        found.append(('Medio', 'Dolor espontáneo después del tratamiento (posible inflamación del nervio)'))

    if 'Dolor al morder' in symptoms and ctx.beyond('Dolor al morder', 2):
        found.append(('Medio', 'Dolor al morder: la restauración puede estar alta'))
    if 'Restauración caída o fractura' in symptoms:
        found.append(('Medio', 'Se cayó o fracturó la restauración'))
    return found
