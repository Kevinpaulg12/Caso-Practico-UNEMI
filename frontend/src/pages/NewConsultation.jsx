import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useDebouncedValue from '../hooks/useDebouncedValue';
import DoctorLayout from '../components/DoctorLayout';
import ConsultationForm from '../components/consultation/ConsultationForm';
import ControlForm from '../components/consultation/ControlForm';
import { formatLongDate } from '../services/consultationRules';
import api from '../services/api';
import { IconHistory, IconMail, IconSave, IconSearch, IconUserPlus, IconUsers, IconX } from '../components/Icons';
import IconButton from '../components/IconButton';

const initialForm = {
  first_name: '',
  last_name: '',
  national_id: '',
  birth_date: '',
  phone: '',
  emergency_contact: '',
  email: '',
};

function validateNationalId(value) {
  const clean = value.trim();
  if (!/^\d{8,20}$/.test(clean)) return 'Escribe entre 8 y 20 números.';
  return '';
}

function validateNewPatient(form) {
  const errors = {};
  const namePattern = /^[\p{L}\p{M}\s'’-]{2,80}$/u;
  if (!namePattern.test(form.first_name.trim())) errors.first_name = 'Escribe nombres válidos usando solo letras.';
  if (!namePattern.test(form.last_name.trim())) errors.last_name = 'Escribe apellidos válidos usando solo letras.';
  const idError = validateNationalId(form.national_id);
  if (idError) errors.national_id = idError;
  if (!form.birth_date) errors.birth_date = 'Selecciona la fecha de nacimiento.';
  else {
    const birthDate = new Date(`${form.birth_date}T00:00:00`);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear()
      - ((today.getMonth() < birthDate.getMonth()
        || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) ? 1 : 0);
    if (birthDate > today || age < 0 || age > 120) errors.birth_date = 'La fecha de nacimiento no es válida.';
  }
  if (!/^[+0-9\s-]{7,30}$/.test(form.phone.trim())) errors.phone = 'Escribe un teléfono válido.';
  if (!/^[+0-9\s-]{7,30}$/.test(form.emergency_contact.trim())) errors.emergency_contact = 'Escribe un contacto de emergencia válido.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Escribe el correo del paciente: allí recibirá sus credenciales.';
  return errors;
}

function keepDigits(value) {
  return value.replace(/\D/g, '');
}

const isIdNumber = (value) => /^\d+$/.test(value);
const MIN_SEARCH = 2;

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00`);
  const today = new Date();
  const birthdayPassed = today.getMonth() > birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  const age = today.getFullYear() - birth.getFullYear() - (birthdayPassed ? 0 : 1);
  return age >= 0 && age <= 120 ? age : null;
}

export default function NewConsultation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  // Resultados de la búsqueda mientras se escribe, junto al texto que los produjo.
  const [matches, setMatches] = useState(null);
  const [patient, setPatient] = useState(null);
  const [status, setStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPatient, setNewPatient] = useState(initialForm);
  const [searchError, setSearchError] = useState('');
  const [formErrors, setFormErrors] = useState({});
  // ?registro=1 abre directamente el registro (antes era el módulo «Nuevo paciente»).
  const [showNewPatientForm, setShowNewPatientForm] = useState(() => searchParams.get('registro') === '1');
  const [credentials, setCredentials] = useState(null);
  // Tratamiento vigente del paciente elegido: permite registrar un control en lugar de un tratamiento nuevo.
  const [current, setCurrent] = useState(null);
  const [mode, setMode] = useState('control');
  const [controlMessage, setControlMessage] = useState('');
  // Cada control guardado deja el formulario en blanco para el siguiente.
  const [savedControls, setSavedControls] = useState(0);
  const age = calculateAge(newPatient.birth_date);
  const activePlan = patient && current?.patientId === patient.id ? current.plan : null;

  useEffect(() => {
    if (!patient?.has_active_treatment) return undefined;
    let stale = false;
    api.get('/treatment-plans/', { params: { patient: patient.id } })
      .then(({ data }) => {
        if (stale) return;
        const active = (data.results ?? data).filter((plan) => plan.is_active)
          .sort((a, b) => (b.surgery_date || '').localeCompare(a.surgery_date || '') || b.id - a.id);
        setCurrent({ patientId: patient.id, plan: active[0] ?? null });
      })
      .catch(() => {}); // Sin el tratamiento vigente se ofrece el registro de uno nuevo.
    return () => { stale = true; };
  }, [patient?.id, patient?.has_active_treatment]);
  const typed = query.trim();
  const debouncedQuery = useDebouncedValue(typed, 300);
  // Solo se muestran los resultados del texto actual: nunca los de una búsqueda anterior.
  const suggestions = !patient && matches?.query === typed ? matches.items : null;

  // Búsqueda mientras se escribe: espera a que el odontólogo deje de teclear y cancela la petición anterior.
  useEffect(() => {
    if (patient || debouncedQuery.length < MIN_SEARCH) return undefined;
    const controller = new AbortController();
    api.get('/patients/', { params: { search: debouncedQuery }, signal: controller.signal })
      .then(({ data }) => setMatches({ query: debouncedQuery, items: Array.isArray(data) ? data : [] }))
      .catch(() => {}); // Los errores se informan al pulsar «Buscar ficha».
    return () => controller.abort();
  }, [debouncedQuery, patient]);

  const choosePatient = (item) => {
    setPatient(item);
    setMode('control');
    setControlMessage('');
    setStatus('');
    setSearchError('');
    setShowNewPatientForm(false);
  };

  const openRegistration = () => {
    setNewPatient({ ...initialForm, national_id: isIdNumber(typed) ? typed : '' });
    setFormErrors({});
    setStatus('');
    setSearchError('');
    setShowNewPatientForm(true);
  };

  const resetPatient = () => {
    setPatient(null);
    setCredentials(null);
    setStatus('');
    setShowNewPatientForm(false);
    setQuery('');
    setMatches(null);
    if (searchParams.has('registro')) setSearchParams({}, { replace: true });
  };

  const searchPatient = async (event) => {
    event.preventDefault();
    const value = typed;
    const byId = isIdNumber(value);
    const inputError = byId
      ? validateNationalId(value)
      : value.length < MIN_SEARCH ? 'Escribe al menos 2 letras del nombre o la cédula completa.' : '';
    if (inputError) {
      setSearchError(inputError);
      setStatus('');
      return;
    }
    setSearching(true);
    setStatus('');
    setSearchError('');
    setPatient(null);
    setCredentials(null);
    setShowNewPatientForm(false);
    try {
      const { data } = await api.get('/patients/', { params: { search: value } });
      const match = byId ? data.find((item) => item.national_id === value) : null;
      if (match) {
        choosePatient(match);
      } else if (byId) {
        setNewPatient((current) => ({ ...current, national_id: value }));
        setShowNewPatientForm(true);
        setStatus('No encontramos una ficha con esa identificación. Completa los datos para crearla aquí.');
      } else {
        setMatches({ query: value, items: data });
        if (data.length === 0) {
          setStatus('No encontramos pacientes tuyos con ese nombre. Búscalo por su cédula completa o registra una ficha nueva.');
        }
      }
    } catch (error) {
      const code = error.response?.status;
      setStatus(code === 401
        ? 'Tu sesión ya no es válida. Vuelve a ingresar al sistema.'
        : code === 403
          ? 'Tu cuenta no tiene permiso para buscar pacientes.'
          : 'El servidor no respondió. Comprueba que el backend esté iniciado e inténtalo nuevamente.');
    } finally {
      setSearching(false);
    }
  };

  const updateNewPatient = ({ target }) => {
    const numericField = ['national_id', 'phone', 'emergency_contact'].includes(target.name);
    const value = numericField ? keepDigits(target.value) : target.value;
    setNewPatient((current) => ({ ...current, [target.name]: value }));
    setFormErrors((current) => ({ ...current, [target.name]: '' }));
    setStatus('');
  };

  const createPatient = async (event) => {
    event.preventDefault();
    const errors = validateNewPatient(newPatient);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setCreating(true);
    setStatus('');
    try {
      const { data } = await api.post('/patients/', newPatient);
      setPatient({
        ...data,
        full_name: data.full_name,
        national_id: newPatient.national_id,
        has_active_treatment: false,
      });
      // Las credenciales no se muestran: se envían al correo del paciente.
      setCredentials({ ...data.credentials, username: data.username });
      setStatus('Ficha creada correctamente. Ya puedes registrar la indicación.');
    } catch (error) {
      const detail = error.response?.data;
      const apiErrors = detail && typeof detail === 'object'
        ? Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]))
        : {};
      setFormErrors((current) => ({ ...current, ...apiErrors }));
      setStatus(detail?.detail || 'No pudimos crear la ficha. Revisa los campos marcados.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <DoctorLayout title="Consulta médica" subtitle="Identifica o registra al paciente y deja su tratamiento activo en una sola pantalla.">
      {!patient && (
      <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Paso 1</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">Identificar al paciente</h2>
            <p className="mt-1 text-xs text-slate-600">Si ya tiene una ficha, reutilizaremos sus datos. Si no existe, podrás crearla sin duplicados.</p>
          </div>
          {!showNewPatientForm && (
            <button type="button" onClick={openRegistration} className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50">
              <IconUserPlus className="h-3.5 w-3.5 shrink-0" />Registrar paciente nuevo
            </button>
          )}
        </div>
        <form onSubmit={searchPatient} role="search" className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1 text-xs font-bold text-slate-700">
            Nombres, apellidos o cédula
            <input
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSearchError(''); setStatus(''); }}
              maxLength="80"
              autoComplete="off"
              placeholder="Ej. Ana Ruiz o 1723456789"
              aria-describedby="patient-search-help"
              className={`mt-1 w-full rounded-xl border ${searchError ? 'border-rose-400' : 'border-slate-200'} bg-white p-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100`}
            />
            {searchError && <span role="alert" className="mt-1 block text-[11px] font-normal text-rose-600">{searchError}</span>}
          </label>
          <button type="submit" disabled={searching || !typed} className="inline-flex items-center gap-1.5 self-end rounded-xl bg-blue-600 px-5 py-3 text-xs font-bold text-white disabled:opacity-50">
            <IconSearch className="h-3.5 w-3.5 shrink-0" />{searching ? 'Buscando...' : 'Buscar ficha'}
          </button>
        </form>
        <p id="patient-search-help" className="mt-2 text-[11px] text-slate-500">
          Por nombre se busca entre tus pacientes; con la cédula completa se localiza cualquier ficha de la clínica.
        </p>
        <output aria-live="polite" className="sr-only">
          {suggestions ? `${suggestions.length} ${suggestions.length === 1 ? 'paciente encontrado' : 'pacientes encontrados'}` : ''}
        </output>
        {suggestions?.length > 0 && (
          <ul aria-label="Pacientes encontrados" className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {suggestions.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => choosePatient(item)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none">
                  <span className="min-w-0">
                    <strong className="block truncate text-sm text-slate-900">{item.full_name || item.username}</strong>
                    <span className="text-[11px] text-slate-500">
                      C.I. {item.national_id || 'sin registrar'}{item.age != null ? ` · ${item.age} ${item.age === 1 ? 'año' : 'años'}` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${item.has_active_treatment ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {item.has_active_treatment ? 'En tratamiento' : 'Sin tratamiento activo'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {status && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{status}</p>}
      </section>
      )}

      {!patient && showNewPatientForm && (
        <form onSubmit={createPatient} className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Ficha nueva</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">Registrar paciente en esta consulta</h2>
              <p className="mt-1 text-xs text-slate-500">Solicita solo la información necesaria. La edad se calcula desde la fecha de nacimiento y no se guarda.</p>
            </div>
            <button type="button" onClick={resetPatient} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">
              <IconX className="h-3.5 w-3.5 shrink-0" />Cancelar
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="Nombres" name="first_name" value={newPatient.first_name} onChange={updateNewPatient} required error={formErrors.first_name} />
            <Input label="Apellidos" name="last_name" value={newPatient.last_name} onChange={updateNewPatient} required error={formErrors.last_name} />
            <Input label="Cédula o identificación" name="national_id" value={newPatient.national_id} onChange={updateNewPatient} required inputMode="numeric" pattern="[0-9]*" error={formErrors.national_id} />
            <Input label="Fecha de nacimiento" name="birth_date" value={newPatient.birth_date} onChange={updateNewPatient} required type="date" error={formErrors.birth_date} />
            <Input label="Teléfono" name="phone" value={newPatient.phone} onChange={updateNewPatient} required type="tel" inputMode="numeric" pattern="[0-9]*" error={formErrors.phone} />
            <Input label="Contacto de emergencia" name="emergency_contact" value={newPatient.emergency_contact} onChange={updateNewPatient} required type="tel" inputMode="numeric" pattern="[0-9]*" error={formErrors.emergency_contact} />
            <div className="sm:col-span-2">
              <Input label="Correo electrónico (recibirá aquí sus credenciales)" name="email" value={newPatient.email} onChange={updateNewPatient} required type="email" error={formErrors.email} />
            </div>
            {age !== null && (
              <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800 sm:col-span-2">Edad calculada: <strong>{age} {age === 1 ? 'año' : 'años'}</strong>. Este valor no se guarda.</p>
            )}
          </div>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Al crear la ficha se genera un usuario y una contraseña temporal que se envían al correo del paciente desde el
            correo institucional. En su primer acceso, el propio paciente leerá y aceptará los Términos y Condiciones y el
            uso de sus datos antes de usar el portal.
          </p>
          <button type="submit" disabled={creating} className="inline-flex items-center gap-1.5 mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
            <IconSave className="h-3.5 w-3.5 shrink-0" />{creating ? 'Creando ficha...' : 'Crear ficha y continuar'}
          </button>
        </form>
      )}

      {patient && (
        <section className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">{credentials ? 'Ficha creada' : 'Ficha encontrada'}</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">{patient.full_name || patient.username}</h2>
              <p className="text-xs text-slate-600">C.I. {patient.national_id} · {patient.age != null ? `${patient.age} ${patient.age === 1 ? 'año' : 'años'}` : 'Edad no registrada'}</p>
            </div>
            {credentials && <CredentialsSent patientId={patient.id} credentials={credentials} />}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-emerald-700">
                {patient.has_active_treatment ? 'Tiene tratamiento activo' : 'Sin tratamiento activo'}
              </span>
              <IconButton to={`/panel-doctor/pacientes/${patient.id}/historia`} icon={IconHistory} tone="success" label="Historia clínica" />
              <IconButton icon={IconUsers} tone="success" label="Cambiar paciente" onClick={resetPatient} />
            </div>
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 border-b border-slate-100 pb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Paso 2</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">
                {activePlan && mode === 'control' ? 'Registrar control del tratamiento' : 'Registrar tratamiento'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {activePlan && mode === 'control'
                  ? 'Anota lo revisado hoy y cuándo debe volver el paciente. El sistema le avisará; no se agenda una hora.'
                  : 'El formulario se adapta al tratamiento que elijas: sus datos propios, si lleva receta y cada cuánto vuelve el paciente.'}
              </p>
              {activePlan && (
                <div role="group" aria-label="Tipo de registro" className="mt-3 inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
                  {[['control', `Control de ${(activePlan.procedure || activePlan.title).toLowerCase()}`], ['new', 'Iniciar otro tratamiento']].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mode === value}
                      onClick={() => { setMode(value); setControlMessage(''); }}
                      className={`rounded-lg px-3 py-1.5 transition ${mode === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {controlMessage && (
              <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{controlMessage}</p>
            )}
            {activePlan && mode === 'control' ? (
              <ControlForm
                key={`${activePlan.id}-${savedControls}`}
                plan={activePlan}
                onSaved={({ treatment }) => {
                  setCurrent({ patientId: patient.id, plan: treatment });
                  setSavedControls((count) => count + 1);
                  setControlMessage(treatment.next_control
                    ? `Control registrado. El paciente recibirá el aviso para volver el ${formatLongDate(treatment.next_control.date)}.`
                    : 'Control registrado. No quedó un próximo control pendiente.');
                }}
              />
            ) : (
              <ConsultationForm
                patientId={patient.id}
                onTreatmentAdded={(treatment) => {
                  // El formulario sigue visible con su confirmación; el control queda disponible para la próxima visita.
                  setMode('new');
                  setCurrent({ patientId: patient.id, plan: treatment });
                  setPatient((item) => ({ ...item, has_active_treatment: true }));
                }}
              />
            )}
          </section>
        </section>
      )}
    </DoctorLayout>
  );
}

function Input({ label, name, value, onChange, required, type = 'text', inputMode, pattern, error }) {
  return (
    <label className="text-xs font-bold text-slate-700">
      {label}
      <input name={name} value={value} onChange={onChange} required={required} type={type} inputMode={inputMode} pattern={pattern} className={`mt-1 w-full rounded-xl border ${error ? 'border-rose-400' : 'border-slate-200'} p-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100`} />
      {error && <span className="mt-1 block text-[11px] font-normal text-rose-600">{error}</span>}
    </label>
  );
}

// Estado del envío de las credenciales por correo, con la opción de reenviarlas.
function CredentialsSent({ patientId, credentials }) {
  const [state, setState] = useState(credentials);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const resend = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { data } = await api.post(`/patients/${patientId}/credentials/`);
      setState((current) => ({ ...current, ...data }));
      setMessage('Se generó una contraseña temporal nueva y se envió de nuevo. La anterior ya no sirve.');
    } catch (error) {
      setMessage(error.response?.data?.detail || 'No se pudieron reenviar las credenciales.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Credenciales del paciente" className="rounded-2xl border border-blue-200 bg-white p-4 text-xs text-slate-700">
      <p className="font-bold text-slate-900">Credenciales enviadas a {state.email}</p>
      <p className="mt-1">Usuario: <strong>{state.username}</strong>. La contraseña temporal solo viaja por correo; deberá cambiarla en su primer acceso.</p>
      {state.error && <p role="alert" className="mt-1 text-rose-700">{state.error}</p>}
      <button type="button" onClick={resend} disabled={busy} className="inline-flex items-center gap-1.5 mt-2 rounded-lg border border-blue-200 px-3 py-1.5 font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
        <IconMail className="h-3.5 w-3.5 shrink-0" />{busy ? 'Reenviando...' : 'Reenviar credenciales'}
      </button>
      {message && <p role="status" className="mt-1 text-slate-600">{message}</p>}
    </section>
  );
}
