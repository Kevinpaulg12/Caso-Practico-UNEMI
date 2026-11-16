from django.db import models
from django.conf import settings

class TimeStampedModel(models.Model):
    """
    Clase abstracta base que proporciona campos de auditoría automáticos.
    Todas las tablas de tu tesis deben heredar de aquí, no de models.Model.
    """
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

# Ejemplo de tu primera entidad de negocio real:
class Prescription(TimeStampedModel):
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.CASCADE, 
        related_name='prescriptions_given' # <-- CRÍTICO: Siempre usa related_name
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.CASCADE, 
        related_name='prescriptions_received'
    )
    details = models.TextField()
    medication_name = models.CharField(max_length=120, blank=True)
    active_ingredient = models.CharField(max_length=120, blank=True)
    strength = models.CharField(max_length=40, blank=True)
    dosage_form = models.CharField(max_length=60, blank=True)
    frequency = models.CharField(max_length=120, blank=True)
    duration = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True) # Soft-delete en lugar de borrar registros médicos
    nlp_severity = models.CharField(max_length=20, default='Baja')
    extracted_entities = models.JSONField(default=list, blank=True)
    # Tratamiento al que pertenece: cambiar la medicación crea una receta nueva y conserva la anterior.
    treatment_plan = models.ForeignKey(
        'TreatmentPlan',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='prescriptions',
    )

    class Meta:
        indexes = [
            # Indicaciones vigentes del paciente y listado del odontólogo por fecha.
            models.Index(fields=['patient', 'is_active'], name='presc_patient_active_idx'),
            models.Index(fields=['doctor', '-created_at'], name='presc_doctor_recent_idx'),
        ]

    def __str__(self):
        return f"Prescription {self.id} for {self.patient.username} - Severidad: {self.nlp_severity}"


class MedicationGuide(models.Model):
    class Source(models.TextChoices):
        MANUAL = 'manual', 'Equipo clínico'
        CIMA = 'cima', 'Prospecto oficial (CIMA)'

    name = models.CharField(max_length=120, unique=True)
    search_terms = models.JSONField(default=list)
    common_effects = models.TextField()
    what_to_do = models.TextField()
    warning_signs = models.TextField()
    source_note = models.CharField(max_length=240, default='Información general revisada por el equipo clínico.')
    # Las guías escritas por la clínica («manual») tienen prioridad y nunca se sobrescriben.
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    # Número de registro del medicamento en CIMA del que se tomó el prospecto.
    source_ref = models.CharField(max_length=40, blank=True)
    active_ingredient = models.CharField(max_length=120, blank=True, db_index=True)
    # Para qué sirve y cómo actúa, en lenguaje para el paciente.
    indications = models.TextField(blank=True)
    mechanism = models.TextField(blank=True)

    def __str__(self):
        return self.name


class PatientReport(TimeStampedModel):
    class Comparison(models.TextChoices):
        LOWER = 'lower', 'Menor'
        SAME = 'same', 'Igual'
        HIGHER = 'higher', 'Mayor'

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='postoperative_reports',
    )
    pain_level = models.PositiveSmallIntegerField()
    comparison = models.CharField(max_length=10, choices=Comparison.choices)
    message = models.TextField(blank=True)
    nlp_severity = models.CharField(max_length=20, default='Baja')
    extracted_entities = models.JSONField(default=list, blank=True)
    doctor_notified = models.BooleanField(default=False)
    risk_level = models.CharField(max_length=20, default='Bajo')
    recommendation = models.TextField(blank=True)
    evolution_status = models.CharField(max_length=40, default='En seguimiento')
    alert_reasons = models.JSONField(default=list, blank=True)
    # Día postoperatorio al reportar (0 = día de la cirugía); nulo si no había tratamiento.
    postoperative_day = models.PositiveIntegerField(null=True, blank=True)
    # Tratamiento vigente cuando el paciente envió el reporte.
    treatment_plan = models.ForeignKey(
        'TreatmentPlan',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reports',
    )

    class Meta:
        indexes = [
            # Historial del paciente (lo más reciente primero) y reportes de un tratamiento.
            models.Index(fields=['patient', '-created_at'], name='report_patient_recent_idx'),
            models.Index(fields=['treatment_plan', '-created_at'], name='report_plan_recent_idx'),
        ]

    @property
    def alert_color(self):
        return {'Bajo': 'verde', 'Medio': 'amarillo', 'Alto': 'rojo'}.get(self.risk_level, 'verde')

    def __str__(self):
        return f'Report {self.id} for {self.patient.username} - EVA {self.pain_level}'


class TreatmentPlan(TimeStampedModel):
    class TreatmentType(models.TextChoices):
        MEDICATION = 'medication', 'Medicamento'
        THERAPY = 'therapy', 'Terapia'
        DIET = 'diet', 'Alimentación'

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='treatment_plans',
    )
    title = models.CharField(max_length=160)
    treatment_type = models.CharField(max_length=20, choices=TreatmentType.choices)
    schedule_description = models.CharField(max_length=200)
    next_due_time = models.TimeField(null=True, blank=True)
    instructions = models.TextField()
    side_effects = models.TextField(blank=True)
    day_number = models.PositiveIntegerField(default=1)
    procedure = models.CharField(max_length=160, blank=True)
    clinical_procedure = models.ForeignKey(
        'ClinicalProcedure',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='treatment_plans',
    )
    # Fecha de la cirugía: inicia la línea de tiempo de recuperación.
    start_date = models.DateField(null=True, blank=True)
    treatment_severity = models.CharField(max_length=20, default='Baja')
    care_recommendations = models.TextField(blank=True)
    admission_reason = models.CharField(max_length=240, blank=True)
    clinical_notes = models.TextField(blank=True)
    medication_name = models.CharField(max_length=120, blank=True)
    strength = models.CharField(max_length=40, blank=True)
    dosage_form = models.CharField(max_length=60, blank=True)
    frequency = models.CharField(max_length=120, blank=True)
    duration = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    # Piezas tratadas en notación FDI (11–48 permanentes, 51–85 temporales).
    teeth = models.JSONField(default=list, blank=True)
    # Última intervención o control: reinicia el conteo de días de seguimiento.
    last_intervention_date = models.DateField(null=True, blank=True)
    current_phase = models.ForeignKey(
        'TreatmentPhase',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    # Datos propios del tipo de tratamiento, según los campos de su protocolo: {"anestesia": "Troncular"}.
    clinical_data = models.JSONField(default=dict, blank=True)
    # Cuándo debe volver el paciente; nulo si no tiene un control pendiente.
    next_control_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['day_number', 'next_due_time', 'title']
        indexes = [
            # Tratamiento vigente de un paciente: la consulta más repetida del sistema.
            models.Index(fields=['patient', 'is_active'], name='plan_patient_active_idx'),
        ]

    @property
    def surgery_date(self):
        """Fecha de inicio del tratamiento (la cirugía o la primera intervención)."""
        from django.utils import timezone
        return self.start_date or timezone.localtime(self.created_at).date()

    @property
    def postoperative_day(self):
        """Día de seguimiento: días desde la última intervención (0 = el día de la intervención)."""
        from django.utils import timezone
        reference = max(filter(None, (self.surgery_date, self.last_intervention_date)))
        return max(0, (timezone.localdate() - reference).days)

    @property
    def specialty(self):
        return self.clinical_procedure.specialty if self.clinical_procedure_id else ClinicalProcedure.Specialty.SURGERY

    @property
    def current_day(self):
        if not self.start_date:
            return self.day_number
        from django.utils import timezone
        return max(1, (timezone.localdate() - self.start_date).days + 1)

    def __str__(self):
        return f'{self.title} - {self.patient.username}'


class TreatmentChange(models.Model):
    """Modificación de un tratamiento en curso: alimenta la línea de tiempo del historial."""

    class Kind(models.TextChoices):
        EDIT = 'edit', 'Modificación'
        DISCHARGE = 'discharge', 'Alta médica'

    treatment_plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name='changes')
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.EDIT)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    summary = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'Cambio {self.pk} del tratamiento {self.treatment_plan_id}'


class AlertSettings(models.Model):
    """Umbrales de triaje de la clínica: una sola fila editable por el administrador."""
    high_pain = models.PositiveSmallIntegerField(default=7)
    rising_pain = models.PositiveSmallIntegerField(default=6)
    medium_pain = models.PositiveSmallIntegerField(default=5)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )

    @classmethod
    def load(cls):
        # Se consulta en cada reporte del paciente: se guarda en caché y se descarta al editarla.
        from .caching import ALERT_SETTINGS, cached
        return cached(ALERT_SETTINGS, lambda: cls.objects.get_or_create(pk=1)[0])

    def __str__(self):
        return f'EVA alto >= {self.high_pain}'


class AuditEvent(models.Model):
    """Bitácora de solo adición: la API no ofrece edición y el modelo la rechaza."""
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    actor_label = models.CharField(max_length=150)
    action = models.CharField(max_length=200)
    module = models.CharField(max_length=40)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError('Los eventos de auditoría no se pueden modificar.')
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.actor_label}: {self.action}'


class ClinicalProcedure(models.Model):
    """Protocolo de seguimiento de un tipo de tratamiento odontológico.

    Define qué es esperable (curva de dolor, síntomas por ventana de días), qué es alarma, qué
    cuidados diarios debe cumplir el paciente, qué preguntas guía el asistente y en qué fases
    se divide. Lo edita el administrador; las reglas de triaje lo leen.
    """

    class Complexity(models.TextChoices):
        LOW = 'low', 'Leve'
        MEDIUM = 'medium', 'Moderada'
        HIGH = 'high', 'Compleja'

    class Specialty(models.TextChoices):
        SURGERY = 'cirugia', 'Cirugía oral'
        ENDODONTICS = 'endodoncia', 'Endodoncia'
        ORTHODONTICS = 'ortodoncia', 'Ortodoncia'
        PERIODONTICS = 'periodoncia', 'Periodoncia'
        IMPLANTS = 'implantologia', 'Implantología'
        PROSTHODONTICS = 'protesis', 'Prótesis'
        RESTORATIVE = 'operatoria', 'Operatoria dental'
        AESTHETIC = 'estetica', 'Estética dental'
        PEDIATRIC = 'odontopediatria', 'Odontopediatría'

    class FollowUpUnit(models.TextChoices):
        DAYS = 'days', 'Días'
        WEEKS = 'weeks', 'Semanas'

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=160)
    specialty = models.CharField(max_length=20, choices=Specialty.choices, default=Specialty.SURGERY)
    complexity = models.CharField(max_length=10, choices=Complexity.choices, default=Complexity.MEDIUM)
    monitoring_days = models.PositiveSmallIntegerField(default=5)
    follow_up_unit = models.CharField(max_length=10, choices=FollowUpUnit.choices, default=FollowUpUnit.DAYS)
    # Cada cuántos días se espera un autorreporte (el recordatorio se envía si falta).
    checkin_every_days = models.PositiveSmallIntegerField(default=1)
    expected_curve = models.JSONField(default=list, blank=True)
    # {"Sangrado": 2} -> el sangrado es esperable hasta el día 2 inclusive.
    expected_symptoms = models.JSONField(default=dict, blank=True)
    # Síntomas que en este tratamiento son siempre de riesgo alto.
    alarm_symptoms = models.JSONField(default=list, blank=True)
    # Cuidados diarios por defecto: ["Enjuague con clorhexidina", "Cepillado suave"].
    care_items = models.JSONField(default=list, blank=True)
    # {"Dolor": ["¿El dolor aparece al morder o sin motivo?"], "*": ["¿Cómo te sientes hoy?"]}
    follow_up_questions = models.JSONField(default=dict, blank=True)
    # [{"name": "Alineación", "days": 120, "description": "..."}]
    default_phases = models.JSONField(default=list, blank=True)
    # Cada cuántos días debe volver el paciente a control (0 = sin controles periódicos).
    control_every_days = models.PositiveSmallIntegerField(default=0)
    # Campos propios del tratamiento en la consulta y en cada control:
    # [{"key": "anestesia", "label": "Anestesia", "type": "select", "options": [...], "required": true, "en": ["inicio"]}]
    consultation_fields = models.JSONField(default=list, blank=True)
    # Si este tratamiento suele llevar receta (el odontólogo decide en cada consulta).
    medication_default = models.BooleanField(default=True)
    # Si se registran piezas dentales concretas (no aplica, p. ej., a un blanqueamiento).
    uses_teeth = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f'{self.code} - {self.name}'


class ClinicalEvolutionSummary(TimeStampedModel):
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='clinical_evolution',
    )
    day_label = models.CharField(max_length=50)
    eva_recorded = models.PositiveSmallIntegerField()
    status_tag = models.CharField(max_length=50)
    clinical_notes = models.TextField(blank=True)

    class Meta:
        # Hay un registro por día de calendario (lo garantiza la vista). La etiqueta "Día N" se
        # repite entre procedimientos distintos, así que no puede ser única.
        ordering = ['created_at']

    def __str__(self):
        return f'{self.day_label} - {self.patient.username}'


class TreatmentPhase(models.Model):
    """Etapa de un tratamiento largo (p. ej. «Alineación» en ortodoncia, «Osteointegración» en implantes)."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pendiente'
        ACTIVE = 'active', 'En curso'
        DONE = 'done', 'Completada'

    treatment_plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name='phases')
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=240, blank=True)
    order = models.PositiveSmallIntegerField(default=1)
    planned_days = models.PositiveSmallIntegerField(default=7)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)

    class Meta:
        ordering = ['treatment_plan_id', 'order', 'id']

    def __str__(self):
        return f'{self.order}. {self.name}'


class ControlVisit(TimeStampedModel):
    """Control o sesión realizada de un tratamiento: reinicia el seguimiento y fija el próximo control."""

    treatment_plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name='controls')
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='controls_given',
    )
    date = models.DateField()
    notes = models.CharField(max_length=1000, blank=True)
    # Datos del control según los campos del protocolo.
    clinical_data = models.JSONField(default=dict, blank=True)
    # En cuántos días debe volver (0 = no requiere más controles).
    next_control_in_days = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['date', 'id']
        indexes = [models.Index(fields=['treatment_plan', 'date'], name='control_plan_date_idx')]

    def __str__(self):
        return f'Control {self.date:%Y-%m-%d} del tratamiento {self.treatment_plan_id}'


class CareCheckin(TimeStampedModel):
    """Checklist diario de cuidados: qué cumplió el paciente ese día (mide la adherencia)."""

    treatment_plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name='checkins')
    date = models.DateField()
    # {"Enjuague con clorhexidina": true, "Cepillado suave": false}
    items = models.JSONField(default=dict)

    class Meta:
        ordering = ['-date']
        constraints = [models.UniqueConstraint(fields=['treatment_plan', 'date'], name='unique_checkin_per_day')]

    @property
    def adherence(self):
        if not self.items:
            return 0
        return round(100 * sum(bool(value) for value in self.items.values()) / len(self.items))


class Reminder(models.Model):
    """Aviso por correo ya enviado; evita repetir el mismo recordatorio."""

    class Kind(models.TextChoices):
        CONTROL = 'control', 'Control próximo'
        REPORT = 'report', 'Reporte pendiente'
        CARE = 'care', 'Cuidados del día'

    kind = models.CharField(max_length=20, choices=Kind.choices)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reminders')
    # Identifica lo recordado, p. ej. "control:5:2026-11-20:soon" o "report:5:2026-11-13".
    key = models.CharField(max_length=80)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['kind', 'key'], name='unique_reminder')]


class AssistantConversation(TimeStampedModel):
    """Conversación del paciente con el asistente; se cierra al generar el autorreporte."""

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='assistant_conversations',
    )
    treatment_plan = models.ForeignKey(
        TreatmentPlan, on_delete=models.SET_NULL, null=True, blank=True, related_name='conversations',
    )
    # Lo reunido hasta ahora: síntomas, EVA, comparación, duración y cuidados mencionados.
    collected = models.JSONField(default=dict, blank=True)
    report = models.OneToOneField(
        PatientReport, on_delete=models.SET_NULL, null=True, blank=True, related_name='conversation',
    )
    is_open = models.BooleanField(default=True)


class AssistantMessage(models.Model):
    class Role(models.TextChoices):
        PATIENT = 'patient', 'Paciente'
        ASSISTANT = 'assistant', 'Asistente'

    conversation = models.ForeignKey(AssistantConversation, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=10, choices=Role.choices)
    text = models.TextField()
    # Lo extraído de este mensaje por el PLN local y, si se usó, por el LLM.
    extracted = models.JSONField(default=dict, blank=True)
    source = models.CharField(max_length=20, default='local')  # local | llm
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']


class ClinicalSummary(models.Model):
    """Resumen de la evolución redactado para el odontólogo (por la IA o, si falla, por el sistema)."""

    treatment_plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name='summaries')
    content = models.JSONField(default=dict)
    source = models.CharField(max_length=20, default='local')
    model = models.CharField(max_length=60, blank=True)
    report_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']


class PlainExplanation(models.Model):
    """Indicaciones explicadas en lenguaje sencillo; se regeneran si el odontólogo cambia el texto."""

    treatment_plan = models.OneToOneField(TreatmentPlan, on_delete=models.CASCADE, related_name='plain_explanation')
    source_hash = models.CharField(max_length=64)
    content = models.JSONField(default=dict)
    source = models.CharField(max_length=20, default='local')
    model = models.CharField(max_length=60, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class AIInteraction(models.Model):
    """Bitácora de cada uso de la IA: latencia, tokens y alternativa local (evidencia para la tesis)."""

    class Feature(models.TextChoices):
        ASSISTANT = 'assistant', 'Asistente conversacional'
        SUMMARY = 'summary', 'Resumen clínico'
        EXPLANATION = 'explanation', 'Explicación de indicaciones'
        QUESTION = 'question', 'Pregunta sobre indicaciones'
        EXTRACTION = 'extraction', 'Extracción (evaluación)'
        MEDICATION = 'medication', 'Ficha de medicamento'

    feature = models.CharField(max_length=20, choices=Feature.choices)
    model = models.CharField(max_length=60, blank=True)
    latency_ms = models.PositiveIntegerField(default=0)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cache_read_tokens = models.PositiveIntegerField(default=0)
    fallback_used = models.BooleanField(default=False)
    error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            # Métricas de IA por función y periodo.
            models.Index(fields=['feature', '-created_at'], name='ai_feature_recent_idx'),
        ]
