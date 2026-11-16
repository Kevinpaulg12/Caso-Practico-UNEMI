# Trazabilidad de requisitos — DentalSense AI

Relación de cada requisito con su implementación, las pruebas que lo verifican y la evidencia obtenida.
Verificación realizada el 4 y 5 de noviembre de 2026.

## Resumen

| Requisito | Resultado | Pruebas automatizadas | Evidencia |
|---|---|---|---|
| RF01 Autenticación y control de acceso | Cumple | `RF01AuthenticationTests`, `routes.test.jsx`, `Login.test.jsx` | `RF01-CA02-credenciales-invalidas.png` |
| RF02 Procesamiento de autorreportes (PLN) | Cumple | `RF02SymptomExtractionTests`, `RF02AlertLevelTests` | `RF02-HU02-chat-alerta-390.png` |
| RF03 Panel del odontólogo | Cumple | `RF03DashboardTests`, `DoctorDashboard.test.jsx` | `RF03-panel-odontologo-grafica.png` |
| RF04 Registro de procedimientos | Cumple | `RF04ProcedureRegistrationTests`, `PrescriptionForm.test.jsx` | `RF04-formulario-procedimiento.png`, `RF04-HU05-indicaciones-paciente.png` |
| RNF01 Seguridad: 5 min de inactividad | Cumple | `RNF01IdleTimeoutTests`, `AuthContext.test.jsx`, `api.test.js` | `RNF01-registro.txt`, `RNF01-sesion-cerrada-por-inactividad.png` |
| RNF02 Rendimiento: ≤ 0,2 s por autorreporte | Cumple | `RNF02LatencyTests` | `RNF02-latencia-comando.txt`, `resultados.json` |
| RNF03 Usabilidad: operable desde 320 px | Cumple | Verificación en navegador | `RNF03-*-320.png` |

Las pruebas `RF..`/`RNF..` están en [backend/medical_monitor/tests_requirements.py](../backend/medical_monitor/tests_requirements.py); las de interfaz, en `frontend/src/**/*.test.jsx`. Las evidencias están en [docs/evidencias/](evidencias/).

## Detalle por requisito

### RF01 — Autenticación y control de acceso (HU01)

- **Implementación:** JWT con Django REST Framework (`/api/token/`, `users/views_account.py`); rutas por rol en el frontend (`RoleRoute.jsx`).
- **CA01:** con credenciales válidas, el odontólogo llega a `/panel-doctor` y el paciente a `/panel-paciente`; cada rol queda fuera de las pantallas del otro (la API responde 403).
- **CA02:** con credenciales inválidas se deniega el acceso con el mensaje «Credenciales inválidas. Verifica tu usuario y contraseña.».
- **HU01 CA03:** ver RNF01.

### RF02 — Procesamiento de autorreportes mediante PLN (HU02)

- **Implementación:** `medical_monitor/nlp.py` usa spaCy (`es_core_news_sm`) con un `EntityRuler` que reconoce síntomas (dolor, inflamación, sangrado, fiebre, signos de infección, apertura bucal limitada, dificultad para tragar o respirar, adormecimiento, náusea), medicamentos, dosis y frecuencias. Para cada síntoma estima la intensidad (leve, moderada, alta) y si está negado («ya no me duele», «sin sangrado»).
- **CA01:** el texto «Tengo mucho dolor y un poco de sangrado» produce `Dolor (alta)` y `Sangrado (leve)`; «Ya no me duele, sin sangrado ni fiebre» produce los tres síntomas marcados como negados.
- **CA02:** el motor de reglas (`services.postoperative_rules`) combina el síntoma con el día postoperatorio (día 0 = día de la cirugía) y asigna verde, amarillo o rojo. El nivel, sus motivos, los síntomas y el día se guardan con el reporte.

| Síntoma | Verde | Amarillo | Rojo |
|---|---|---|---|
| Sangrado leve | Días 0 y 1 | Desde el día 2 | Abundante o que no se detiene |
| Inflamación | Días 0 a 3 | Desde el día 4 | Aumenta desde el día 4 |
| Dolor que aumenta | Según umbrales EVA | — | Desde el día 3 con EVA medio o más |
| Fiebre | — | Cualquier día | Con signos de infección |
| Pus, mal olor o mal sabor | — | Cualquier día | Con fiebre |
| Adormecimiento | Días 0 y 1 | Desde el día 2 | — |

Además, los umbrales de dolor EVA (alto ≥ 7, medio ≥ 5, alto si aumenta y ≥ 6) son configurables por el administrador, y los signos de alarma (trismo, dificultad para respirar o tragar) siempre son rojos.

- **Precondición:** sin un tratamiento activo, la API rechaza el reporte y la interfaz desactiva el chat.
- **Registro guiado (RU01):** el chat ofrece atajos para describir dolor, inflamación, sangrado, fiebre, mal sabor u hormigueo.

> Las reglas siguen el curso postoperatorio habitual, pero **deben ser validadas por el profesional**, como indica la ficha de RF02.

### RF03 — Panel de control odontológico (HU03)

- **CA01:** la lista de pacientes se ordena por nivel (rojo, amarillo, verde) y cada tarjeta muestra el color con su texto («Rojo · riesgo alto»), de modo que no depende solo del color.
- **CA02:** al elegir un paciente se dibuja su EVA por día postoperatorio (D3.js, que controla el SVG y sus animaciones) junto a la curva esperada del procedimiento, a partir de sus autorreportes. Los puntos llevan el color de su nivel de alerta. Incluye un tooltip, navegación con el teclado, una tabla equivalente y los reportes recientes con su motivo y sus síntomas.
- Cada tratamiento tiene un historial (`/panel-doctor/tratamientos/:id`) que une en una línea de tiempo las recetas, sus modificaciones, los reportes del paciente y el alta. Los tratamientos vigentes se pueden editar; un cambio de medicación emite una receta nueva y conserva la anterior.
- La lista del panel muestra solo a los pacientes con tratamiento activo. El alta médica cierra todos sus tratamientos y recetas vigentes.
- La lista se actualiza cada minuto sin contar como actividad del usuario (ver RNF01).

### RF04 — Registro de procedimientos e indicaciones (HU04, HU05)

- **CA01:** el formulario de consulta permite elegir el tipo de cirugía de un catálogo (exodoncia simple, exodoncia de terceros molares, endodoncia, implante, frenectomía, regeneración ósea), que el administrador puede ampliar, y registrar su fecha. El paciente ve las indicaciones en su portal.
- **CA02:** la fecha de la cirugía inicia la línea de tiempo de recuperación del paciente («Día 1 después de la cirugía · seguimiento de 3 días») y el día postoperatorio de cada reporte.
- **HU05 CA01:** el plan guarda el texto del odontólogo sin modificar, con sus saltos de línea.

### RNF01 — Seguridad: cierre por inactividad

- **Implementación:** cada petición del usuario actualiza su última actividad (`users/authentication.py`). Pasados 5 minutos sin peticiones, el servidor rechaza el token y la renovación (`code: session_idle`). El token de acceso también caduca a los 5 minutos. En el navegador, la sesión se cierra tras 5 minutos sin interacción y se muestra un aviso. Las actualizaciones automáticas de pantalla no cuentan como actividad.
- **Configuración:** `SESSION_IDLE_TIMEOUT_MINUTES` (por defecto 5).
- **Prueba en tiempo real** (`RNF01-registro.txt`): sesión iniciada a las 12:00:19 y sin interacción. A las 12:05:36, con 5 min 20 s de inactividad:
  - la página estaba en el inicio de sesión con el aviso de inactividad;
  - el token de acceso fue rechazado (401);
  - la renovación fue rechazada con `session_idle`.

### RNF02 — Rendimiento: análisis del autorreporte

- **Método 1:** `python manage.py measure_report_latency --requests 100`. Envía 100 autorreportes por la pila completa (autenticación JWT, PLN y reglas) y no deja datos guardados. Resultado: mediana 10,0 ms, percentil 95 17,8 ms y **máximo 76,7 ms**.
- **Método 2:** 50 envíos por HTTP a un servidor en ejecución. Resultado: mediana 45,4 ms, percentil 95 57,9 ms y **máximo 59,3 ms**.
- **Umbral:** 200 ms. El correo de alerta se envía después de responder al paciente, para que un servidor de correo lento no afecte este tiempo.

### RNF03 — Usabilidad en móviles

- **Método:** navegador Chrome a 320 px de ancho. En cada pantalla se comprueba que no hay desplazamiento horizontal y que todos los botones, enlaces y campos están dentro del ancho visible.

| Pantalla | Elementos interactivos | Resultado |
|---|---|---|
| Inicio de sesión | 5 | Sin desplazamiento horizontal; todos dentro |
| Portal del paciente (autorreporte) | 25 | Sin desplazamiento horizontal; todos dentro |
| Panel del odontólogo | 15 | Sin desplazamiento horizontal; todos dentro |
| Registro de procedimiento | 23 | Sin desplazamiento horizontal; todos dentro |

- Los campos de texto usan 16 px en móvil para evitar el zoom automático de iOS.
- **Pendiente:** la ficha pide también la validación en dispositivos físicos, que no se ha realizado.

## Cómo repetir la verificación

```
cd backend && python manage.py test --settings=core.settings_test
cd backend && python manage.py measure_report_latency
cd frontend && npm test
```

Las pruebas en navegador están en [evidencias/scripts/](evidencias/scripts/). Requieren Playwright, los servidores en marcha y los datos de [datos_demostracion.py](evidencias/scripts/datos_demostracion.py), que se cargan con `python manage.py shell` sobre una base de datos de pruebas, **nunca sobre la real**: ejecutan `seed_demo`, que borra los datos existentes.

## Ampliación: seguimiento de tratamientos odontológicos en general (noviembre de 2026)

El sistema dejó de limitarse al postoperatorio de cirugías y sigue cualquier tratamiento odontológico. La innovación central es la combinación de **PLN local** y **modelo de lenguaje (LLM, Google Gemini)**.

| Componente | Implementación | Pruebas |
|---|---|---|
| Protocolos por especialidad | 19 protocolos en 9 especialidades (`ClinicalProcedure`: síntomas esperados por ventana, signos de alarma, checklist, preguntas guía, fases), editables por el administrador | `ProtocolAdminTests`, `ProcedureTests` |
| PLN local ampliado | `nlp.py`: 19 categorías de síntomas, cuidados (adherencia, con negación) y duración («hace 3 días») | `ExtendedNlpTests` |
| Triaje por especialidad | `rules/`: reglas generales + cirugía, endodoncia, ortodoncia, periodoncia, implantes, prótesis y operatoria/estética/odontopediatría | `SpecialtyRulesTests` |
| Asistente conversacional | `ai/assistant.py`: varias preguntas por reporte; el LLM redacta y elige la pregunta, el triaje lo decide el PLN local | `AssistantLocalTests`, `AssistantLLMTests` |
| Resumen clínico | `ai/summaries.py`: por demanda y tras cada alerta roja (en segundo plano) | `SummaryTests` |
| Indicaciones en lenguaje sencillo | `ai/explain.py`: solo con el texto del odontólogo; las dudas sin respuesta se derivan | `ExplanationTests` |
| Privacidad | `ai/anonymize.py`: sin nombres, cédulas, teléfonos, correos ni fechas; consentimiento versión `2026-11-ia` | `AnonymizationTests`, `FirstAccessConsentTests` |
| Fiabilidad | `ai/client.py`: salida estructurada, caché del prompt, respaldo del servidor y alternativa local ante cualquier fallo; bitácora `AIInteraction` | `ClientTests`, `MetricsTests` |
| Fases, citas, checklist, odontograma y recordatorios | `TreatmentPhase`, `Appointment`, `CareCheckin`, notación FDI, `send_reminders` (servicio `scheduler`) | `tests_followup.py` |
| Gráficas | D3.js: EVA por día de seguimiento y cumplimiento de cuidados | `charts.test.jsx` |

**Evaluación del PLN** (`python manage.py evaluate_nlp`, informe en [evidencias/IA-evaluacion.md](evidencias/IA-evaluacion.md)): 124 frases etiquetadas a mano de las 9 especialidades. PLN local: precisión 98,0 %, exhaustividad 84,7 %, F1 90,9 %, latencia mediana 1,3 ms; ninguna frase negada produjo síntomas. La comparación con el LLM (`--llm`) requiere `GEMINI_API_KEY`; no se ha ejecutado.
