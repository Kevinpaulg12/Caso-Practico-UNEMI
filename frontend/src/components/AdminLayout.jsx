import { useLocation } from 'react-router-dom';
import PanelLayout from './PanelLayout';
import { IconUsers, IconBookOpen, IconSliders, IconShield, IconSparkles } from './Icons';

const navigation = [
  { path: '/panel-admin', label: 'Usuarios y roles', icon: IconUsers },
  { path: '/panel-admin/catalogo', label: 'Catálogo clínico', icon: IconBookOpen },
  { path: '/panel-admin/reglas', label: 'Reglas de alerta', icon: IconSliders },
  { path: '/panel-admin/ia', label: 'Inteligencia artificial', icon: IconSparkles },
  { path: '/panel-admin/auditoria', label: 'Registro de auditoría', icon: IconShield },
];

export default function AdminLayout({ title, subtitle, children }) {
  const { pathname } = useLocation();
  return (
    <PanelLayout
      home="/panel-admin"
      badge="ADMIN"
      tagline="Panel de Administración"
      area="Administración Central"
      menuLabel="Módulos del sistema"
      accent="slate"
      navigation={navigation}
      current={pathname}
      fallbackName="Administrador"
      fallbackTitle="Gestión de Sistema"
      title={title}
      subtitle={subtitle}
      headerExtra={(
        <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 sm:inline-flex">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Sistema operativo
        </span>
      )}
    >
      {children}
    </PanelLayout>
  );
}
