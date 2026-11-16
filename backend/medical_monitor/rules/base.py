"""Reglas comunes a todos los tratamientos."""

ALWAYS_HIGH = ('Apertura bucal limitada', 'Dificultad para tragar o respirar')


def rules(ctx, handled=frozenset()):
    found = []
    symptoms = ctx.symptoms

    if 'Signos de infección' not in handled:
        if 'Fiebre' in symptoms and 'Signos de infección' in symptoms:
            found.append(('Alto', 'Fiebre con signos de infección'))
        elif 'Fiebre' in symptoms:
            found.append(('Medio', 'Refiere fiebre'))
        elif 'Signos de infección' in symptoms:
            found.append(('Medio', 'Posibles signos de infección (pus, mal olor o mal sabor)'))
    elif 'Fiebre' in symptoms:
        found.append(('Medio', 'Refiere fiebre'))

    for category in ALWAYS_HIGH:
        if category in symptoms:
            found.append(('Alto', category))

    # Síntomas que este protocolo considera siempre de riesgo alto.
    for category in getattr(ctx.protocol, 'alarm_symptoms', None) or []:
        if category in symptoms and category not in handled and category not in ALWAYS_HIGH:
            found.append(('Alto', f'Signo de alarma en {ctx.protocol_name}: {category}'))

    # Cualquier otro síntoma que el protocolo espera solo durante unos días.
    expected = getattr(ctx.protocol, 'expected_symptoms', None) or {}
    for category in symptoms:
        if category in handled or category not in expected:
            continue
        if ctx.beyond(category, expected[category]):
            found.append(('Medio', f'{category} después del día {expected[category]} (más de lo esperado)'))

    # Una llaga que no cicatriza en dos semanas debe revisarse siempre.
    if 'Llaga o úlcera' in symptoms and (ctx.duration or 0) >= 14:
        found.append(('Medio', 'Llaga que no cicatriza en más de dos semanas'))
    return found
