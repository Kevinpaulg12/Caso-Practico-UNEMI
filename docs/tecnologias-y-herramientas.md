# 1. Tecnologías y herramientas

DentalSense AI es una aplicación web para el seguimiento postoperatorio odontológico. Sigue una arquitectura cliente-servidor desacoplada: un **frontend** en React que consume una **API REST** construida con Django REST Framework, respaldada por una base de datos PostgreSQL, una caché Redis y un módulo de inteligencia artificial que combina procesamiento de lenguaje natural (PLN) local con un modelo de lenguaje generativo. A continuación se describen las tecnologías empleadas en cada capa, los motivos de su elección y cómo contribuyen al desarrollo del proyecto.

## 1.1 Resumen de tecnologías

| Capa | Tecnología | Versión | Función en el proyecto |
|---|---|---|---|
| Servidor | Python | 3.12 | Lenguaje del backend |
| Servidor | Django | 5.0 | Framework web: modelos, ORM, migraciones, administración |
| Servidor | Django REST Framework | 3.15 | Construcción de la API REST |
| Servidor | djangorestframework-simplejwt | 5.3 | Autenticación con tokens JWT |
| Servidor | django-cors-headers | 4.4 | Permitir peticiones del frontend (CORS) |
| Servidor | django-environ | 0.14 | Configuración por variables de entorno (`.env`) |
| IA / PLN | spaCy + `es_core_news_sm` | 3.8 | Extracción de síntomas, medicamentos y dosis en español |
| IA generativa | Google Gemini (SDK `google-genai`) | 3.3 | Asistente conversacional, resúmenes clínicos y explicaciones |
| IA generativa | Pydantic | — | Validación de las respuestas JSON del modelo |
| Datos | PostgreSQL | 15 | Base de datos relacional principal |
| Datos | psycopg2 | 2.9 | Conector de Python con PostgreSQL |
| Datos | Redis | 7 | Caché compartida de catálogos y límites de uso |
| Cliente | JavaScript (JSX) | ES2022+ | Lenguaje del frontend |
| Cliente | React | 19 | Biblioteca de interfaces basada en componentes |
| Cliente | React Router | 7 | Navegación y rutas protegidas por rol |
| Cliente | Vite | 8 | Servidor de desarrollo y empaquetado |
| Cliente | Tailwind CSS (+ PostCSS, Autoprefixer) | 3.4 | Estilos y diseño responsivo |
| Cliente | Axios | 1.x | Cliente HTTP para consumir la API |
| Cliente | D3.js | 7 | Gráficas de evolución del dolor, adherencia y reportes |
| Pruebas | Django TestCase (SQLite en memoria) | — | Pruebas unitarias y de API del backend |
| Pruebas | Vitest + Testing Library + jsdom | 5 / 16 | Pruebas de componentes y páginas del frontend |
| Calidad | Oxlint | 1.x | Análisis estático (linter) del código JavaScript |
| Despliegue | Docker y Docker Compose | — | Contenedores para base de datos, caché, backend, tareas y frontend |
| Despliegue | Node.js | 20 | Entorno de ejecución para instalar dependencias y compilar el frontend |
| Despliegue | Nginx | 1.27 | Servidor de los archivos estáticos del frontend en producción |
| Desarrollo | Visual Studio Code | — | Entorno de desarrollo (IDE) |
| Desarrollo | Git y GitHub | — | Control de versiones y repositorio remoto |

## 1.2 Tecnologías del lado del servidor (backend)

**Python 3.12.** Se eligió como lenguaje del servidor por su sintaxis clara, su amplia comunidad y, sobre todo, porque concentra las bibliotecas de referencia en PLN e inteligencia artificial. Al usar el mismo lenguaje para la API y para el análisis de texto, la lógica clínica y el procesamiento de lenguaje conviven en un solo proyecto sin servicios intermedios.

**Django 5.0.** Es el framework web principal. Ofrece un ORM para definir los modelos (pacientes, consultas, tratamientos, reportes, alertas, auditoría) sin escribir SQL a mano, un sistema de migraciones que versiona la estructura de la base de datos, un panel de administración listo para usar, y protecciones de seguridad integradas (contraseñas cifradas, protección contra inyección SQL, XSS y CSRF). Su enfoque de «baterías incluidas» redujo el tiempo de desarrollo, y sus comandos de gestión permitieron automatizar tareas como el envío de recordatorios (`send_reminders`), la carga de datos de demostración (`seed_demo`) y la evaluación del módulo de PLN (`evaluate_nlp`).

**Django REST Framework (DRF).** Convierte los modelos de Django en una API REST mediante serializadores, vistas y permisos. Facilita la validación de datos de entrada, la paginación de resultados y el control de acceso por rol (administrador, odontólogo y paciente), lo que mantiene la API coherente y fácil de ampliar.

**Simple JWT.** Implementa la autenticación con JSON Web Tokens. Al ser un mecanismo sin estado, el frontend guarda el token y lo envía en cada petición, lo que encaja con una arquitectura en la que cliente y servidor están separados.

**django-cors-headers y django-environ.** El primero permite que el frontend, servido en otro origen (puerto 5173 en desarrollo), consuma la API de forma controlada. El segundo carga la configuración (credenciales de base de datos, clave secreta, clave de la API de IA) desde un archivo `.env`, de modo que ningún secreto queda escrito en el código fuente.

## 1.3 Inteligencia artificial y procesamiento de lenguaje natural

**spaCy con el modelo `es_core_news_sm`.** Es el motor local de PLN que analiza los reportes que escriben los pacientes en español. Mediante un `EntityRuler` reconoce síntomas (dolor, inflamación, sangrado, fiebre, signos de infección, etc.), medicamentos, dosis y frecuencias, y estima la intensidad de cada síntoma y si está negado («ya no me duele»). Junto con un motor de reglas clínicas por especialidad (cirugía, endodoncia, implantes, ortodoncia, periodoncia, prótesis y operatoria), determina el nivel de alerta del paciente. Se eligió porque es rápido, funciona sin conexión, tiene buen soporte para el español y produce resultados explicables, algo indispensable en un contexto clínico.

**Google Gemini (SDK oficial `google-genai`).** Se usa como complemento para el asistente conversacional del paciente, los resúmenes clínicos para el odontólogo y las explicaciones en lenguaje sencillo. Cada llamada solicita una salida JSON validada con **Pydantic** y queda registrada para su auditoría. Se seleccionó por la calidad de su generación en español y su caché implícita de instrucciones, que reduce costos. Dos decisiones de diseño refuerzan la seguridad: los datos se **anonimizan** antes de enviarse (no salen nombres, cédulas, teléfonos, correos ni fechas exactas, conforme a la LOPDP), y la IA generativa **nunca es imprescindible**: si no hay clave o el servicio falla, el sistema usa sus alternativas locales y el triaje sigue a cargo del motor de PLN y reglas.

## 1.4 Gestión de datos

**PostgreSQL 15.** Es el gestor de base de datos relacional. Se eligió por su robustez, su cumplimiento de las propiedades ACID (indispensable para datos clínicos), su buen rendimiento con consultas complejas y su integración nativa con Django a través del conector **psycopg2**.

**Redis 7.** Actúa como caché compartida en memoria para los catálogos clínicos y los límites de uso de la IA. Reduce la carga sobre la base de datos y acelera las respuestas de la API. Es opcional: sin Redis, el backend usa la memoria del propio proceso.

## 1.5 Tecnologías del lado del cliente (frontend)

**React 19 con JavaScript (JSX).** Es la biblioteca con la que se construye la interfaz. Su modelo de componentes reutilizables (formularios de consulta, odontograma, tarjetas de alerta, gráficas) permitió crear tres paneles diferenciados —administrador, odontólogo y paciente— compartiendo piezas comunes. El estado de la sesión se gestiona con la Context API (`AuthContext`).

**React Router 7.** Gestiona la navegación entre páginas y protege las rutas según la autenticación y el rol del usuario (`ProtectedRoute`, `RoleRoute`).

**Vite 8.** Es la herramienta de construcción. Su servidor de desarrollo con recarga instantánea agiliza el trabajo diario, y en producción genera archivos optimizados y minificados.

**Tailwind CSS.** Framework de estilos basado en clases utilitarias que permitió diseñar una interfaz consistente y adaptable a móviles sin escribir hojas de estilo extensas. Se procesa con **PostCSS** y **Autoprefixer** para asegurar compatibilidad entre navegadores.

**Axios.** Cliente HTTP con el que el frontend se comunica con la API. Centraliza la URL base y añade automáticamente el token JWT a cada petición.

**D3.js.** Biblioteca de visualización con la que se construyeron las gráficas de evolución del dolor, adherencia al tratamiento y reportes. Se prefirió frente a librerías de gráficos cerradas por el control total que ofrece sobre el diseño, las animaciones y la accesibilidad.

## 1.6 Pruebas y calidad de código

- **Backend:** el sistema de pruebas de Django cubre modelos, servicios, API, reglas clínicas, IA, migraciones y rendimiento. Usa una base SQLite en memoria para que las pruebas sean rápidas y no afecten datos reales.
- **Frontend:** **Vitest** junto con **React Testing Library**, **user-event** y **jsdom** prueba componentes y páginas simulando la interacción del usuario.
- **Oxlint:** analizador estático muy rápido que detecta errores y malas prácticas en el código JavaScript.

Estas herramientas permitieron detectar fallos de forma temprana y modificar el código con confianza.

## 1.7 Entorno de desarrollo, despliegue y control de versiones

**Visual Studio Code.** Fue el entorno de desarrollo integrado (IDE) utilizado. Se eligió por ser gratuito y ligero, y por sus extensiones para Python, Django, React, Tailwind CSS, Docker y Git, que permiten trabajar ambas capas del proyecto desde un mismo editor.

**Docker y Docker Compose.** Todo el sistema se ejecuta en contenedores con un solo comando (`docker compose up --build`): base de datos PostgreSQL, caché Redis, backend Django (que aplica las migraciones al arrancar), un programador que envía recordatorios por correo cada 15 minutos, y el frontend. Así se garantiza que el entorno sea idéntico en cualquier equipo y se elimina el problema de «en mi máquina sí funciona».

**Node.js 20 y npm.** Entorno de ejecución y gestor de paquetes con los que se instalan las dependencias y se compila el frontend.

**Nginx.** En producción, una imagen Docker de varias etapas compila el frontend con Vite y lo sirve con Nginx, con archivos precomprimidos (gzip) para responder más rápido.

**Git y GitHub.** Git se usó para el control de versiones y GitHub como repositorio remoto. Permiten conservar el historial de cambios, trabajar en ramas independientes y respaldar el proyecto en la nube.

## 1.8 Contribución al desarrollo eficiente del proyecto

La combinación elegida aporta eficiencia en varios aspectos:

1. **Un solo lenguaje para la lógica y la IA:** Python une la API, las reglas clínicas y el PLN, lo que evita integraciones adicionales.
2. **Frameworks maduros:** Django, DRF y React aportan soluciones probadas para autenticación, validación, seguridad y componentes, lo que permitió centrarse en la lógica odontológica.
3. **Separación de capas:** al tener frontend y backend desacoplados y comunicados por una API REST, cada parte puede evolucionar, probarse y desplegarse por separado.
4. **Fiabilidad y privacidad:** el triaje depende de un motor local y explicable; la IA generativa es un complemento con datos anonimizados y alternativas locales ante cualquier fallo.
5. **Entornos reproducibles:** Docker Compose levanta todo el sistema con un comando, y las pruebas automatizadas junto con el control de versiones dan seguridad al introducir cambios.
6. **Herramientas libres:** casi todas las tecnologías son de código abierto, lo que reduce los costos del proyecto.
