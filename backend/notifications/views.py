from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from medical_monitor.reports import active_plan
from users.models import User

from .reminders import pending_for_plan


class RemindersView(APIView):
    """Recordatorios vigentes del paciente, mostrados en su portal."""

    def get(self, request):
        if request.user.role != User.Roles.PATIENT:
            raise PermissionDenied('Los recordatorios son del paciente.')
        plan = active_plan(request.user)
        return Response(pending_for_plan(plan) if plan else [])
