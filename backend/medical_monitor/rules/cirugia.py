"""Cirugía oral (exodoncias, frenectomías, injertos): reglas del curso postoperatorio habitual."""

HANDLED = frozenset({'Sangrado', 'Inflamación', 'Adormecimiento', 'Dolor'})


def rules(ctx):
    found = []
    symptoms = ctx.symptoms
    bleeding = symptoms.get('Sangrado', False)
    if bleeding == 'alta':
        found.append(('Alto', 'Sangrado abundante o que no se detiene'))
    elif bleeding is not False and ctx.known and ctx.day >= 2:
        found.append(('Medio', 'Sangrado después de las primeras 48 horas'))

    if 'Inflamación' in symptoms and ctx.known and ctx.day >= 4:
        if ctx.comparison == 'higher' or symptoms['Inflamación'] == 'alta':
            found.append(('Alto', 'La inflamación aumenta después del día 3'))
        else:
            found.append(('Medio', 'La inflamación persiste después del día 3'))

    if ctx.known and ctx.day >= 3 and ctx.comparison == 'higher' and ctx.pain_level >= ctx.thresholds.medium_pain:
        found.append(('Alto', 'El dolor aumenta después del día 3 (posible alveolitis)'))

    if 'Adormecimiento' in symptoms and ctx.known and ctx.day >= 2:
        found.append(('Medio', 'Adormecimiento que persiste después del día 1'))
    return found
