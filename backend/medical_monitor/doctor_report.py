"""Informe de la actividad clínica de un odontólogo: los tratamientos que inició y lo que hizo con ellos."""
from collections import Counter, defaultdict

from django.db.models import Count, Q

from .models import AppointmentRequest, ClinicalProcedure, ControlVisit, Prescription, TreatmentChange, TreatmentPlan

SPECIALTY_LABELS = dict(ClinicalProcedure.Specialty.choices)
MAX_ROWS = 200


def _name(user):
    return (user.get_full_name() or user.username) if user else ''


def treatment_report(doctor, since):
    """Tratamientos iniciados por el odontólogo desde `since` (inclusive), con sus controles, recetas y altas."""
    since_date = since.date()
    plans = list(
        TreatmentPlan.objects
        .filter(doctor=doctor)
        .filter(Q(start_date__gte=since_date) | Q(start_date__isnull=True, created_at__gte=since))
        .select_related('patient', 'clinical_procedure')
        .annotate(
            controls_count=Count('controls', distinct=True),
            high_alerts=Count('reports', filter=Q(reports__risk_level='Alto'), distinct=True),
            reports_count=Count('reports', distinct=True),
        )
        .order_by('-start_date', '-created_at')
    )
    plan_ids = {plan.pk for plan in plans}
    # Una sola consulta: las recetas de sus tratamientos y las que emitió en el periodo.
    medications = defaultdict(list)
    prescribed = Counter()
    for plan_id, name, created_at in (
        Prescription.objects.filter(doctor=doctor).filter(Q(treatment_plan_id__in=plan_ids) | Q(created_at__gte=since))
        .exclude(medication_name='').order_by('created_at').values_list('treatment_plan_id', 'medication_name', 'created_at')
    ):
        if plan_id in plan_ids and name not in medications[plan_id]:
            medications[plan_id].append(name)
        if created_at >= since:
            prescribed[name] += 1
    # Una sola consulta: el alta de sus tratamientos y las altas que dio en el periodo.
    discharged_on, discharges_given = {}, 0
    for plan_id, author_id, created_at in (
        TreatmentChange.objects.filter(kind=TreatmentChange.Kind.DISCHARGE)
        .filter(Q(treatment_plan_id__in=plan_ids) | Q(author=doctor, created_at__gte=since))
        .values_list('treatment_plan_id', 'author_id', 'created_at')
    ):
        if plan_id in plan_ids:
            discharged_on[plan_id] = created_at
        if author_id == doctor.pk and created_at >= since:
            discharges_given += 1

    by_procedure = {}
    for plan in plans:
        name = plan.clinical_procedure.name if plan.clinical_procedure else (plan.procedure or plan.title)
        specialty = plan.clinical_procedure.specialty if plan.clinical_procedure else ''
        row = by_procedure.setdefault(name, {
            'procedure': name, 'specialty': SPECIALTY_LABELS.get(specialty, 'Sin protocolo'),
            'total': 0, 'active': 0, 'discharged': 0, 'patients': set(),
        })
        row['total'] += 1
        row['active' if plan.is_active else 'discharged'] += 1
        row['patients'].add(plan.patient_id)

    appointments = Counter(
        AppointmentRequest.objects.filter(doctor=doctor, starts_at__gte=since).values_list('status', flat=True)
    )

    return {
        'doctor_name': _name(doctor),
        'treatments_started': len(plans),
        'treatments_active': sum(plan.is_active for plan in plans),
        'treatments_discharged': sum(not plan.is_active for plan in plans),
        'patients_treated': len({plan.patient_id for plan in plans}),
        'controls_given': ControlVisit.objects.filter(doctor=doctor, date__gte=since_date).count(),
        'discharges_given': discharges_given,
        'prescriptions_issued': sum(prescribed.values()),
        'appointments_attended': appointments[AppointmentRequest.Status.ATTENDED],
        'appointments_cancelled': appointments[AppointmentRequest.Status.CANCELLED],
        'treatments_with_high_alerts': sum(plan.high_alerts > 0 for plan in plans),
        'reports_received': sum(plan.reports_count for plan in plans),
        'by_procedure': [
            {**{key: value for key, value in row.items() if key != 'patients'}, 'patients': len(row['patients'])}
            for row in sorted(by_procedure.values(), key=lambda item: (-item['total'], item['procedure']))
        ],
        'top_medications': [{'name': name, 'count': count} for name, count in prescribed.most_common(8)],
        'treatments': [
            {
                'id': plan.pk,
                'patient_id': plan.patient_id,
                'patient_name': _name(plan.patient),
                'procedure': plan.clinical_procedure.name if plan.clinical_procedure else (plan.procedure or plan.title),
                'teeth': plan.teeth or [],
                'start_date': plan.start_date,
                'status': 'En curso' if plan.is_active else 'Alta',
                'discharged_at': discharged_on.get(plan.pk),
                'controls': plan.controls_count,
                'medications': medications.get(plan.pk, []),
                'high_alerts': plan.high_alerts,
            }
            for plan in plans[:MAX_ROWS]
        ],
    }
