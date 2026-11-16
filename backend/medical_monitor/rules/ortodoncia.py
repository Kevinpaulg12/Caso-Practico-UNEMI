"""Ortodoncia con brackets o alineadores. El día cuenta desde el último ajuste o cambio de alineador."""

HANDLED = frozenset({'Aparato suelto o roto', 'Alambre que lastima', 'Llaga o úlcera', 'Dolor', 'Movilidad dental'})


def rules(ctx):
    found = []
    symptoms = ctx.symptoms
    if 'Aparato suelto o roto' in symptoms:
        found.append(('Medio', 'Aparato de ortodoncia suelto o roto: requiere una cita de revisión'))
    if 'Alambre que lastima' in symptoms:
        found.append(('Medio', 'El alambre lastima la mucosa: cúbrelo con cera y agenda una revisión'))

    if 'Llaga o úlcera' in symptoms:
        window = ctx.window('Llaga o úlcera', 7)
        if (ctx.duration or 0) > window or ctx.beyond('Llaga o úlcera', window):
            found.append(('Medio', f'Llaga que no mejora en más de {window} días'))

    if ctx.beyond('Dolor', 4) and ctx.pain_level >= ctx.thresholds.medium_pain:
        found.append(('Medio', f'Dolor que persiste más de {ctx.window("Dolor", 4)} días después del ajuste'))

    if symptoms.get('Movilidad dental') == 'alta':
        found.append(('Medio', 'Movilidad dental mayor a la esperada durante la ortodoncia'))
    return found
