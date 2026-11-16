"""Notación dental FDI (ISO 3950): primer dígito = cuadrante, segundo = pieza."""
from rest_framework import serializers

PERMANENT = [quadrant * 10 + tooth for quadrant in (1, 2, 3, 4) for tooth in range(1, 9)]
PRIMARY = [quadrant * 10 + tooth for quadrant in (5, 6, 7, 8) for tooth in range(1, 6)]
VALID_TEETH = frozenset(PERMANENT + PRIMARY)


def validate_teeth(value):
    """Lista de piezas FDI válidas, sin repetir y ordenada."""
    if value in (None, ''):
        return []
    if not isinstance(value, list) or any(not isinstance(item, int) or isinstance(item, bool) for item in value):
        raise serializers.ValidationError('Indica las piezas como una lista de números FDI (p. ej. [36, 37]).')
    invalid = sorted(set(value) - VALID_TEETH)
    if invalid:
        raise serializers.ValidationError(f'Piezas no válidas en notación FDI: {", ".join(map(str, invalid))}.')
    if len(value) > 32:
        raise serializers.ValidationError('Se pueden indicar como máximo 32 piezas.')
    return sorted(set(value))
