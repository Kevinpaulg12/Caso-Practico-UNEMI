from rest_framework import serializers

from .consultations import next_control_payload
from .dental import validate_teeth
from .models import ClinicalEvolutionSummary, ClinicalProcedure, TreatmentPlan
from .serializers import MedicationGuidanceMixin, validate_patient_target
from .serializers_followup import TreatmentPhaseSerializer
from .services import find_medication_guide
from .treatments import display_clinical_data


class TreatmentPlanSerializer(MedicationGuidanceMixin, serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.username', read_only=True)
    patient_full_name = serializers.SerializerMethodField()
    treatment_type_label = serializers.CharField(
        source='get_treatment_type_display',
        read_only=True,
    )
    current_day = serializers.IntegerField(read_only=True)
    clinical_procedure = serializers.PrimaryKeyRelatedField(
        queryset=ClinicalProcedure.objects.filter(is_active=True), required=False, allow_null=True,
    )
    procedure_detail = serializers.SerializerMethodField()
    surgery_date = serializers.DateField(read_only=True)
    postoperative_day = serializers.IntegerField(read_only=True)
    medication_guidance = serializers.SerializerMethodField()
    specialty = serializers.CharField(read_only=True)
    specialty_label = serializers.SerializerMethodField()
    teeth = serializers.JSONField(required=False)
    phases = serializers.SerializerMethodField()
    current_phase = serializers.SerializerMethodField()
    next_control = serializers.SerializerMethodField()
    clinical_data_display = serializers.SerializerMethodField()
    medications = serializers.SerializerMethodField()

    class Meta:
        model = TreatmentPlan
        fields = [
            'id',
            'patient',
            'patient_name',
            'patient_full_name',
            'title',
            'treatment_type',
            'treatment_type_label',
            'schedule_description',
            'next_due_time',
            'instructions',
            'diet_instructions',
            'side_effects',
            'day_number',
            'current_day',
            'procedure',
            'clinical_procedure',
            'procedure_detail',
            'start_date',
            'surgery_date',
            'postoperative_day',
            'treatment_severity',
            'care_recommendations',
            'admission_reason',
            'clinical_notes',
            'medication_name',
            'strength',
            'dosage_form',
            'frequency',
            'duration',
            'is_active',
            'created_at',
            'updated_at',
            'medication_guidance',
            'specialty',
            'specialty_label',
            'teeth',
            'last_intervention_date',
            'phases',
            'current_phase',
            'next_control',
            'next_control_date',
            'clinical_data',
            'clinical_data_display',
            'medications',
        ]
        read_only_fields = [
            'patient_name', 'treatment_type_label', 'current_day',
            'treatment_severity', 'care_recommendations', 'created_at', 'updated_at', 'last_intervention_date',
            'next_control_date', 'clinical_data',
        ]

    def validate_patient(self, value):
        return validate_patient_target(self, value)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        # Las notas clínicas internas son para el equipo odontológico, nunca para el paciente.
        if request is not None and getattr(request.user, 'role', None) == 'PAT':
            data.pop('clinical_notes', None)
        return data

    def get_patient_full_name(self, obj):
        return obj.patient.get_full_name() or obj.patient.username

    def validate_teeth(self, value):
        return validate_teeth(value)

    def get_medications(self, obj):
        """Medicamentos vigentes del tratamiento (uno por receta activa)."""
        from .treatments import active_medications
        return active_medications(obj)

    def get_procedure_detail(self, obj):
        procedure = obj.clinical_procedure
        if not procedure:
            return None
        return {
            'code': procedure.code,
            'name': procedure.name,
            'specialty': procedure.specialty,
            'monitoring_days': procedure.monitoring_days,
            'follow_up_unit': procedure.follow_up_unit,
            'expected_curve': procedure.expected_curve,
            'care_items': procedure.care_items,
            'control_every_days': procedure.control_every_days,
            'medication_default': procedure.medication_default,
            'consultation_fields': procedure.consultation_fields,
        }

    def get_specialty_label(self, obj):
        return ClinicalProcedure.Specialty(obj.specialty).label

    def get_phases(self, obj):
        return TreatmentPhaseSerializer(obj.phases.all(), many=True).data

    def get_current_phase(self, obj):
        return TreatmentPhaseSerializer(obj.current_phase).data if obj.current_phase_id else None

    def get_next_control(self, obj):
        return next_control_payload(obj)

    def get_clinical_data_display(self, obj):
        return display_clinical_data(obj.clinical_procedure, obj.clinical_data)

    def validate_day_number(self, value):
        if value < 1:
            raise serializers.ValidationError('El día de recuperación debe ser mayor que cero.')
        return value

    def get_medication_guidance(self, obj):
        if obj.treatment_type != TreatmentPlan.TreatmentType.MEDICATION:
            return None
        return find_medication_guide(f'{obj.title} {obj.instructions}', self.medication_guides())


class ClinicalEvolutionSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = ClinicalEvolutionSummary
        fields = [
            'id',
            'day_label',
            'eva_recorded',
            'status_tag',
            'clinical_notes',
            'created_at',
        ]
        read_only_fields = fields
