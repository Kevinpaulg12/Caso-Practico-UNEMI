import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { DEFAULT_STRENGTHS, DOSAGE_FORMS, FREQUENCIES } from '../../services/medicationOptions';
import { Field, SelectField } from './fields';
import MedicationSheet from './MedicationSheet';

const unique = (items) => [...new Set(items.filter(Boolean))];

// Receta: busca el medicamento en el catálogo y ofrece sus concentraciones y presentaciones reales.
export default function MedicationSection({ values, errors = {}, onChange }) {
  const [query, setQuery] = useState(values.medication_name);
  const [suggestions, setSuggestions] = useState([]);
  // Presentaciones del medicamento elegido: [{strength, form}].
  const [presentations, setPresentations] = useState([]);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const skipNextSearch = useRef(false);

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return undefined;
    }
    if (query.trim().length < 2) return undefined;
    let stale = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get('/medications/search/', { params: { q: query.trim() } });
        if (stale) return;
        setSuggestions(data.items || []);
        setCatalogMessage(data.message || '');
      } catch {
        if (stale) return;
        setSuggestions([]);
        setCatalogMessage('No se pudo consultar el catálogo. Puedes escribir el medicamento manualmente.');
      } finally {
        if (!stale) setSearching(false);
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const strengthOptions = useMemo(() => unique([
    ...presentations.map((item) => item.strength),
    // Sin presentaciones del catálogo se ofrecen las dosis habituales.
    ...(presentations.length ? [] : [...DEFAULT_STRENGTHS, ...suggestions.map((item) => item.strength)]),
    values.strength,
  ]), [presentations, suggestions, values.strength]);

  const formOptions = useMemo(() => {
    const forStrength = presentations.filter((item) => !values.strength || item.strength === values.strength).map((item) => item.form);
    return unique([...(forStrength.length ? forStrength : DOSAGE_FORMS), values.dosage_form]);
  }, [presentations, values.strength, values.dosage_form]);

  const update = ({ target }) => {
    const value = target.name === 'duration' ? target.value.replace(/\D/g, '').slice(0, 3) : target.value;
    onChange({ [target.name]: value });
  };

  const typeName = (value) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setCatalogMessage('');
    }
    setPresentations([]);
    onChange({ medication_name: value });
  };

  const select = (item) => {
    const available = item.presentations ?? [];
    setPresentations(available);
    onChange({
      medication_name: item.name,
      active_ingredient: item.active_ingredient || item.name.split(' ')[0],
      strength: item.strength || (available.length === 1 ? available[0].strength : '') || values.strength,
      ...(available.length === 1 ? { dosage_form: available[0].form } : {}),
    });
    skipNextSearch.current = true;
    setQuery(item.name);
    setSuggestions([]);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="relative sm:col-span-2">
        <label htmlFor="medication-search" className="mb-1 block text-xs font-bold text-slate-700">Medicamento</label>
        <input
          id="medication-search"
          value={query}
          onChange={(event) => typeName(event.target.value)}
          placeholder="Escribe: paracetamol, ibuprofeno..."
          maxLength={120}
          autoComplete="off"
          className={`w-full rounded-xl border ${errors.medication_name ? 'border-rose-400' : 'border-slate-200'} bg-slate-50/70 p-3 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100`}
        />
        {errors.medication_name && <p className="mt-1 text-[11px] font-normal text-rose-600">{errors.medication_name}</p>}
        {searching && <span className="absolute right-3 top-9 text-[10px] text-slate-400">Buscando...</span>}
        {suggestions.length > 0 && (
          <ul aria-label="Medicamentos encontrados" className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            {suggestions.map((item) => (
              <li key={`${item.rxcui || item.name}-${item.name}`}>
                <button type="button" onClick={() => select(item)} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-blue-50">
                  <strong>{item.name}</strong>
                  {item.presentations?.length > 0 && (
                    <span className="ml-2 text-[11px] text-slate-500">{unique(item.presentations.map((option) => option.strength)).slice(0, 4).join(' · ')}</span>
                  )}
                  <span className="ml-2 text-[10px] text-slate-400">{item.source}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {catalogMessage && <p className="mt-1 text-[10px] text-amber-700">{catalogMessage}</p>}
      </div>
      <Field label="Principio activo" name="active_ingredient" value={values.active_ingredient} onChange={update} placeholder="Ej. paracetamol" maxLength={120} error={errors.active_ingredient} />
      <SelectField label="Concentración" name="strength" value={values.strength} onChange={update} options={strengthOptions} placeholder="Selecciona una concentración" error={errors.strength} />
      <SelectField label="Presentación" name="dosage_form" value={values.dosage_form} onChange={update} options={formOptions} error={errors.dosage_form} />
      <SelectField label="Frecuencia" name="frequency" value={values.frequency} onChange={update} options={FREQUENCIES} error={errors.frequency} />
      <Field label="Duración (días)" name="duration" value={values.duration} onChange={update} placeholder="Ej. 3" inputMode="numeric" pattern="[0-9]*" maxLength={3} error={errors.duration} />
      <div className="sm:col-span-2">
        <MedicationSheet name={values.active_ingredient.trim() || values.medication_name.trim()} />
      </div>
    </div>
  );
}
