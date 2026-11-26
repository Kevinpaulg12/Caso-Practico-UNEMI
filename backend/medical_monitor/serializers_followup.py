from django.utils import timezone
from rest_framework import serializers

from .models import AppointmentRequest, CareCheckin, DoctorSchedule, TimeOff, TreatmentPhase, WorkingHours


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


class AppointmentRequestSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    period_label = serializers.CharField(source='get_preferred_period_display', read_only=True)
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    patient_name = serializers.SerializerMethodField()
    doctor_name = serializers.SerializerMethodField()
    treatment = serializers.SerializerMethodField()
    ends_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = AppointmentRequest
        fields = [
            'id', 'patient', 'patient_name', 'doctor', 'doctor_name', 'treatment_plan', 'treatment',
            'starts_at', 'ends_at', 'duration_minutes', 'kind', 'kind_label',
            'preferred_date', 'preferred_period', 'period_label', 'reason', 'status', 'status_label',
            'note', 'created_at',
        ]
        read_only_fields = fields

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() or obj.patient.username

    def get_doctor_name(self, obj):
        return (obj.doctor.get_full_name() or obj.doctor.username) if obj.doctor else None

    def get_treatment(self, obj):
        plan = obj.treatment_plan
        return (plan.procedure or plan.title) if plan else None


class CancelAppointmentSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default='')


class WorkingHoursSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkingHours
        fields = ['weekday', 'start', 'end']

    def validate_weekday(self, value):
        if not 0 <= value <= 6:
            raise serializers.ValidationError('Indica un día de lunes (0) a domingo (6).')
        return value

    def validate(self, attrs):
        if attrs['start'] >= attrs['end']:
            raise serializers.ValidationError({'end': 'La hora de fin debe ser posterior a la de inicio.'})
        return attrs


class DoctorScheduleSerializer(serializers.ModelSerializer):
    hours = WorkingHoursSerializer(many=True)

    class Meta:
        model = DoctorSchedule
        fields = ['slot_minutes', 'max_days_ahead', 'hours', 'updated_at']
        read_only_fields = ['updated_at']

    def validate_max_days_ahead(self, value):
        if not 1 <= value <= 120:
            raise serializers.ValidationError('Indica entre 1 y 120 días.')
        return value

    def validate_hours(self, value):
        if len(value) > 28:
            raise serializers.ValidationError('Demasiadas franjas: como máximo 4 por día.')
        by_day = {}
        for item in value:
            by_day.setdefault(item['weekday'], []).append((item['start'], item['end']))
        for ranges in by_day.values():
            ranges.sort()
            for (_, previous_end), (start, _) in zip(ranges, ranges[1:]):
                if start < previous_end:
                    raise serializers.ValidationError('Las franjas de un mismo día no pueden solaparse.')
        return value


class TimeOffSerializer(serializers.ModelSerializer):
    all_day = serializers.BooleanField(read_only=True)

    class Meta:
        model = TimeOff
        fields = ['id', 'date', 'start', 'end', 'reason', 'all_day', 'created_at']
        read_only_fields = ['id', 'all_day', 'created_at']

    def validate_date(self, value):
        if value < timezone.localdate():
            raise serializers.ValidationError('No puedes bloquear un día que ya pasó.')
        return value

    def validate(self, attrs):
        start, end = attrs.get('start'), attrs.get('end')
        if (start is None) != (end is None):
            raise serializers.ValidationError({'end': 'Indica la hora de inicio y la de fin, o ninguna para todo el día.'})
        if start is not None and start >= end:
            raise serializers.ValidationError({'end': 'La hora de fin debe ser posterior a la de inicio.'})
        return attrs
