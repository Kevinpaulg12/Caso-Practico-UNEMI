from rest_framework import serializers
from .models import Prescription
from .medications import guidance_catalog
from .services import find_medication_guide


def validate_patient_target(serializer, value):
    if value.role != value.Roles.PATIENT:
        raise serializers.ValidationError('La indicación debe estar vinculada a un paciente.')
    if serializer.instance is not None and value != serializer.instance.patient:
        raise serializers.ValidationError('Una indicación no se puede trasladar a otro paciente.')
    return value


class MedicationGuidanceMixin:
    def medication_guides(self):
        # Se cargan una sola vez por respuesta, no una vez por fila.
        if not hasattr(self.root, '_medication_guides'):
            self.root._medication_guides = guidance_catalog()
        return self.root._medication_guides


class PrescriptionSerializer(MedicationGuidanceMixin, serializers.ModelSerializer):
    doctor_name = serializers.CharField(source='doctor.username', read_only=True)
    patient_name = serializers.CharField(source='patient.username', read_only=True)
    medication_guidance = serializers.SerializerMethodField()

    class Meta:
        model = Prescription
        # Retiramos 'doctor' de los campos editables para que el frontend no pueda falsificarlo
        fields = [
            'id',
            'doctor_name',
            'patient',
            'patient_name',
            'details',
            'medication_name',
            'active_ingredient',
            'strength',
            'dosage_form',
            'frequency',
            'duration',
            'is_active',
            'nlp_severity',
            'extracted_entities',
            'treatment_plan',
            'created_at',
            'medication_guidance',
        ]
        read_only_fields = [
            'created_at',
            'nlp_severity',
            'extracted_entities',
            'treatment_plan',
        ]

    def validate_patient(self, value):
        return validate_patient_target(self, value)

    def get_medication_guidance(self, obj):
        return find_medication_guide(f'{obj.medication_name} {obj.details}', self.medication_guides())
