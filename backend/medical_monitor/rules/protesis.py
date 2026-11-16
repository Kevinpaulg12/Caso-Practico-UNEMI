"""Prótesis fija (coronas, puentes) y removible."""

HANDLED = frozenset({'Prótesis desajustada', 'Llaga o úlcera', 'Dolor al morder', 'Restauración caída o fractura',
                     'Sensibilidad dental'})


def rules(ctx):
    found = []
    symptoms = ctx.symptoms
    if 'Prótesis desajustada' in symptoms:
        found.append(('Medio', 'La prótesis no ajusta bien: requiere una cita de ajuste'))

    if 'Llaga o úlcera' in symptoms:
        window = ctx.window('Llaga o úlcera', 7)
        if (ctx.duration or 0) > window or ctx.beyond('Llaga o úlcera', window):
            found.append(('Medio', 'Llaga por roce de la prótesis que no cicatriza'))

    if 'Dolor al morder' in symptoms and ctx.beyond('Dolor al morder', 3):
        found.append(('Medio', 'Dolor al morder: la prótesis puede estar alta'))
    if 'Restauración caída o fractura' in symptoms:
        found.append(('Medio', 'Se despegó o fracturó la corona o el puente'))
    if 'Sensibilidad dental' in symptoms and ctx.beyond('Sensibilidad dental', 14):
        found.append(('Medio', 'La sensibilidad del diente pilar dura más de lo esperado'))
    return found
