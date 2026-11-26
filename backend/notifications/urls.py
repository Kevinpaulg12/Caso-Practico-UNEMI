from django.urls import path

from .views import RemindersView

urlpatterns = [
    path('reminders/', RemindersView.as_view(), name='reminders'),
]
