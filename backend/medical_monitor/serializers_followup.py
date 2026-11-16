from rest_framework import serializers

from .models import CareCheckin, TreatmentPhase


class TreatmentPhaseSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = TreatmentPhase
        fields = ['id', 'name', 'description', 'order', 'planned_days', 'start_date', 'end_date', 'status', 'status_label']
        read_only_fields = ['id', 'status_label']

    def validate_planned_days(self, value):
        if not 1 <= value <= 1000:
            raise serializers.ValidationError('La duración de la fase debe estar entre 1 y 1000 días.')
        return value


class CareCheckinSerializer(serializers.ModelSerializer):
    adherence = serializers.IntegerField(read_only=True)

    class Meta:
        model = CareCheckin
        fields = ['id', 'treatment_plan', 'date', 'items', 'adherence', 'updated_at']
        read_only_fields = ['id', 'treatment_plan', 'date', 'adherence', 'updated_at']

    def validate_items(self, value):
        if not isinstance(value, dict) or not value:
            raise serializers.ValidationError('Indica qué cuidados cumpliste.')
        if len(value) > 20 or any(not isinstance(key, str) or len(key) > 120 for key in value):
            raise serializers.ValidationError('La lista de cuidados no es válida.')
        if any(not isinstance(done, bool) for done in value.values()):
            raise serializers.ValidationError('Cada cuidado debe marcarse como cumplido o no.')
        return value
