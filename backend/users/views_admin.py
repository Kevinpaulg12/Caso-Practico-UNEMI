import secrets

from django.db import models, transaction
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.settings import api_settings

from medical_monitor.audit import record_audit
from medical_monitor.models import AuditEvent
from medical_monitor.views_clinical import IsAdminRole

from .models import User


class AdminUserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='get_full_name', read_only=True)
    national_id = serializers.CharField(source='profile.national_id', read_only=True, allow_null=True)
    role_label = serializers.CharField(source='get_role_display', read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'first_name', 'last_name', 'full_name', 'email',
            'role', 'role_label', 'national_id', 'is_active', 'must_change_password',
        ]
        read_only_fields = ['must_change_password']

    def validate_role(self, value):
        if self.instance is None and value == User.Roles.PATIENT:
            raise serializers.ValidationError('Los pacientes se registran desde una consulta.')
        if self.instance is not None and value != self.instance.role:
            raise serializers.ValidationError('El rol de una cuenta existente no se puede cambiar.')
        return value

    def validate_is_active(self, value):
        request = self.context['request']
        if self.instance == request.user and not value:
            raise serializers.ValidationError('No puedes desactivar tu propia cuenta.')
        return value


class AdminUserViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AdminUserSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_permissions(self):
        return [permission() for permission in (*api_settings.DEFAULT_PERMISSION_CLASSES, IsAdminRole)]

    def get_queryset(self):
        queryset = User.objects.select_related('profile').order_by('last_name', 'first_name', 'username')
        search = self.request.query_params.get('search', '').strip()
        if search:
            queryset = queryset.filter(
                models.Q(first_name__icontains=search)
                | models.Q(last_name__icontains=search)
                | models.Q(username__icontains=search)
                | models.Q(email__icontains=search)
                | models.Q(profile__national_id__icontains=search)
            )
        return queryset

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        temporary_password = f'Temporal-{secrets.token_urlsafe(9)}!'
        user = User.objects.create_user(
            password=temporary_password,
            must_change_password=True,
            **serializer.validated_data,
        )
        record_audit(request.user, f'Creó la cuenta {user.username}', 'Usuarios')
        return Response(
            {**self.get_serializer(user).data, 'temporary_password': temporary_password},
            status=201,
        )

    def perform_update(self, serializer):
        serializer.save()
        record_audit(self.request.user, f'Modificó la cuenta {serializer.instance.username}', 'Usuarios')

    @action(detail=False)
    def summary(self, request):
        active = User.objects.filter(is_active=True)
        return Response({
            'active_users': active.count(),
            'patients': active.filter(role=User.Roles.PATIENT).count(),
            'doctors': active.filter(role=User.Roles.DOCTOR).count(),
            'admins': active.filter(role=User.Roles.ADMIN).count(),
            'audit_events': AuditEvent.objects.count(),
        })
