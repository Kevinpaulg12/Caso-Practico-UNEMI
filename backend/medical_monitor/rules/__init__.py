"""Motor de reglas de triaje por especialidad odontológica.

El nivel de alerta lo decide siempre este motor local, de forma explicable: cada regla devuelve
(nivel, motivo) y el reporte se clasifica con el nivel más alto. Las ventanas de tiempo («hasta qué
día es esperable un síntoma») salen del protocolo del tratamiento, que el administrador edita.
"""
from dataclasses import dataclass

from . import base, cirugia, endodoncia, implantes, operatoria, ortodoncia, periodoncia, protesis

SPECIALTY_RULES = {
    'cirugia': cirugia,
    'endodoncia': endodoncia,
    'ortodoncia': ortodoncia,
    'periodoncia': periodoncia,
    'implantologia': implantes,
    'protesis': protesis,
    'operatoria': operatoria,
    'estetica': operatoria,
    'odontopediatria': operatoria,
}


@dataclass
class RuleContext:
    symptoms: dict          # categoría -> intensidad (solo síntomas afirmados)
    pain_level: int
    comparison: str | None  # lower | same | higher
    day: int | None         # días desde la última intervención (None si no hay tratamiento)
    thresholds: object      # AlertSettings
    protocol: object = None  # ClinicalProcedure o None
    duration: int | None = None  # días que el paciente dice llevar con el síntoma

    @property
    def known(self):
        return self.day is not None

    @property
    def protocol_name(self):
        return self.protocol.name if self.protocol is not None else 'este tratamiento'

    def window(self, category, default):
        """Último día en que el síntoma es esperable según el protocolo."""
        expected = getattr(self.protocol, 'expected_symptoms', None) or {}
        return expected.get(category, default)

    def beyond(self, category, default):
        """El síntoma aparece después de su ventana esperada."""
        return self.known and self.day > self.window(category, default)


def specialty_of(protocol):
    return getattr(protocol, 'specialty', None) or 'cirugia'


def evaluate(context):
    """Reglas generales + reglas de la especialidad del tratamiento: lista de (nivel, motivo)."""
    module = SPECIALTY_RULES.get(specialty_of(context.protocol), cirugia)
    return base.rules(context, handled=module.HANDLED) + module.rules(context)
