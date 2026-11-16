"""Endodoncia y retratamiento de conductos."""

HANDLED = frozenset({'Inflamación', 'Dolor', 'Dolor al morder', 'Restauración caída o fractura'})


def rules(ctx):
    found = []
    symptoms = ctx.symptoms
    if 'Inflamación' in symptoms:
        found.append(('Alto', 'Inflamación después de la endodoncia (posible absceso)'))

    if ctx.known and ctx.comparison == 'higher' and ctx.pain_level >= ctx.thresholds.rising_pain:
        found.append(('Alto', 'El dolor aumenta después de la endodoncia (posible reagudización)'))
    elif ctx.beyond('Dolor', 3) and ctx.pain_level >= ctx.thresholds.medium_pain:
        found.append(('Medio', f'El dolor persiste más de {ctx.window("Dolor", 3)} días tras la endodoncia'))

    if 'Dolor al morder' in symptoms and ctx.beyond('Dolor al morder', 7):
        found.append(('Medio', 'Dolor al morder que persiste: revisar la oclusión del diente tratado'))

    if 'Restauración caída o fractura' in symptoms:
        found.append(('Medio', 'Se perdió la restauración del diente tratado: el conducto puede contaminarse'))
    return found
