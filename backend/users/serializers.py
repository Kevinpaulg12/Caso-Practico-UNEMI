from rest_framework import serializers

from .models import UserProfile
from .validators import validate_birth_date_value, validate_phone_value


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    age = serializers.IntegerField(source='user.age', read_only=True)

    class Meta:
        model = UserProfile
        fields = [
            'username',
            'birth_date',
            'national_id',
            'age',
            'phone',
            'emergency_contact',
        ]
        read_only_fields = ['national_id']

    def validate_birth_date(self, value):
        return validate_birth_date_value(value)

    def validate_phone(self, value):
        return validate_phone_value(value) if value else value

    def validate_emergency_contact(self, value):
        return validate_phone_value(value) if value else value
