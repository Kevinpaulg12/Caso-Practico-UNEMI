import { useLocation } from 'react-router-dom';
import DoctorNotifications from './DoctorNotifications';
import PanelLayout from './PanelLayout';
import { IconUsers, IconClipboard, IconChartBar, IconPill, IconCalendar } from './Icons';

const navigation = [
  { path: '/panel-doctor/consulta-medica', label: 'Consulta Médica', icon: IconPill },
  { path: '/panel-doctor/monitoreo', label: 'Monitoreo', icon: IconUsers },
  { path: '/panel-doctor/horario', label: 'Mi horario', icon: IconCalendar },
  { path: '/panel-doctor/historial', label: 'Historial y Altas', icon: IconClipboard },
  { path: '/panel-doctor/informes', label: 'Informes', icon: IconChartBar },
];

// El historial de un tratamiento y la historia clínica cuelgan de Monitoreo en el menú.
const sectionOf = (pathname) => (/^\/panel-doctor\/(tratamientos|pacientes)\//.test(pathname) ? '/panel-doctor/monitoreo' : pathname);

export default function DoctorLayout({ children, title, subtitle }) {
  const { pathname } = useLocation();
  return (
    <PanelLayout
      home="/panel-doctor/monitoreo"
      badge="AI"
      tagline="Seguimiento odontológico"
      area="Panel clínico"
      menuLabel="Vigilancia clínica"
      navigation={navigation}
      current={sectionOf(pathname)}
      fallbackName="Profesional de guardia"
      fallbackTitle="Odontología"
      title={title}
      subtitle={subtitle}
      headerExtra={<DoctorNotifications />}
    >
      {children}
    </PanelLayout>
  );
}
