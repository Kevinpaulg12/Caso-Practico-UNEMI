from django.contrib.auth.models import AbstractUser
from django.utils import timezone
from django.db import models

# Versión vigente de los Términos y Condiciones y del aviso de uso de datos que acepta el paciente.
# 2026-11-ia: añade el tratamiento de datos anonimizados por un proveedor de IA.
# 2026-11-gemini: el proveedor de IA pasa a ser Google (Gemini).
# 2026-11-edad: la IA recibe la edad en años (antes, un rango de edad).
TERMS_VERSION = '2026-11-edad'


def title_case_name(value):
    """'KEVIN davila' -> 'Kevin Davila'; respeta tildes, guiones y apóstrofos (O'Brien-Smith)."""
    return ' '.join((value or '').split()).title()


class User(AbstractUser):
    # Aquí puedes usar opciones (Choices) para definir si es Doctor, Paciente o Admin
    class Roles(models.TextChoices):
        DOCTOR = 'DOC', 'Doctor'
        PATIENT = 'PAT', 'Patient'
        ADMIN = 'ADM', 'Admin'

    role = models.CharField(max_length=3, choices=Roles.choices, default=Roles.PATIENT)
    must_change_password = models.BooleanField(default=False)
    # El paciente registrado por la clínica acepta los términos en su primer acceso, antes que nada más.
    must_accept_terms = models.BooleanField(default=False)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, blank=True)
    # Última petición hecha por el usuario (no cuenta el refresco automático de pantallas).
    last_activity = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        # Los nombres se guardan siempre en formato título, sin importar cómo se escribieron.
        self.first_name = title_case_name(self.first_name)
        self.last_name = title_case_name(self.last_name)
        super().save(*args, **kwargs)

    @property
    def age(self):
        profile = getattr(self, 'profile', None)
        if not profile or not profile.birth_date:
            return None
        today = timezone.localdate()
        return today.year - profile.birth_date.year - (
            (today.month, today.day) < (profile.birth_date.month, profile.birth_date.day)
        )

    @property
    def professional_title(self):
        return {
            self.Roles.DOCTOR: 'Doctor',
            self.Roles.ADMIN: 'Administrador',
        }.get(self.role, 'Paciente')

    def __str__(self):
        return f"{self.username} - {self.get_role_display()}"


def patients_of(doctor):
    """Pacientes que un odontólogo tiene asignados o a quienes ha recetado."""
    return User.objects.filter(
        models.Q(profile__primary_doctor=doctor) | models.Q(prescriptions_received__doctor=doctor),
        role=User.Roles.PATIENT,
    ).distinct()


class UserProfile(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='profile',
    )
    primary_doctor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_patient_profiles',
    )
    birth_date = models.DateField(null=True, blank=True)
    national_id = models.CharField(max_length=20, unique=True, null=True, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    emergency_contact = models.CharField(max_length=30, blank=True)

    def __str__(self):
        return f'Perfil de {self.user.username}'