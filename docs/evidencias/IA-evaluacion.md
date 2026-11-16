# Evaluación de la extracción de síntomas

Generado el 14/11/2026 10:37 con `python manage.py evaluate_nlp`.

Conjunto: 124 frases escritas como las escribiría un paciente, etiquetadas a mano sin mirar las reglas del PLN (cirugia 25, endodoncia 15, estetica 6, implantologia 13, odontopediatria 8, operatoria 8, ortodoncia 20, periodoncia 15, protesis 14). Se cuentan solo los síntomas afirmados: «ya no me duele» no debe producir «Dolor».

## Resultados globales

| Método | Precisión | Exhaustividad | F1 | Frases exactas | Frases sin síntomas bien vacías |
|---|---|---|---|---|---|
| PLN local (spaCy + EntityRuler) | 98.0% | 84.7% | 90.9% | 85.5% | 100.0% de 15 |

Latencia del PLN local por frase: mediana 1.3 ms, máximo 4.5 ms (sin red ni servicios externos).

## Por síntoma — PLN local (spaCy + EntityRuler)

| Síntoma | Casos | Precisión | Exhaustividad | F1 |
|---|---|---|---|---|
| Adormecimiento | 4 | 100% | 75% | 86% |
| Alambre que lastima | 3 | 100% | 100% | 100% |
| Aparato suelto o roto | 6 | 100% | 50% | 67% |
| Apertura bucal limitada | 1 | 100% | 100% | 100% |
| Dificultad para tragar o respirar | 2 | 100% | 50% | 67% |
| Dolor | 18 | 89% | 94% | 92% |
| Dolor al morder | 7 | 100% | 71% | 83% |
| Fiebre | 5 | 100% | 100% | 100% |
| Inflamación | 9 | 100% | 100% | 100% |
| Llaga o úlcera | 7 | 100% | 100% | 100% |
| Movilidad dental | 7 | 100% | 43% | 60% |
| Náusea o vómito | 3 | 100% | 100% | 100% |
| Prótesis desajustada | 5 | 100% | 100% | 100% |
| Restauración caída o fractura | 10 | 100% | 50% | 67% |
| Retracción de encía | 2 | 100% | 50% | 67% |
| Sangrado | 7 | 100% | 100% | 100% |
| Sangrado de encías | 4 | 100% | 100% | 100% |
| Sensibilidad dental | 10 | 100% | 100% | 100% |
| Signos de infección | 8 | 100% | 100% | 100% |

## Errores del PLN local

Frases en las que lo extraído no coincide con la etiqueta (sirven para ampliar el vocabulario):

- «Me cuesta tragar y tengo la garganta hinchada» → esperado: Dificultad para tragar o respirar, Inflamación; obtenido: Inflamación
- «Se me partió el diente que me trataron» → esperado: Restauración caída o fractura; obtenido: ninguno
- «El diente se siente flojo» → esperado: Movilidad dental; obtenido: ninguno
- «Me duele mucho al comer» → esperado: Dolor al morder; obtenido: Dolor
- «Siento los dientes un poco flojos» → esperado: Movilidad dental; obtenido: ninguno
- «Me duele un poco al morder con los alineadores» → esperado: Dolor al morder; obtenido: Dolor
- «El alineador está roto» → esperado: Aparato suelto o roto; obtenido: ninguno
- «El bracket está suelto y el alambre me raspa» → esperado: Alambre que lastima, Aparato suelto o roto; obtenido: Alambre que lastima
- «Se me soltó una liga» → esperado: Aparato suelto o roto; obtenido: ninguno
- «Las encías se bajaron después del tratamiento» → esperado: Retracción de encía; obtenido: ninguno
- «La corona del implante está floja» → esperado: Movilidad dental; obtenido: ninguno
- «Todavía tengo el labio dormido» → esperado: Adormecimiento; obtenido: ninguno
- «Siento el tornillo flojo» → esperado: Movilidad dental; obtenido: ninguno
- «La resina se partió» → esperado: Restauración caída o fractura; obtenido: ninguno
- «Se me despegó una carilla» → esperado: Restauración caída o fractura; obtenido: ninguno
- «Me arde la encía por el gel» → esperado: Dolor; obtenido: ninguno
- «Se me astilló una carilla» → esperado: Restauración caída o fractura; obtenido: ninguno
- «Se le cayó la corona al niño» → esperado: Restauración caída o fractura; obtenido: ninguno

## Cómo se usa cada método en DentalSense

- El **PLN local** decide el nivel de alerta: es explicable, no envía datos fuera y responde en milisegundos.
- El **modelo de lenguaje** conversa, resume y explica; lo que extrae se guarda para compararlo con el PLN local, pero nunca cambia el nivel de alerta.
