"""Variantes de la línea de productos DentalSense.

Cada variante es un conjunto de características activadas. El núcleo (autenticación, consultas,
autorreportes con PLN, triaje y panel clínico) está en todas; lo que cambia son las características
opcionales, cada una en su propia app de Django:

- ENABLE_REPORTS        → app `clinical_reports` (informes estadísticos del odontólogo).
- ENABLE_NOTIFICATIONS  → app `notifications` (recordatorios al paciente y correo de alerta roja).
- ENABLE_AI             → asistente, resúmenes y explicaciones con IA generativa (además necesita
                          GEMINI_API_KEY; sin ella el sistema usa sus alternativas locales).

La variante se elige con la variable de entorno PRODUCT_VARIANT (A o B). Cada bandera puede
sobrescribirse individualmente con su propia variable de entorno (por ejemplo, ENABLE_REPORTS=True).
"""

# Variante A: sistema básico, solo el núcleo clínico.
PRODUCT_A = {
    'NAME': 'DentalSense Básico',
    'ENABLE_REPORTS': False,
    'ENABLE_NOTIFICATIONS': False,
    'ENABLE_AI': False,
}

# Variante B: sistema completo con todas las funcionalidades extendidas.
PRODUCT_B = {
    'NAME': 'DentalSense Completo',
    'ENABLE_REPORTS': True,
    'ENABLE_NOTIFICATIONS': True,
    'ENABLE_AI': True,
}

PRODUCTS = {'A': PRODUCT_A, 'B': PRODUCT_B}

# App de Django que aporta cada característica opcional (ENABLE_AI vive dentro del núcleo).
FEATURE_APPS = {
    'ENABLE_REPORTS': 'clinical_reports',
    'ENABLE_NOTIFICATIONS': 'notifications',
}


def load_product(variant):
    """Devuelve una copia de la configuración de la variante pedida (A o B)."""
    key = (variant or '').strip().upper()
    if key not in PRODUCTS:
        raise ValueError(f'Variante de producto desconocida: {variant!r}. Usa una de: {", ".join(PRODUCTS)}.')
    return dict(PRODUCTS[key])


def feature_apps(features):
    """Apps opcionales que se instalan según las banderas activas."""
    return [app for flag, app in FEATURE_APPS.items() if features.get(flag)]
