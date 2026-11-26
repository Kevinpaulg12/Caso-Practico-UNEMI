import PanelLayout from './PanelLayout';
import { PATIENT_SECTIONS, patientSectionPath } from './patientSections';

/** Portal del paciente: el mismo menú lateral que los demás roles. El contacto está junto al chat. */
export default function PatientLayout({ section, badges = {}, title, subtitle, children }) {
  const current = PATIENT_SECTIONS.find((item) => item.id === section);
  return (
    <PanelLayout
      home="/panel-paciente"
      badge="AI"
      tagline="Portal Paciente"
      area="Mi seguimiento"
      menuLabel="Mi seguimiento"
      navigation={PATIENT_SECTIONS.map(({ id, label, icon }) => ({
        path: patientSectionPath(id), label, icon, badge: badges[id] || null,
      }))}
      current={current ? patientSectionPath(section) : null}
      fallbackName={localStorage.getItem('logged_in_username') || 'paciente'}
      fallbackTitle="Paciente"
      title={title ?? current?.label}
      subtitle={subtitle ?? current?.subtitle}
    >
      {children}
    </PanelLayout>
  );
}
