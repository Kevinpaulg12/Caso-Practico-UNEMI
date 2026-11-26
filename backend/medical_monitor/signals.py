"""Puntos de extensión del núcleo clínico.

El núcleo emite señales y no sabe quién las escucha: las características opcionales (por ejemplo, la
app `notifications`) se conectan a ellas solo cuando su variante las instala. Así el núcleo no
depende de ninguna funcionalidad opcional.
"""
from django.dispatch import Signal

# Se emite cuando un autorreporte queda en riesgo alto (alerta roja).
# Argumentos: patient (User) y report (PatientReport).
high_risk_report = Signal()
