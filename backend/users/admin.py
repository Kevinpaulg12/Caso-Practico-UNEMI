from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, UserProfile

@admin.register(User)
class CustomUserAdmin(UserAdmin):
    # Inyectamos nuestro campo personalizado 'role' en los formularios del admin
    fieldsets = UserAdmin.fieldsets + (
        ('Información de Rol (Tesis)', {'fields': ('role',)}),
    )
    
    # Columnas visibles en la tabla principal
    list_display = ('username', 'email', 'first_name', 'last_name', 'role', 'is_staff')
    
    # Filtros laterales
    list_filter = ('role', 'is_staff', 'is_superuser', 'is_active')


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'birth_date', 'phone', 'emergency_contact')