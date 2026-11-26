// Destino tras iniciar sesión, en este orden: consentimiento, contraseña temporal y panel del rol.
export function homePath(user) {
  if (user?.must_accept_terms) return '/consentimiento';
  if (user?.must_change_password) return '/mi-cuenta?section=security&firstLogin=1';
  if (user?.role === 'DOC') return '/panel-doctor/monitoreo';
  if (user?.role === 'ADM') return '/panel-admin';
  return '/panel-paciente';
}

// Perfil del último usuario que cerró sesión en este navegador: solo datos de presentación, nunca tokens.
const PROFILE_KEY = 'last_profile';

export function rememberProfile(user) {
  if (!user?.username) return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    username: user.username,
    full_name: user.full_name || '',
    role: user.role || '',
  }));
}

export function rememberedProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY));
    return profile?.username ? profile : null;
  } catch {
    return null;
  }
}

export function forgetProfile() {
  localStorage.removeItem(PROFILE_KEY);
}

export function initials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '?';
}
