from django.conf import settings
from rest_framework import serializers

from .models import User


def active_features():
    """Características de la variante en ejecución; el frontend oculta las que están apagadas."""
    from medical_monitor.ai.client import ai_enabled

    return {
        'product': settings.PRODUCT_NAME,
        'variant': settings.PRODUCT_VARIANT,
        'reports': settings.ENABLE_REPORTS,
        'notifications': settings.ENABLE_NOTIFICATIONS,
        'ai': ai_enabled(),
    }


class CurrentUserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='get_full_name', read_only=True)
    professional_title = serializers.CharField(read_only=True)
    features = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'full_name', 'role', 'professional_title',
            'must_accept_terms', 'must_change_password', 'features',
        ]
        read_only_fields = fields

    def get_features(self, obj):
        return active_features()
