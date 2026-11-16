from rest_framework import serializers

from .models import User


class CurrentUserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='get_full_name', read_only=True)
    professional_title = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'full_name', 'role', 'professional_title',
            'must_accept_terms', 'must_change_password',
        ]
        read_only_fields = fields
