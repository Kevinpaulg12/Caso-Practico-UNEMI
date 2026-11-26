"""Pruebas de la línea de productos: variantes, banderas y separación entre núcleo y características."""
import re
from importlib import reload
from pathlib import Path
from types import SimpleNamespace

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import clear_url_caches
from rest_framework.test import APIClient

from core import config_product
from medical_monitor.signals import high_risk_report
from users.models import User, UserProfile


def reload_urls():
    """Vuelve a construir las rutas con las banderas actuales (urls.py las lee al importarse)."""
    import core.urls

    clear_url_caches()
    reload(core.urls)


class VariantMixin:
    """Ejecuta cada prueba con unas banderas dadas y deja las rutas como estaban al terminar."""

    def use_flags(self, **flags):
        override = override_settings(**flags)
        override.enable()
        self.addCleanup(reload_urls)
        self.addCleanup(override.disable)
        reload_urls()


class ProductConfigTests(TestCase):
    def test_variant_a_is_the_basic_product(self):
        product = config_product.load_product('a')
        self.assertEqual(product['NAME'], 'DentalSense Básico')
        self.assertFalse(any(product[flag] for flag in ('ENABLE_REPORTS', 'ENABLE_NOTIFICATIONS', 'ENABLE_AI')))
        self.assertEqual(config_product.feature_apps(product), [])

    def test_variant_b_is_the_full_product(self):
        product = config_product.load_product('B')
        self.assertTrue(all(product[flag] for flag in ('ENABLE_REPORTS', 'ENABLE_NOTIFICATIONS', 'ENABLE_AI')))
        self.assertEqual(config_product.feature_apps(product), ['clinical_reports', 'notifications'])

    def test_unknown_variant_is_rejected(self):
        with self.assertRaisesMessage(ValueError, 'Variante de producto desconocida'):
            config_product.load_product('Z')

    def test_load_returns_a_copy(self):
        config_product.load_product('A')['ENABLE_REPORTS'] = True
        self.assertFalse(config_product.PRODUCT_A['ENABLE_REPORTS'])


class FeatureRoutesTests(VariantMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doc.var', password='x', role=User.Roles.DOCTOR)
        cls.patient = User.objects.create_user('pat.var', password='x', role=User.Roles.PATIENT)

    def get(self, user, url):
        client = APIClient()
        client.force_authenticate(user)
        return client.get(url)

    def test_variant_a_has_no_reports_or_reminders(self):
        self.use_flags(ENABLE_REPORTS=False, ENABLE_NOTIFICATIONS=False)
        self.assertEqual(self.get(self.doctor, '/api/reports/summary/').status_code, 404)
        self.assertEqual(self.get(self.patient, '/api/reminders/').status_code, 404)

    def test_variant_b_exposes_reports_and_reminders(self):
        self.use_flags(ENABLE_REPORTS=True, ENABLE_NOTIFICATIONS=True)
        self.assertEqual(self.get(self.doctor, '/api/reports/summary/').status_code, 200)
        self.assertEqual(self.get(self.patient, '/api/reminders/').status_code, 200)

    def test_each_feature_is_independent(self):
        self.use_flags(ENABLE_REPORTS=True, ENABLE_NOTIFICATIONS=False)
        self.assertEqual(self.get(self.doctor, '/api/reports/summary/').status_code, 200)
        self.assertEqual(self.get(self.patient, '/api/reminders/').status_code, 404)

    def test_core_works_in_every_variant(self):
        for flags in ({'ENABLE_REPORTS': False, 'ENABLE_NOTIFICATIONS': False},
                      {'ENABLE_REPORTS': True, 'ENABLE_NOTIFICATIONS': True}):
            with self.subTest(flags=flags):
                self.use_flags(**flags)
                self.assertEqual(self.get(self.doctor, '/api/treatment-plans/').status_code, 200)
                self.assertEqual(self.get(self.patient, '/api/patient-reports/').status_code, 200)

    def test_me_reports_the_active_features(self):
        self.use_flags(ENABLE_REPORTS=False, ENABLE_NOTIFICATIONS=True, PRODUCT_NAME='Prueba', PRODUCT_VARIANT='X')
        features = self.get(self.doctor, '/api/me/').data['features']
        self.assertEqual(features, {'product': 'Prueba', 'variant': 'X', 'reports': False,
                                    'notifications': True, 'ai': False})


class NotificationFeatureTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doc.mail', password='x', role=User.Roles.DOCTOR, email='doc@example.com')
        cls.patient = User.objects.create_user('pat.mail', password='x', role=User.Roles.PATIENT)
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.doctor)

    def emit(self):
        with self.captureOnCommitCallbacks(execute=True):
            high_risk_report.send(sender=None, patient=self.patient, report=SimpleNamespace(pain_level=9))

    @override_settings(ENABLE_NOTIFICATIONS=True)
    def test_red_alert_emails_the_doctor_when_enabled(self):
        self.emit()
        self.assertEqual([message.to for message in mail.outbox], [['doc@example.com']])

    @override_settings(ENABLE_NOTIFICATIONS=False)
    def test_red_alert_sends_nothing_when_disabled(self):
        self.emit()
        self.assertEqual(mail.outbox, [])


class CoreIndependenceTests(TestCase):
    """El núcleo no debe importar las características opcionales: así puede derivarse sin ellas."""

    OPTIONAL_APPS = ('clinical_reports', 'notifications')

    def test_core_never_imports_optional_apps(self):
        backend = Path(__file__).resolve().parent.parent
        pattern = re.compile(r'^\s*(from|import)\s+(%s)\b' % '|'.join(self.OPTIONAL_APPS), re.M)
        offenders = [
            str(path.relative_to(backend))
            for app in ('medical_monitor', 'users', 'core')
            for path in (backend / app).rglob('*.py')
            if not path.name.startswith('tests') and pattern.search(path.read_text(encoding='utf-8'))
        ]
        self.assertEqual(offenders, [])
