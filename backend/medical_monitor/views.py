from datetime import date
from django.utils import timezone
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError
from users.models import User, UserProfile, patients_of
from .appointments import mark_attended
from .audit import record_audit
from .models import (
    AppointmentRequest,
    ClinicalEvolutionSummary,
    ClinicalProcedure,
    Medication,
    PatientReport,
    Prescription,
    TreatmentPhase,
    TreatmentPlan,
)
from .serializers import PrescriptionSerializer
from .serializers_clinical import BrandRegistrationSerializer, MedicationSerializer
from .serializers_reports import PatientReportSerializer
from .serializers_treatment import (
    ClinicalEvolutionSummarySerializer,
    TreatmentPlanSerializer,
)
from .ai.explain import answer_question, explanation_for, explanation_payload
from .ai.summaries import generate_summary, summary_payload
from . import medications
from .consultations import (
    INICIO,
    clean_clinical_data,
    clean_medications,
    clean_next_control,
    compose_details,
    control_payload,
    next_control_from,
    register_control,
    text,
    wants_medication,
)
from .dental import validate_teeth
from .reports import active_plan, save_patient_report
from .treatments import (
    MEDICATION_FIELDS, advance_phase, build_history, edit_medications, issue_prescriptions, record_edit, snapshot,
    validate_edit,
)
from .services import (
    analyze_medical_text,
    evaluate_patient_status,
    evaluate_treatment_plan,
    notify_primary_doctor,
)


def is_patient(user):
    return getattr(user, 'role', None) == user.Roles.PATIENT


def require_doctor(user, message='Solo el odontólogo puede modificar indicaciones clínicas.'):
    if user.role != user.Roles.DOCTOR:
        raise PermissionDenied(message)


def create_phases(plan, procedure, start_date):
    """Fases del protocolo: la primera queda en curso desde la fecha de inicio."""
    template = (procedure.default_phases if procedure else None) or [{'name': 'Seguimiento', 'days': 7}]
    phases = TreatmentPhase.objects.bulk_create([
        TreatmentPhase(
            treatment_plan=plan, name=item['name'][:120], description=item.get('description', '')[:240],
            order=index, planned_days=item.get('days', 7),
            start_date=start_date if index == 1 else None,
            status=TreatmentPhase.Status.ACTIVE if index == 1 else TreatmentPhase.Status.PENDING,
        )
        for index, item in enumerate(template, start=1)
    ])
    plan.current_phase = TreatmentPhase.objects.filter(treatment_plan=plan, order=1).first() or phases[0]
    plan.save(update_fields=['current_phase', 'updated_at'])


def assign_primary_doctor(patient, doctor):
    """Solo asigna médico a quien no lo tiene: atender a un paciente no es apropiárselo."""
    UserProfile.objects.filter(user=patient, primary_doctor__isnull=True).update(primary_doctor=doctor)


def include_closed(request):
    """El paciente pide también lo ya cerrado: sus tratamientos y recetas anteriores."""
    return request.query_params.get('include_closed', '').lower() == 'true'


class PrescriptionViewSet(viewsets.ModelViewSet):
    queryset = Prescription.objects.select_related('doctor', 'patient').order_by('-created_at')
    serializer_class = PrescriptionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if is_patient(self.request.user):
            # Las indicaciones del portal son solo las vigentes; su historial (tras el alta incluido)
            # se pide aparte con ?include_closed=true.
            queryset = queryset.filter(patient=self.request.user)
            return queryset if include_closed(self.request) else queryset.filter(is_active=True)
        elif self.request.user.role == self.request.user.Roles.DOCTOR:
            queryset = queryset.filter(doctor=self.request.user)
        is_active = self.request.query_params.get('active')
        if is_active is not None:
            queryset = queryset.filter(is_active=(is_active.lower() == 'true'))
        return queryset

    def perform_create(self, serializer):
        require_doctor(self.request.user)
        details = serializer.validated_data.get('details', '')
        nlp_result = analyze_medical_text(details)

        serializer.save(
            doctor=self.request.user,
            nlp_severity=nlp_result['severity'],
            extracted_entities=nlp_result['entities'],
        )
        assign_primary_doctor(serializer.instance.patient, self.request.user)
        record_audit(self.request.user, f'Registró la prescripción {serializer.instance.pk}', 'Prescripciones')

    def perform_update(self, serializer):
        require_doctor(self.request.user)
        extra = {}
        if 'details' in serializer.validated_data:
            nlp_result = analyze_medical_text(serializer.validated_data['details'])
            extra = {'nlp_severity': nlp_result['severity'], 'extracted_entities': nlp_result['entities']}
        serializer.save(**extra)
        record_audit(self.request.user, f'Modificó la prescripción {serializer.instance.pk}', 'Prescripciones')

    def perform_destroy(self, instance):
        require_doctor(self.request.user)
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
        record_audit(self.request.user, f'Desactivó la prescripción {instance.pk}', 'Prescripciones')


class PatientReportViewSet(viewsets.ModelViewSet):
    serializer_class = PatientReportSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        if self.request.user.role == self.request.user.Roles.DOCTOR:
            patient_id = self.request.query_params.get('patient')
            queryset = PatientReport.objects.select_related('patient').filter(
                patient__in=patients_of(self.request.user),
            )
            if patient_id:
                if not patient_id.isdigit():
                    raise ValidationError({'patient': 'El identificador del paciente no es válido.'})
                queryset = queryset.filter(patient_id=patient_id)
            return queryset.order_by('-created_at')
        if self.request.user.role != self.request.user.Roles.PATIENT:
            return PatientReport.objects.none()
        return PatientReport.objects.select_related('patient').filter(
            patient=self.request.user,
        ).order_by('-created_at')

    def create(self, request, *args, **kwargs):
        # El rol se comprueba antes de validar los datos: otros roles reciben 403, no errores de formulario.
        if not is_patient(request.user):
            raise PermissionDenied('Este espacio está reservado para el seguimiento del paciente.')
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        save_patient_report(serializer, self.request.user)


class TreatmentPlanViewSet(viewsets.ModelViewSet):
    # Todo lo que usa el serializador llega en 2 consultas, sea cual sea el número de tratamientos.
    queryset = TreatmentPlan.objects.select_related(
        'patient', 'clinical_procedure', 'current_phase',
    ).prefetch_related('phases', 'prescriptions')
    serializer_class = TreatmentPlanSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if is_patient(self.request.user):
            queryset = queryset.filter(patient=self.request.user).order_by('-start_date', '-created_at')
            return queryset if include_closed(self.request) else queryset.filter(is_active=True)
        if self.request.user.role == self.request.user.Roles.DOCTOR:
            queryset = queryset.filter(patient__in=patients_of(self.request.user))
            patient_id = self.request.query_params.get('patient')
            if patient_id:
                if not patient_id.isdigit():
                    raise ValidationError({'patient': 'El identificador del paciente no es válido.'})
                queryset = queryset.filter(patient_id=patient_id)
        return queryset

    def perform_create(self, serializer):
        require_doctor(self.request.user, 'Solo el odontólogo puede crear indicaciones.')
        patient = serializer.validated_data['patient']
        profile = UserProfile.objects.filter(user=patient).first()
        has_other_doctor = profile and profile.primary_doctor not in (None, self.request.user)
        if has_other_doctor and not patients_of(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied('Este paciente está asignado a otro odontólogo. Registra una consulta para atenderlo.')
        data = serializer.validated_data
        evaluation = evaluate_treatment_plan(
            data.get('title', ''),
            data.get('procedure', ''),
            data.get('instructions', ''),
            data.get('side_effects', ''),
        )
        serializer.save(
            doctor=self.request.user,
            treatment_severity=evaluation['severity'],
            care_recommendations=evaluation['recommendations'],
        )
        assign_primary_doctor(patient, self.request.user)
        record_audit(self.request.user, f'Creó el plan de tratamiento {serializer.instance.pk}', 'Tratamientos')

    @transaction.atomic
    def perform_update(self, serializer):
        require_doctor(self.request.user, 'Solo el odontólogo puede actualizar indicaciones.')
        plan = serializer.instance
        data = serializer.validated_data
        validate_edit(plan, data)
        # La receta completa (uno o más medicamentos) viaja como lista; vacía, quita la medicación.
        raw = self.request.data.get('medications') if isinstance(self.request.data, dict) else None
        medication_items = None
        if raw is not None:
            if raw == []:
                medication_items = []
            else:
                medication_items, errors = clean_medications({'medications': raw})
                if errors:
                    raise ValidationError(errors)
            if any(field in data for field in MEDICATION_FIELDS):
                raise ValidationError({'medications': 'Envía la medicación solo como lista.'})
        before = snapshot(plan)
        extra = {}
        # En los tratamientos de una consulta el título es el medicamento y el horario, la frecuencia.
        if 'medication_name' in data and plan.title == plan.medication_name:
            extra['title'] = data['medication_name'].strip()
        if 'frequency' in data and plan.schedule_description == plan.frequency:
            extra['schedule_description'] = data['frequency']
        evaluation = evaluate_treatment_plan(
            extra.get('title', data.get('title', plan.title)),
            data.get('procedure', plan.procedure),
            data.get('instructions', plan.instructions),
            data.get('side_effects', plan.side_effects),
        )
        serializer.save(
            **extra,
            treatment_severity=evaluation['severity'],
            care_recommendations=evaluation['recommendations'],
        )
        changes = record_edit(serializer.instance, before, self.request.user)
        if medication_items is not None:
            summary = edit_medications(serializer.instance, self.request.user, medication_items)
            if summary:
                changes = [*changes, summary]
        if changes:
            record_audit(self.request.user, f'Modificó el tratamiento {plan.pk}: {"; ".join(changes)}'[:240], 'Tratamientos')

    @action(detail=True, methods=['get', 'post'])
    def summary(self, request, pk=None):
        """GET: último resumen clínico. POST: genera uno nuevo con la IA (o el resumen local)."""
        require_doctor(request.user, 'Solo el odontólogo puede consultar el resumen clínico.')
        plan = self.get_object()
        if request.method == 'POST':
            summary = generate_summary(plan)
            record_audit(request.user, f'Generó el resumen clínico del tratamiento {plan.pk} ({summary.source})', 'IA')
            return Response(summary_payload(summary), status=status.HTTP_201_CREATED)
        return Response(summary_payload(plan.summaries.first()))

    @action(detail=True)
    def explanation(self, request, pk=None):
        """Indicaciones del tratamiento explicadas en lenguaje sencillo."""
        plan = self.get_object()
        return Response(explanation_payload(explanation_for(plan)))

    @action(detail=True, methods=['post'])
    def ask(self, request, pk=None):
        """Pregunta del paciente sobre sus indicaciones, respondida solo con ese texto."""
        if not is_patient(request.user):
            raise PermissionDenied('Las preguntas sobre las indicaciones son del paciente.')
        plan = self.get_object()
        question = str(request.data.get('question', '')).strip() if isinstance(request.data, dict) else ''
        if not 3 <= len(question) <= 300:
            raise ValidationError({'question': 'Escribe tu pregunta (entre 3 y 300 caracteres).'})
        return Response(answer_question(plan, question))

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def controls(self, request, pk=None):
        """Registra un control realizado y fija cuándo debe volver el paciente."""
        require_doctor(request.user, 'Solo el odontólogo puede registrar un control.')
        plan = self.get_object()
        visit = register_control(plan, request.user, request.data)
        record_audit(request.user, f'Registró un control del tratamiento {plan.pk}', 'Tratamientos')
        return Response({
            'control': control_payload(visit),
            'treatment': self.get_serializer(self.get_queryset().get(pk=plan.pk)).data,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='advance-phase')
    @transaction.atomic
    def advance_phase(self, request, pk=None):
        """Cierra la fase en curso y comienza la siguiente."""
        require_doctor(request.user, 'Solo el odontólogo puede avanzar de fase.')
        plan = self.get_object()
        try:
            upcoming = advance_phase(plan, request.user)
        except ValidationError as error:
            # Respuesta histórica de este endpoint: el motivo va en «detail».
            detail = error.detail
            raise ValidationError({'detail': detail.get('advance_phase', detail.get('detail'))}) from error
        record_audit(request.user, f'Avanzó el tratamiento {plan.pk} a la fase «{upcoming.name}»', 'Tratamientos')
        # Se vuelve a leer: las fases cargadas al principio ya no reflejan el cambio.
        return Response(self.get_serializer(self.get_queryset().get(pk=plan.pk)).data)

    def get_throttles(self):
        # Solo las acciones que pueden llamar al modelo de lenguaje tienen límite de uso.
        calls_ai = self.action == 'explanation' or (self.action in ('summary', 'ask') and self.request.method == 'POST')
        if calls_ai:
            self.throttle_scope = 'ai'
            return [ScopedRateThrottle()]
        return super().get_throttles()

    @action(detail=True)
    def history(self, request, pk=None):
        """Línea de tiempo del tratamiento: recetas, cambios y reportes del paciente."""
        require_doctor(request.user, 'Solo el odontólogo puede consultar el historial del tratamiento.')
        plan = self.get_object()
        patient = plan.patient
        profile = getattr(patient, 'profile', None)
        return Response({
            'plan': self.get_serializer(plan).data,
            'patient': {
                'id': patient.id,
                'full_name': patient.get_full_name() or patient.username,
                'national_id': getattr(profile, 'national_id', None),
            },
            'events': build_history(plan),
        })

    def perform_destroy(self, instance):
        require_doctor(self.request.user, 'Solo el odontólogo puede retirar indicaciones.')
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
        record_audit(self.request.user, f'Desactivó el plan de tratamiento {instance.pk}', 'Tratamientos')


class ClinicalEvolutionSummaryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ClinicalEvolutionSummarySerializer

    def get_queryset(self):
        queryset = ClinicalEvolutionSummary.objects.filter(
            patient=self.request.user,
        )
        if self.request.user.role == self.request.user.Roles.ADMIN:
            queryset = ClinicalEvolutionSummary.objects.all()
        # Lo más reciente primero: la primera página siempre contiene los últimos días.
        return queryset.order_by('-created_at', '-id')


def require_clinical_staff(user):
    if user.role not in (user.Roles.DOCTOR, user.Roles.ADMIN):
        raise PermissionDenied('Solo el equipo autorizado puede consultar el vademécum.')


class MedicationSearchView(APIView):
    """Receta rápida: vademécum de la clínica, CIMA y RxNav, con presentaciones y pauta habitual."""

    def get(self, request):
        require_clinical_staff(request.user)
        return Response(medications.search(request.query_params.get('q', '')))


class MedicationSheetView(APIView):
    """Ficha del fármaco (para qué sirve, cómo actúa, efectos): del vademécum o del prospecto de CIMA."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'ai'

    def get(self, request):
        require_clinical_staff(request.user)
        name = ' '.join(str(request.query_params.get('name', '')).split())
        if not 3 <= len(name) <= 120:
            raise ValidationError({'name': 'Indica el nombre del medicamento.'})
        sheet = medications.sheet_for(name)
        if sheet is None:
            return Response({'detail': 'No hay una ficha oficial para este medicamento.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(sheet)


class MedicationViewSet(viewsets.ModelViewSet):
    """Vademécum de la clínica: el odontólogo añade marcas locales; el administrador lo revisa y edita."""

    serializer_class = MedicationSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        require_clinical_staff(self.request.user)
        queryset = Medication.objects.all()
        if self.request.user.role != self.request.user.Roles.ADMIN:
            queryset = queryset.filter(is_active=True)
        return queryset

    def create(self, request, *args, **kwargs):
        require_clinical_staff(request.user)
        serializer = BrandRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        medication, created = medications.register_brand(**serializer.validated_data)
        record_audit(request.user, f'Añadió «{serializer.validated_data["brand"]}» al vademécum ({medication.generic_name})', 'Catálogo')
        return Response(MedicationSerializer(medication).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def partial_update(self, request, *args, **kwargs):
        if request.user.role != request.user.Roles.ADMIN:
            raise PermissionDenied('Solo el administrador edita el vademécum.')
        response = super().partial_update(request, *args, **kwargs)
        record_audit(request.user, f'Editó el medicamento {kwargs.get("pk")} del vademécum', 'Catálogo')
        return response


class ConsultationCreateView(APIView):
    """Inicio de un tratamiento: motivo, intervención, datos propios del protocolo y, si hace falta, receta."""

    @transaction.atomic
    def post(self, request):
        if request.user.role != request.user.Roles.DOCTOR:
            raise PermissionDenied('Solo el odontólogo puede registrar una consulta.')
        data = request.data
        if not isinstance(data, dict):
            return Response({'detail': 'El cuerpo debe ser un objeto JSON.'}, status=status.HTTP_400_BAD_REQUEST)

        errors = {}
        patient_id = data.get('patient')
        if not patient_id:
            errors['patient'] = 'Selecciona un paciente.'
        procedure = text(data, 'procedure')
        clinical_procedure = None
        procedure_id = data.get('clinical_procedure')
        if procedure_id not in (None, ''):
            clinical_procedure = ClinicalProcedure.objects.filter(
                pk=procedure_id if str(procedure_id).isdigit() else None, is_active=True,
            ).first()
            if clinical_procedure:
                procedure = procedure or clinical_procedure.name
        # La receta es opcional: depende del tratamiento y de lo que decida el odontólogo.
        medication_items = []
        if wants_medication(data, default=True):
            medication_items, medication_errors = clean_medications(data)
            errors.update(medication_errors)
        # El primero es el medicamento principal del plan (título y pauta); cada uno tiene su receta.
        medication = medication_items[0] if medication_items else None
        if procedure_id not in (None, '') and clinical_procedure is None:
            errors['clinical_procedure'] = 'Selecciona un tratamiento del catálogo.'
        elif len(procedure) < 3 or len(procedure) > 160:
            errors['procedure'] = 'Indica el procedimiento realizado.'
        admission_reason = text(data, 'admission_reason')
        if len(admission_reason) < 5 or len(admission_reason) > 240:
            errors['admission_reason'] = 'Describe el motivo de consulta.'
        instructions = text(data, 'instructions')
        details = text(data, 'details') or instructions
        if len(details) < 10:
            errors['details'] = 'Escribe indicaciones claras para el paciente.'
        diet_instructions = text(data, 'diet_instructions')
        if len(diet_instructions) > 1000:
            errors['diet_instructions'] = 'La dieta no puede superar 1000 caracteres.'
        side_effects = text(data, 'side_effects')
        if len(side_effects) > 500:
            errors['side_effects'] = 'Los efectos observables no pueden superar 500 caracteres.'
        clinical_notes = text(data, 'clinical_notes')
        if len(clinical_notes) > 1000:
            errors['clinical_notes'] = 'Las notas clínicas no pueden superar 1000 caracteres.'
        date_field = 'surgery_date' if 'surgery_date' in data else 'start_date'
        start_date_value = data.get(date_field)
        start_date = timezone.localdate()
        if start_date_value:
            try:
                start_date = date.fromisoformat(str(start_date_value))
            except ValueError:
                errors[date_field] = 'Usa una fecha de intervención válida.'
            else:
                if start_date > timezone.localdate():
                    errors[date_field] = 'La fecha de la intervención no puede estar en el futuro.'
        teeth = []
        try:
            teeth = validate_teeth(data.get('teeth'))
        except DRFValidationError as error:
            errors['teeth'] = error.detail[0]
        clinical_data, field_errors = clean_clinical_data(clinical_procedure, data.get('clinical_data'), INICIO)
        if field_errors:
            errors['clinical_data'] = field_errors
        control_days = clean_next_control(data, clinical_procedure, errors)
        patient = None
        if patient_id and not errors:
            patient = User.objects.filter(
                pk=patient_id if str(patient_id).isdigit() else None, role=User.Roles.PATIENT,
            ).first()
            if patient is None:
                errors['patient'] = 'La indicación debe estar vinculada a un paciente.'
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        # Tras el alta, si el paciente reservó con otro odontólogo, quien inicia el tratamiento nuevo pasa a ser
        # su tratante (recibe sus alertas). Atenderlo sin esa cita no es apropiárselo.
        takes_over = (
            not TreatmentPlan.objects.filter(patient=patient, is_active=True).exists()
            and AppointmentRequest.objects.filter(
                patient=patient, doctor=request.user,
                status__in=(AppointmentRequest.Status.BOOKED, AppointmentRequest.Status.ATTENDED),
            ).exists()
        )
        title = medication['medication_name'] if medication else procedure
        evaluation = evaluate_treatment_plan(title, procedure, details, side_effects)
        treatment = TreatmentPlan.objects.create(
            patient=patient,
            doctor=request.user,
            title=title[:160],
            treatment_type=(
                TreatmentPlan.TreatmentType.MEDICATION if medication else TreatmentPlan.TreatmentType.THERAPY
            ),
            schedule_description=(medication or {}).get('frequency') or 'Según indicación profesional',
            # El plan guarda el texto del odontólogo tal cual; la receta conserva la composición completa.
            instructions=instructions or details,
            diet_instructions=diet_instructions,
            side_effects=side_effects,
            procedure=procedure,
            clinical_procedure=clinical_procedure,
            start_date=start_date,
            admission_reason=admission_reason,
            clinical_notes=clinical_notes,
            **{field: (medication or {}).get(field, '') for field in MEDICATION_FIELDS},
            treatment_severity=evaluation['severity'],
            care_recommendations=evaluation['recommendations'],
            teeth=teeth,
            last_intervention_date=start_date,
            clinical_data=clinical_data,
            next_control_date=next_control_from(start_date, control_days),
        )
        prescriptions = issue_prescriptions(
            treatment, request.user, medication_items, instructions,
            details=text(data, 'details') or (compose_details(medication, instructions) if medication else None),
        )
        create_phases(treatment, clinical_procedure, start_date)
        for item in medication_items:
            medications.prepare_sheet_later(item['active_ingredient'])
        if takes_over:
            UserProfile.objects.filter(user=patient).update(primary_doctor=request.user)
        assign_primary_doctor(patient, request.user)
        # La consulta cumple la cita (de valoración o de seguimiento) que el paciente reservó ese día.
        mark_attended(patient, start_date)
        record_audit(request.user, f'Registró consulta para {patient.username}', 'Consultas')

        return Response({
            'prescription': PrescriptionSerializer(prescriptions[0]).data if prescriptions else None,
            'prescriptions': PrescriptionSerializer(prescriptions, many=True).data,
            'treatment': TreatmentPlanSerializer(treatment).data,
        }, status=status.HTTP_201_CREATED)
