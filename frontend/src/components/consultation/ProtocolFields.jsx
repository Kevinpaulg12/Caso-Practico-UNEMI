import { CheckField, Field, SelectField } from './fields';

// Datos propios del tratamiento elegido: cada protocolo define los suyos.
export default function ProtocolFields({ fields, values, errors = {}, onChange }) {
  if (fields.length === 0) return null;
  const set = (key, value) => onChange({ ...values, [key]: value });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const name = `clinical_${field.key}`;
        const label = field.required ? field.label : `${field.label} (opcional)`;
        if (field.type === 'boolean') {
          return (
            <CheckField key={field.key} name={name} label={field.label} checked={Boolean(values[field.key])} onChange={(event) => set(field.key, event.target.checked)} />
          );
        }
        if (field.type === 'select') {
          return (
            <SelectField key={field.key} name={name} label={label} options={field.options ?? []} value={values[field.key] ?? ''} error={errors[field.key]} onChange={(event) => set(field.key, event.target.value)} />
          );
        }
        return (
          <Field
            key={field.key}
            name={name}
            label={label}
            value={values[field.key] ?? ''}
            error={errors[field.key]}
            onChange={(event) => set(field.key, event.target.value)}
            {...(field.type === 'number'
              ? { type: 'number', inputMode: 'numeric', min: field.min, max: field.max }
              : { maxLength: 200 })}
          />
        );
      })}
    </div>
  );
}
