from collections.abc import Mapping

from rest_framework import serializers

from .models import PatientReport
from .services import evaluate_patient_status


class PatientReportSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.username', read_only=True)
    eva_score = serializers.IntegerField(source='pain_level', read_only=True)
    risk_level = serializers.SerializerMethodField()
    recommendation = serializers.SerializerMethodField()
    evolution_status = serializers.SerializerMethodField()
    alert_color = serializers.SerializerMethodField()

    class Meta:
        model = PatientReport
        fields = [
            'id',
            'patient_name',
            'pain_level',
            'eva_score',
            'comparison',
            'message',
            'nlp_severity',
            'extracted_entities',
            'doctor_notified',
            'risk_level',
            'recommendation',
            'evolution_status',
            'alert_color',
            'alert_reasons',
            'postoperative_day',
            'created_at',
        ]
        read_only_fields = [
            'alert_reasons',
            'postoperative_day',
            'id',
            'patient_name',
            'nlp_severity',
            'extracted_entities',
            'doctor_notified',
            'risk_level',
            'recommendation',
            'evolution_status',
            'created_at',
        ]

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            return super().to_internal_value(data)
        data = data.copy()
        if 'pain_level' not in data and 'eva_score' in data:
            data['pain_level'] = data['eva_score']
        return super().to_internal_value(data)

    def validate_pain_level(self, value):
        if not 0 <= value <= 10:
            raise serializers.ValidationError('El nivel de dolor debe estar entre 0 y 10.')
        return value

    def _evaluation(self, obj):
        if obj.recommendation:
            return {
                'risk_level': obj.risk_level,
                'recommendation': obj.recommendation,
                'evolution_status': obj.evolution_status,
            }
        return evaluate_patient_status(
            obj.pain_level,
            obj.comparison,
            obj.message,
        )

    def get_risk_level(self, obj):
        return self._evaluation(obj)['risk_level']

    def get_recommendation(self, obj):
        return self._evaluation(obj)['recommendation']

    def get_evolution_status(self, obj):
        return self._evaluation(obj)['evolution_status']

    def get_alert_color(self, obj):
        return {'Bajo': 'verde', 'Medio': 'amarillo', 'Alto': 'rojo'}[self.get_risk_level(obj)]
