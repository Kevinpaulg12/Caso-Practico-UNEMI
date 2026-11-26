import { formatLongDate } from '../../services/consultationRules';

// Controles de formulario compartidos por la consulta y el control.
const inputClass = (error) => `mt-1 w-full rounded-xl border ${error ? 'border-rose-400' : 'border-slate-200'} bg-white p-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100`;

function ErrorText({ children }) {
  return children ? <span className="mt-1 block text-[11px] font-normal text-rose-600">{children}</span> : null;
}

export function Field({ label, error, hint, ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <input {...props} className={inputClass(error)} />
      {hint && !error && <span className="mt-1 block text-[11px] font-normal text-slate-500">{hint}</span>}
      <ErrorText>{error}</ErrorText>
    </label>
  );
}

export function SelectField({ label, options, error, placeholder = 'Selecciona una opción', ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <select {...props} className={inputClass(error)}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <ErrorText>{error}</ErrorText>
    </label>
  );
}

export function TextField({ label, error, ...props }) {
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <textarea rows="3" {...props} className={inputClass(error)} />
      <ErrorText>{error}</ErrorText>
    </label>
  );
}

export function CheckField({ label, hint, ...props }) {
  return (
    <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700">
      <input type="checkbox" {...props} className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-[11px] font-normal text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

// En cuántos días debe volver el paciente: lo propone el protocolo y el odontólogo lo ajusta.
export function NextControlField({ value, onChange, error, returnDate }) {
  return (
    <Field
      label="Próximo control (días)"
      name="next_control_in_days"
      value={value}
      onChange={onChange}
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={3}
      placeholder="Ej. 28"
      error={error}
      hint={returnDate
        ? `El paciente recibirá el aviso para volver el ${formatLongDate(returnDate)}. No se agenda una hora: él coordina su turno.`
        : 'Con 0 o vacío no se le avisará de un control.'}
    />
  );
}
