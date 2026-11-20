from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import User


class CurrentUserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='get_full_name', read_only=True)
    professional_title = serializers.CharField(read_only=True)
    # Fecha y zona horaria del consultorio: el cliente las usa para no proponer fechas que el servidor
    # rechaza por futuras cuando el navegador está en otra zona horaria.
    clinic_today = serializers.SerializerMethodField()
    clinic_timezone = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'full_name', 'role', 'professional_title',
            'must_accept_terms', 'must_change_password', 'clinic_today', 'clinic_timezone',
        ]
        read_only_fields = fields

    def get_clinic_today(self, obj):
        return timezone.localdate().isoformat()

    def get_clinic_timezone(self, obj):
        return settings.TIME_ZONE
