"""Historia clínica longitudinal del paciente, compartida entre los odontólogos de la clínica.

Reúne, en orden cronológico, todos los tratamientos del paciente (los haya atendido quien sea), con
sus procedimientos, controles, recetas, lo que el paciente contó en su seguimiento y las síntesis de
la IA. Sirve para dar continuidad y no repetir esquemas que ya fallaron. Cada consulta queda auditada.
"""
from collections import Counter

from .models import TreatmentPlan
from .serializers_treatment import TreatmentPlanSerializer
from .treatments import build_history


def _name(user):
    return (user.get_full_name() or user.username) if user else None


def attending_dentists(plan):
    """Odontólogos que intervinieron en el tratamiento: recetaron, registraron controles o lo modificaron."""
    people = [prescription.doctor for prescription in plan.prescriptions.all()]
    people += [visit.doctor for visit in plan.controls.all()]
    people += [change.author for change in plan.changes.all()]
    return list(dict.fromkeys(name for name in map(_name, people) if name))


def treatment_outcome(plan, reports):
    """Cómo fue el tratamiento, en datos: útil para no repetir lo que no funcionó."""
    levels = Counter(report.risk_level for report in reports)
    pains = [report.pain_level for report in reports if report.pain_level is not None]
    return {
        'days_with_followup': len({report.created_at.date() for report in reports}),
        'max_pain': max(pains) if pains else None,
        'last_pain': pains[-1] if pains else None,
        'red_alerts': levels['Alto'],
        'yellow_alerts': levels['Medio'],
    }


def build_clinical_history(patient):
    plans = list(
        TreatmentPlan.objects.filter(patient=patient)
        .select_related('clinical_procedure', 'current_phase', 'patient')
        .prefetch_related('phases', 'prescriptions__doctor', 'controls__doctor', 'changes__author')
        .order_by('-start_date', '-created_at')
    )
    treatments, medications, symptoms = [], [], Counter()
    for plan in plans:
        reports = list(plan.reports.order_by('created_at', 'id'))
        for report in reports:
            symptoms.update({
                entity['category'] for entity in report.extracted_entities
                if entity.get('label') == 'SINTOMA' and not entity.get('negated') and entity.get('category')
            })
        outcome = treatment_outcome(plan, reports)
        for prescription in plan.prescriptions.all():
            medications.append({
                'name': prescription.medication_name or prescription.details[:60],
                'strength': prescription.strength,
                'frequency': prescription.frequency,
                'duration': prescription.duration,
                'date': prescription.created_at,
                'doctor': _name(prescription.doctor),
                'treatment': plan.procedure or plan.title,
                'treatment_id': plan.id,
                'is_active': prescription.is_active,
                # Si tras esta receta hubo alertas rojas, el colega lo ve junto al fármaco.
                'red_alerts_in_treatment': outcome['red_alerts'],
            })
        treatments.append({
            'plan': TreatmentPlanSerializer(plan).data,
            'dentists': attending_dentists(plan),
            'outcome': outcome,
            'events': build_history(plan),
        })
    medications.sort(key=lambda item: item['date'], reverse=True)
    profile = getattr(patient, 'profile', None)
    primary = profile.primary_doctor if profile else None
    return {
        'patient': {
            'id': patient.id,
            'full_name': patient.get_full_name() or patient.username,
            'national_id': getattr(profile, 'national_id', None),
            'age': patient.age,
            'primary_doctor': _name(primary),
        },
        'summary': {
            'treatments': len(plans),
            'active_treatments': sum(plan.is_active for plan in plans),
            'dentists': list(dict.fromkeys(name for item in treatments for name in item['dentists'])),
            'frequent_symptoms': [{'label': label, 'days': count} for label, count in symptoms.most_common(5)],
        },
        'medications': medications,
        'treatments': treatments,
    }
