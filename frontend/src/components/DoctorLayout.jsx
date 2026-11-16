import { useLocation } from 'react-router-dom';
import PanelLayout from './PanelLayout';
import { IconUsers, IconClipboard, IconChartBar, IconPill } from './Icons';

const navigation = [
  { path: '/panel-doctor/consulta-medica', label: 'Consulta Médica', icon: IconPill },
  { path: '/panel-doctor', label: 'Pacientes Activos', icon: IconUsers },
  { path: '/panel-doctor/historial', label: 'Historial y Altas', icon: IconClipboard },
  { path: '/panel-doctor/informes', label: 'Informes', icon: IconChartBar },
];

// El historial de un tratamiento cuelga de Pacientes Activos en el menú.
const sectionOf = (pathname) => (pathname.startsWith('/panel-doctor/tratamientos/') ? '/panel-doctor' : pathname);

export default function DoctorLayout({ children, title, subtitle }) {
  const { pathname } = useLocation();
  return (
    <PanelLayout
      home="/panel-doctor"
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
    >
      {children}
    </PanelLayout>
  );
}
