# Rendimiento de DentalSense

Qué se hizo con cada práctica de rendimiento, dónde está en el código y qué queda para el despliegue.
El proyecto no almacena imágenes (por costo), así que las prácticas sobre imágenes no aplican.

## Aplicadas en el código

| Práctica | Qué se hizo | Dónde |
|---|---|---|
| Esqueletos de carga | Bloques grises con la forma del contenido en el portal del paciente, el panel del odontólogo, la historia clínica, el historial, la cuenta y el cambio de página. Los lectores de pantalla oyen «Cargando…». | `frontend/src/components/Skeleton.jsx` |
| Evitar llamadas duplicadas | El menú ya no pide `/me/` en cada pantalla ni el portal pide `/account/`: usan el perfil que cargó la sesión. | `PanelLayout.jsx`, `Prescriptions.jsx` |
| Debounce en búsqueda y autocompletado | El buscador de pacientes de Consulta médica espera 300 ms y cancela la petición anterior. Los demás buscadores y el autocompletado de medicamentos ya esperaban 250–350 ms. | `hooks/useDebouncedValue.js`, `NewConsultation.jsx` |
| Paginar la API | Todos los listados van paginados (10 por página). El cliente puede pedir hasta 100 con `?page_size=`, con tope en el servidor. | `backend/core/pagination.py`, `services/pagination.js` |
| Consultas N+1 | `/api/treatment-plans/` pasaba de 22 consultas con 5 tratamientos (crecía con cada uno) a 5 fijas. Una prueba falla si un listado supera 6 consultas. | `medical_monitor/views.py`, `tests_performance.py` |
| Pedir solo lo necesario | Los listados cargan sus relaciones en bloque (`select_related`, `prefetch_related`) en vez de una consulta por fila. | `views.py`, `users/views.py` |
| Índices | Índices compuestos para las consultas más repetidas: reportes y tratamientos por paciente, recetas, controles, solicitudes de cita y métricas de IA. | migración `0017_performance_indexes` |
| Compresión | El backend comprime con Gzip las respuestas JSON. En producción, nginx sirve los estáticos comprimidos. | `settings.py` (GZipMiddleware), `frontend/nginx.conf` |
| Caché con Redis | Los catálogos (protocolos, guías de medicación y umbrales de alerta) se guardan en caché y se descartan al editarlos. Usa Redis si existe `CACHE_URL`; si no, la memoria del proceso. | `medical_monitor/caching.py` |
| Conexiones a la base de datos | Las conexiones se reutilizan entre peticiones (`CONN_MAX_AGE=60`) y se comprueban antes de usarse. | `settings.py` |
| Timeout en APIs externas | Gemini: 20 s. CIMA y RxNav: 4 s (solo si el vademécum local no tiene el fármaco; las búsquedas de CIMA se guardan 24 h). Correo: 10 s. Redis: 1 s. Si se agota el tiempo, el sistema sigue con su alternativa local. | `ai/client.py`, `services.py`, `settings.py` |
| Respuesta de la IA en vivo | El asistente muestra la respuesta mientras el modelo la escribe (Server-Sent Events). Si la transmisión falla, usa la petición normal. | `AssistantStreamView`, `services/assistantStream.js` |
| Interfaz optimista | El mensaje del paciente aparece en el chat al instante y se retira si el envío falla. | `ConversationalAssistant.jsx` |
| Peticiones en paralelo | El portal del paciente lanza sus cuatro cargas a la vez. | `Prescriptions.jsx` |
| Rastreo de peticiones lentas | Cada respuesta lleva la cabecera `Server-Timing` y las que superan 800 ms quedan en el registro con su ruta y número de consultas. | `backend/core/middleware.py` |
| JavaScript dividido por página | Cada pantalla se descarga al visitarla. React, las utilidades y D3 van en archivos aparte. | `App.jsx`, `vite.config.js` |
| Listas largas | Las listas largas están paginadas en el servidor; la lista de pacientes usa `content-visibility` para no pintar lo que no se ve. | `DoctorDashboard.jsx` |
| Dependencias sin usar | Se quitaron `anthropic` del backend y `@types/react` y `@types/react-dom` del frontend. | `requirements.txt`, `package.json` |
| Caché de estáticos en el navegador | Los archivos de `/assets` llevan un hash y se sirven con caché de un año; `index.html` no se guarda. | `frontend/nginx.conf` |
| Fuentes | No se descargan fuentes: se usan las del sistema. | `index.css` |
| Scripts de terceros | No hay ninguno. | — |
| Tareas lentas fuera de la petición | Los correos y el resumen de IA por alerta roja se ejecutan después de responder al usuario; los recordatorios los envía el servicio `scheduler`. | `services.py`, `ai/summaries.py`, `docker-compose.yml` |

## Tamaño del frontend compilado

Medido con `vite build` (tamaño comprimido con Gzip):

| Archivo | Tamaño | Cuándo se descarga |
|---|---|---|
| React y enrutador | 82 kB | Siempre |
| Utilidades (axios y otras) | 19 kB | Siempre |
| Aplicación base, inicio y login | 9 kB | Siempre |
| Estilos | 8 kB | Siempre |
| Portal del paciente | 10 kB | Al entrar como paciente |
| Panel del odontólogo | 6 kB | Al entrar como odontólogo |
| Gráficas (D3) | 22 kB | Solo en pantallas con gráficas |

## Decisiones de despliegue (no son código)

| Práctica | Estado |
|---|---|
| CDN para los estáticos | Preparado: compila con `VITE_CDN_URL=https://tu-cdn/` y sube la carpeta `dist/assets`. Falta contratar la CDN. |
| Brotli | nginx de serie solo trae Gzip. Una CDN aplica Brotli sin tocar el código. |
| Cola de trabajos | Hoy las tareas lentas corren en hilos del mismo proceso. Una cola real (Celery o RQ) necesita un proceso «worker» adicional, con su costo. Redis ya está disponible como intermediario si se decide añadirla. |
| OpenTelemetry | El middleware de tiempos cubre la detección de peticiones lentas sin servicios externos. Exportar trazas requiere un colector donde enviarlas. |
| Varias instancias y balanceo | El backend no guarda estado en memoria (sesión por JWT, caché y límites de uso en Redis), así que puede replicarse detrás de un balanceador. |
| Servidor cerca de la base de datos | Desplegar el backend y PostgreSQL en la misma región del proveedor. |
| Pool de conexiones | Con varias instancias conviene PgBouncer o el pool del proveedor; `CONN_MAX_AGE` ya está configurado. |
| Renderizado en servidor o en build | No se aplicó: casi toda la aplicación está detrás del inicio de sesión, donde no aporta. |
| Monitoreo de usuarios reales | Pendiente: requiere un servicio que reciba las métricas (por ejemplo, Web Vitals). |
| Pruebas en celulares y redes lentas | Pendiente de hacer a mano en Chrome (Herramientas → Rendimiento → «Slow 4G») sobre `vite preview`. |

## Modelo de IA y velocidad

Medido con la clave del proyecto:

| Modelo | Primer texto visible | Respuesta completa |
|---|---|---|
| `gemini-3.5-flash-lite` (configurado) | 1,6 s | 1,7 s |
| `gemini-4-hydrogen` | 3,5 s | 3–5 s |
| `gemini-2.5-flash` | — | No disponible para claves nuevas (404) |

El asistente usa `gemini-3.5-flash-lite` porque conversa en tiempo real. `gemini-4-hydrogen` razona antes de
escribir y tarda el doble; se puede volver a él con `AI_MODEL` en `.env` y recreando el backend.

## Cómo comprobarlo

- Consultas por listado: `python manage.py test medical_monitor.tests_performance --settings=core.settings_test`.
- Tiempo de una petición: pestaña Red del navegador → una petición a `/api/` → Tiempos → «Server Timing».
- Peticiones lentas: `docker compose logs backend | grep "Petición lenta"`.
