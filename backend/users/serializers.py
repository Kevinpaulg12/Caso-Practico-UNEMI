from rest_framework import serializers

from .models import UserProfile
from .validators import validate_birth_date_value, validate_phone_value


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    age = serializers.IntegerField(source='user.age', read_only=True)
    doctor_contact = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = [
            'username',
            'birth_date',
            'national_id',
            'age',
            'phone',
            'emergency_contact',
            'doctor_contact',
        ]
        read_only_fields = ['national_id']

    def get_doctor_contact(self, profile):
        """Contacto del odontólogo tratante, para que el paciente sepa a quién llamar o escribir."""
        doctor = profile.primary_doctor
        if not doctor:
            return None
        doctor_profile = getattr(doctor, 'profile', None)
        return {
            'name': doctor.get_full_name() or doctor.username,
            'phone': getattr(doctor_profile, 'phone', '') or '',
            'email': doctor.email or '',
        }

    def validate_birth_date(self, value):
        return validate_birth_date_value(value)

    def validate_phone(self, value):
        return validate_phone_value(value) if value else value

    def validate_emergency_contact(self, value):
        return validate_phone_value(value) if value else value
