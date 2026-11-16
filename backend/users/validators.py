from django.utils import timezone
from rest_framework import serializers


def validate_birth_date_value(value):
    if value is None:
        return value
    today = timezone.localdate()
    if value > today:
        raise serializers.ValidationError('La fecha de nacimiento no puede estar en el futuro.')
    age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
    if age > 120:
        raise serializers.ValidationError('Revisa la fecha de nacimiento.')
    return value


def validate_phone_value(value):
    clean_value = value.strip()
    digits = clean_value.replace('+', '').replace(' ', '').replace('-', '')
    if not digits.isdigit() or len(digits) < 7:
        raise serializers.ValidationError('Escribe un teléfono válido.')
    return clean_value
