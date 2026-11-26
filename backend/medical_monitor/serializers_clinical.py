from rest_framework import serializers

from .models import AlertSettings, AuditEvent, ClinicalProcedure, InstructionPreset, Medication, MedicationGuide
from .nlp import SYMPTOMS


class AlertSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertSettings
        fields = ['high_pain', 'rising_pain', 'medium_pain', 'updated_at']
        read_only_fields = ['updated_at']

    def validate(self, attrs):
        current = self.instance
        high = attrs.get('high_pain', current.high_pain)
        rising = attrs.get('rising_pain', current.rising_pain)
        medium = attrs.get('medium_pain', current.medium_pain)
        for name, value in (('high_pain', high), ('rising_pain', rising), ('medium_pain', medium)):
            if not 1 <= value <= 10:
                raise serializers.ValidationError({name: 'El umbral debe estar entre 1 y 10.'})
        if medium > high:
            raise serializers.ValidationError({'medium_pain': 'No puede superar el umbral de riesgo alto.'})
        return attrs


class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = ['id', 'actor_label', 'action', 'module', 'created_at']
        read_only_fields = fields


def _text_list(value, label, max_items, max_length):
    if not isinstance(value, list) or len(value) > max_items:
        raise serializers.ValidationError(f'{label}: indica como máximo {max_items} elementos.')
    clean = [item.strip() for item in value if isinstance(item, str) and item.strip()]
    if len(clean) != len(value) or any(len(item) > max_length for item in clean):
        raise serializers.ValidationError(f'{label}: cada elemento debe ser un texto de hasta {max_length} caracteres.')
    return clean


class ClinicalProcedureSerializer(serializers.ModelSerializer):
    complexity_label = serializers.CharField(source='get_complexity_display', read_only=True)
    specialty_label = serializers.CharField(source='get_specialty_display', read_only=True)

    class Meta:
        model = ClinicalProcedure
        fields = [
            'id', 'code', 'name', 'specialty', 'specialty_label', 'complexity', 'complexity_label',
            'monitoring_days', 'follow_up_unit', 'checkin_every_days', 'expected_curve', 'expected_symptoms',
            'alarm_symptoms', 'care_items', 'follow_up_questions', 'default_phases', 'is_active',
            'control_every_days', 'medication_default', 'uses_teeth', 'consultation_fields',
        ]
        # Los campos propios del tratamiento se definen en el catálogo base; aquí solo se consultan.
        read_only_fields = ['consultation_fields']

    def validate_control_every_days(self, value):
        if not 0 <= value <= 730:
            raise serializers.ValidationError('Indica entre 0 y 730 días (0 = sin controles periódicos).')
        return value

    def validate_checkin_every_days(self, value):
        if not 1 <= value <= 30:
            raise serializers.ValidationError('Indica entre 1 y 30 días.')
        return value

    def validate_expected_symptoms(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Indica cada síntoma con el último día en que es esperable.')
        unknown = sorted(set(value) - set(SYMPTOMS))
        if unknown:
            raise serializers.ValidationError(f'Síntomas no reconocidos por el sistema: {", ".join(unknown)}.')
        if any(not isinstance(day, int) or isinstance(day, bool) or not 0 <= day <= 365 for day in value.values()):
            raise serializers.ValidationError('Cada ventana debe ser un número de días entre 0 y 365.')
        return value

    def validate_alarm_symptoms(self, value):
        value = _text_list(value, 'Síntomas de alarma', 20, 60)
        unknown = sorted(set(value) - set(SYMPTOMS))
        if unknown:
            raise serializers.ValidationError(f'Síntomas no reconocidos por el sistema: {", ".join(unknown)}.')
        return value

    def validate_care_items(self, value):
        return _text_list(value, 'Cuidados', 15, 120)

    def validate_follow_up_questions(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Agrupa las preguntas por síntoma («*» para preguntas generales).')
        unknown = sorted(set(value) - set(SYMPTOMS) - {'*'})
        if unknown:
            raise serializers.ValidationError(f'Síntomas no reconocidos por el sistema: {", ".join(unknown)}.')
        return {key: _text_list(items, 'Preguntas', 5, 200) for key, items in value.items()}

    def validate_default_phases(self, value):
        if not isinstance(value, list) or len(value) > 8:
            raise serializers.ValidationError('Indica como máximo 8 fases.')
        phases = []
        for phase in value:
            name = phase.get('name', '').strip() if isinstance(phase, dict) else ''
            days = phase.get('days') if isinstance(phase, dict) else None
            if not name or len(name) > 120 or not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 1000:
                raise serializers.ValidationError('Cada fase necesita un nombre y una duración entre 1 y 1000 días.')
            phases.append({'name': name, 'days': days, 'description': str(phase.get('description', ''))[:240]})
        return phases

    def validate_monitoring_days(self, value):
        if not 1 <= value <= 60:
            raise serializers.ValidationError('Indica entre 1 y 60 días.')
        return value

    def validate(self, attrs):
        days = attrs.get('monitoring_days', getattr(self.instance, 'monitoring_days', None))
        curve = attrs.get('expected_curve', getattr(self.instance, 'expected_curve', []))
        if days and len(curve) > days + 1:
            raise serializers.ValidationError({'expected_curve': 'La curva no puede tener más días que el seguimiento.'})
        return attrs

    def validate_expected_curve(self, value):
        valid = isinstance(value, list) and all(
            isinstance(point, int) and not isinstance(point, bool) and 0 <= point <= 10 for point in value
        )
        if not valid or len(value) > 60:
            raise serializers.ValidationError('La curva debe ser una lista de valores EVA entre 0 y 10.')
        return value


class MedicationGuideSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationGuide
        fields = ['id', 'name', 'common_effects', 'what_to_do', 'warning_signs', 'source_note']
        read_only_fields = fields


class MedicationSerializer(serializers.ModelSerializer):
    group_label = serializers.CharField(source='get_group_display', read_only=True)

    class Meta:
        model = Medication
        fields = [
            'id', 'generic_name', 'brands', 'group', 'group_label', 'presentations', 'frequencies', 'default_frequency',
            'duration_days', 'with_food', 'indications', 'mechanism', 'common_effects', 'warning_signs',
            'prescription_required', 'source', 'cima_registry', 'is_active', 'updated_at',
        ]
        read_only_fields = ['id', 'group_label', 'source', 'cima_registry', 'updated_at']

    def validate_brands(self, value):
        return _text_list(value, 'Marcas', 30, 120)

    def validate_frequencies(self, value):
        return _text_list(value, 'Frecuencias', 10, 60)

    def validate_presentations(self, value):
        if not isinstance(value, list) or len(value) > 30:
            raise serializers.ValidationError('Indica como máximo 30 presentaciones.')
        cleaned = []
        for item in value:
            strength = str(item.get('strength', '')).strip() if isinstance(item, dict) else ''
            if not strength or len(strength) > 40:
                raise serializers.ValidationError('Cada presentación necesita su concentración (máximo 40 caracteres).')
            cleaned.append({'strength': strength, 'form': str(item.get('form', '')).strip()[:60],
                            'route': str(item.get('route', '')).strip()[:60]})
        return cleaned

    def validate_duration_days(self, value):
        if value > 365:
            raise serializers.ValidationError('Indica una duración de hasta 365 días.')
        return value


class BrandRegistrationSerializer(serializers.Serializer):
    """Marca que no está en ninguna fuente pública (p. ej. de Ecuador) y su principio activo."""

    brand = serializers.CharField(min_length=2, max_length=120)
    active_ingredient = serializers.CharField(min_length=3, max_length=120)
    presentations = serializers.ListField(child=serializers.DictField(), required=False, max_length=30)

    def validate_presentations(self, value):
        return MedicationSerializer().validate_presentations(value)


class InstructionPresetSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstructionPreset
        fields = ['id', 'field', 'text']

    def validate_text(self, value):
        value = ' '.join(value.split())
        if len(value) < 3:
            raise serializers.ValidationError('Escribe una frase de al menos 3 caracteres.')
        return value

    def validate(self, attrs):
        doctor = self.context['request'].user
        same = InstructionPreset.objects.filter(doctor=doctor, field=attrs['field'])
        if same.filter(text__iexact=attrs['text']).exists():
            raise serializers.ValidationError({'text': 'Ya tienes guardada esa frase.'})
        if same.count() >= InstructionPreset.MAX_PER_FIELD:
            raise serializers.ValidationError(
                {'text': f'Puedes guardar hasta {InstructionPreset.MAX_PER_FIELD} frases por campo. Borra alguna antes.'}
            )
        return attrs
