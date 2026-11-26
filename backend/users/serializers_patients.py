from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from medical_monitor.consultations import next_control_payload

from .credentials import temporary_password as new_temporary_password
from .models import UserProfile, title_case_name
from .validators import validate_birth_date_value, validate_phone_value

User = get_user_model()


class PatientCreateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=80)
    national_id = serializers.CharField(max_length=20)
    birth_date = serializers.DateField()
    phone = serializers.CharField(max_length=30)
    emergency_contact = serializers.CharField(max_length=30)
    # Obligatorio: las credenciales temporales y los recordatorios se envían a este correo.
    email = serializers.EmailField(max_length=254, error_messages={
        'required': 'Indica el correo del paciente: allí recibirá sus credenciales de acceso.',
        'blank': 'Indica el correo del paciente: allí recibirá sus credenciales de acceso.',
    })

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Ya existe una cuenta con este correo.')
        return value

    def validate_first_name(self, value):
        return self._validate_name(value, 'Los nombres')

    def validate_last_name(self, value):
        return self._validate_name(value, 'Los apellidos')

    def _validate_name(self, value, label):
        clean_value = title_case_name(value)
        if len(clean_value) < 2 or any(character.isdigit() for character in clean_value):
            raise serializers.ValidationError(f'{label} deben tener al menos 2 letras.')
        return clean_value

    def validate_national_id(self, value):
        clean_value = value.strip()
        if not clean_value.isdigit() or not 8 <= len(clean_value) <= 20:
            raise serializers.ValidationError('La identificación debe contener entre 8 y 20 números.')
        if UserProfile.objects.filter(national_id=clean_value).exists():
            raise serializers.ValidationError('Ya existe un paciente con esta identificación.')
        if User.objects.filter(username=f'paciente.{clean_value}').exists():
            raise serializers.ValidationError('Ya existe una cuenta asociada a esta identificación.')
        return clean_value

    def validate_birth_date(self, value):
        return validate_birth_date_value(value)

    def validate_phone(self, value):
        return validate_phone_value(value)

    def validate_emergency_contact(self, value):
        return self.validate_phone(value)

    @transaction.atomic
    def create(self, validated_data):
        national_id = validated_data['national_id']
        username = f'paciente.{national_id}'
        temporary_password = new_temporary_password()
        user = User.objects.create_user(
            username=username,
            password=temporary_password,
            first_name=validated_data['first_name'],
            last_name=validated_data['last_name'],
            email=validated_data.get('email', ''),
            role=User.Roles.PATIENT,
            must_change_password=True,
            must_accept_terms=True,
        )
        UserProfile.objects.create(
            user=user,
            national_id=national_id,
            birth_date=validated_data['birth_date'],
            phone=validated_data['phone'],
            emergency_contact=validated_data['emergency_contact'],
            primary_doctor=self.context.get('doctor'),
        )
        return user, temporary_password


class PatientSearchSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='get_full_name', read_only=True)
    national_id = serializers.CharField(source='profile.national_id', read_only=True, allow_null=True)
    birth_date = serializers.DateField(source='profile.birth_date', read_only=True, allow_null=True)
    age = serializers.IntegerField(read_only=True)
    has_active_treatment = serializers.SerializerMethodField()
    risk_level = serializers.SerializerMethodField()
    latest_report = serializers.SerializerMethodField()
    specialty = serializers.SerializerMethodField()
    specialty_label = serializers.SerializerMethodField()
    treatment = serializers.SerializerMethodField()
    next_control = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'full_name', 'national_id', 'birth_date', 'age',
            'has_active_treatment', 'risk_level', 'latest_report',
            'specialty', 'specialty_label', 'treatment', 'next_control',
        ]

    def _active_plan(self, obj):
        if not self._treats(obj):
            return None
        active = [plan for plan in obj.treatment_plans.all() if plan.is_active]
        return max(active, key=lambda plan: (plan.start_date or plan.created_at.date(), plan.created_at), default=None)

    def get_specialty(self, obj):
        plan = self._active_plan(obj)
        return plan.specialty if plan else None

    def get_specialty_label(self, obj):
        plan = self._active_plan(obj)
        if plan is None:
            return None
        return plan.clinical_procedure.get_specialty_display() if plan.clinical_procedure else 'Cirugía oral'

    def get_treatment(self, obj):
        plan = self._active_plan(obj)
        if plan is None:
            return None
        return (plan.clinical_procedure.name if plan.clinical_procedure else plan.procedure) or plan.title

    def get_next_control(self, obj):
        """Próximo control del tratamiento vigente: {date, days_left, overdue}."""
        plan = self._active_plan(obj)
        return next_control_payload(plan) if plan else None

    def _treats(self, obj):
        # Un médico ajeno localiza la ficha por cédula exacta, pero no ve su estado clínico.
        treated = self.context.get('treated_ids')
        return treated is None or obj.pk in treated

    def _latest(self, obj):
        reports = obj.postoperative_reports.all()
        return reports[0] if self._treats(obj) and len(reports) else None

    def get_has_active_treatment(self, obj):
        return self._treats(obj) and any(plan.is_active for plan in obj.treatment_plans.all())

    def get_risk_level(self, obj):
        report = self._latest(obj)
        if not report:
            return 'Sin seguimiento'
        return report.risk_level

    def get_latest_report(self, obj):
        report = self._latest(obj)
        if not report:
            return None
        return {
            'pain_level': report.pain_level,
            'evolution_status': report.evolution_status,
            'created_at': report.created_at,
        }
