from collections.abc import Mapping

from django.contrib.auth import password_validation
from rest_framework import serializers

from .models import User, UserProfile
from .validators import validate_birth_date_value, validate_phone_value


class AccountSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='get_full_name', read_only=True)
    professional_title = serializers.CharField(read_only=True)
    birth_date = serializers.DateField(source='profile.birth_date', allow_null=True, required=False)
    national_id = serializers.CharField(source='profile.national_id', read_only=True)
    phone = serializers.CharField(source='profile.phone', required=False, allow_blank=True, max_length=30)
    emergency_contact = serializers.CharField(
        source='profile.emergency_contact',
        required=False,
        allow_blank=True,
        max_length=30,
    )

    class Meta:
        model = User
        fields = [
            'id', 'username', 'first_name', 'last_name', 'full_name', 'email',
            'role', 'professional_title', 'birth_date', 'national_id',
            'phone', 'emergency_contact',
        ]
        read_only_fields = ['id', 'username', 'full_name', 'role', 'professional_title', 'national_id']

    def to_internal_value(self, data):
        # Un campo de fecha vacío en un formulario significa "sin fecha".
        if isinstance(data, Mapping) and data.get('birth_date') == '':
            data = {**data, 'birth_date': None}
        return super().to_internal_value(data)

    def validate_birth_date(self, value):
        return validate_birth_date_value(value)

    def validate_phone(self, value):
        return validate_phone_value(value) if value else value

    def validate_emergency_contact(self, value):
        return validate_phone_value(value) if value else value

    def update(self, instance, validated_data):
        profile_data = validated_data.pop('profile', {})
        instance = super().update(instance, validated_data)
        profile, _ = UserProfile.objects.get_or_create(user=instance)
        for field, value in profile_data.items():
            setattr(profile, field, value)
        profile.save()
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = self.context['request'].user
        if not user.check_password(attrs['current_password']):
            raise serializers.ValidationError({'current_password': 'La contraseña actual no es correcta.'})
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError({'confirm_password': 'Las contraseñas nuevas no coinciden.'})
        password_validation.validate_password(attrs['new_password'], user)
        return attrs
