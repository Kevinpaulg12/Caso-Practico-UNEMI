"""Implantología: cirugía del implante y su corona."""

HANDLED = frozenset({'Movilidad dental', 'Signos de infección', 'Dolor', 'Inflamación', 'Restauración caída o fractura'})


def rules(ctx):
    found = []
    symptoms = ctx.symptoms
    if 'Movilidad dental' in symptoms:
        found.append(('Alto', 'Movilidad del implante o de la corona'))
    if 'Signos de infección' in symptoms:
        found.append(('Alto', 'Signos de infección alrededor del implante (posible periimplantitis)'))

    if ctx.known and ctx.day >= 3 and ctx.comparison == 'higher' and ctx.pain_level >= ctx.thresholds.medium_pain:
        found.append(('Alto', 'El dolor aumenta después del día 3'))

    if 'Inflamación' in symptoms and ctx.beyond('Inflamación', 4):
        if ctx.comparison == 'higher' or symptoms['Inflamación'] == 'alta':
            found.append(('Alto', f'La inflamación aumenta después del día {ctx.window("Inflamación", 4)}'))
        else:
            found.append(('Medio', f'La inflamación persiste después del día {ctx.window("Inflamación", 4)}'))

    if 'Restauración caída o fractura' in symptoms:
        found.append(('Medio', 'Se aflojó o despegó la corona sobre el implante'))
    return found
