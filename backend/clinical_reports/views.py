"""Informes estadísticos del odontólogo: característica opcional ENABLE_REPORTS."""
from collections import Counter, defaultdict
from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from medical_monitor.models import AlertSettings, PatientReport
from medical_monitor.services import detect_symptoms
from medical_monitor.views_clinical import _scoped_doctor
from users.models import patients_of


class ReportsSummaryView(APIView):
    def get(self, request):
        doctor = _scoped_doctor(request)
        days = request.query_params.get('days', '30')
        if not days.isdigit() or not 1 <= int(days) <= 3650:
            raise ValidationError({'days': 'Indica un número de días válido.'})
        since = timezone.now() - timedelta(days=int(days))
        reports = list(
            PatientReport.objects
            .filter(patient__in=patients_of(doctor), created_at__gte=since)
            .order_by('created_at', 'id')
            .values('patient_id', 'pain_level', 'risk_level', 'message', 'created_at', 'postoperative_day')
        )

        by_patient = defaultdict(list)
        symptoms = Counter()
        for report in reports:
            by_patient[report['patient_id']].append(report)
            symptoms.update(detect_symptoms(report['message']))

        pain_by_day = defaultdict(list)
        followups = []
        for items in by_patient.values():
            first = timezone.localtime(items[0]['created_at']).date()
            last = timezone.localtime(items[-1]['created_at']).date()
            followups.append((last - first).days + 1)
            for item in items:
                # Día postoperatorio (0 = cirugía); los reportes antiguos usan los días desde el primero.
                day = item['postoperative_day']
                if day is None:
                    day = (timezone.localtime(item['created_at']).date() - first).days
                if day <= 14:
                    pain_by_day[day].append(item['pain_level'])

        latest_risk = Counter(items[-1]['risk_level'] for items in by_patient.values())
        counts = Counter(report['risk_level'] for report in reports)
        return Response({
            'days': int(days),
            'patients_monitored': len(by_patient),
            'reports_total': len(reports),
            'alerts_medium': counts['Medio'],
            'alerts_high': counts['Alto'],
            'average_followup_days': round(sum(followups) / len(followups), 1) if followups else None,
            'risk_distribution': {level: latest_risk[level] for level in ('Bajo', 'Medio', 'Alto')},
            'pain_by_day': [
                {'day': day, 'average': round(sum(values) / len(values), 1), 'reports': len(values)}
                for day, values in sorted(pain_by_day.items())
            ],
            'top_symptoms': [{'label': label, 'count': count} for label, count in symptoms.most_common(5)],
            'high_pain_threshold': AlertSettings.load().high_pain,
        })
