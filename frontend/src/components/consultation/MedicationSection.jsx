import { useEffect, useId, useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { DEFAULT_STRENGTHS, DOSAGE_FORMS, FREQUENCIES } from '../../services/medicationOptions';
import { Field, SelectField, TextField } from './fields';
import MedicationSheet from './MedicationSheet';
import { IconSave } from '../Icons';

const unique = (items) => [...new Set(items.filter(Boolean))];

// Lo que se completa solo al elegir el fármaco: vía, alimentos y efectos frecuentes.
function autoNotes(item, presentation) {
  return [
    presentation?.route ? `Vía ${presentation.route.toLowerCase().replace(/^vía /, '')}.` : '',
    item?.with_food || '',
    item?.common_effects ? `Puede causar: ${item.common_effects.charAt(0).toLowerCase()}${item.common_effects.slice(1)}` : '',
  ].filter(Boolean).join(' ');
}

/**
 * Receta en tres clics: medicamento → concentración → frecuencia. La presentación, la vía, la duración
 * habitual, la toma con alimentos y los efectos frecuentes se completan solos y se pueden cambiar.
 */
export default function MedicationSection({ values, errors = {}, onChange }) {
  // Puede haber varios en la misma receta: cada buscador necesita su propio id.
  const searchId = useId();
  const [query, setQuery] = useState(values.medication_name);
  const [suggestions, setSuggestions] = useState([]);
  // Fármaco elegido del catálogo: trae sus presentaciones y su pauta habitual.
  const [selected, setSelected] = useState(null);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
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
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const presentations = useMemo(() => selected?.presentations ?? [], [selected]);
  const strengthOptions = useMemo(() => unique([
    ...presentations.map((item) => item.strength),
    // Sin presentaciones del catálogo se ofrecen las dosis habituales.
    ...(presentations.length ? [] : DEFAULT_STRENGTHS),
    values.strength,
  ]), [presentations, values.strength]);
  const formsFor = (strength) => unique(presentations.filter((item) => !strength || item.strength === strength).map((item) => item.form));
  const formOptions = unique([...(formsFor(values.strength).length ? formsFor(values.strength) : DOSAGE_FORMS), values.dosage_form]);
  const frequencyOptions = unique([...(selected?.frequencies ?? []), ...FREQUENCIES, values.frequency]);

  const update = ({ target }) => {
    const value = target.name === 'duration' ? target.value.replace(/\D/g, '').slice(0, 3) : target.value;
    const patch = { [target.name]: value };
    if (target.name === 'strength' && presentations.length) {
      // Si esa concentración solo existe en una presentación, se elige sola (clic 2 de 3).
      const forms = formsFor(value);
      if (forms.length === 1) patch.dosage_form = forms[0];
      const presentation = presentations.find((item) => item.strength === value && (forms.length !== 1 || item.form === forms[0]));
      if (presentation && selected) patch.notes = autoNotes(selected, presentation);
    }
    onChange(patch);
  };

  const typeName = (value) => {
    setQuery(value);
    setSaved('');
    if (value.trim().length < 2) {
      setSuggestions([]);
      setCatalogMessage('');
    }
    setSelected(null);
    onChange({ medication_name: value });
  };

  const select = (item) => {
    const available = item.presentations ?? [];
    setSelected(item);
    const only = available.length === 1 ? available[0] : null;
    // Clic 1 de 3: el resto de la pauta habitual se completa sola.
    onChange({
      medication_name: item.name,
      active_ingredient: item.active_ingredient || item.name.split(' ')[0],
      strength: item.strength || only?.strength || '',
      dosage_form: only?.form || '',
      frequency: item.default_frequency || '',
      duration: item.duration_days ? String(item.duration_days) : '',
      notes: autoNotes(item, only ?? available[0]),
    });
    skipNextSearch.current = true;
    setQuery(item.name);
    setSuggestions([]);
    setCatalogMessage('');
  };

  // Marca que no está en ninguna fuente (p. ej. una marca de Ecuador): se guarda con su principio activo.
  const saveBrand = async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/vademecum/', { brand: values.medication_name.trim(), active_ingredient: values.active_ingredient.trim() });
      select({
        medication_id: data.id, name: values.medication_name.trim(), active_ingredient: data.generic_name, presentations: data.presentations,
        frequencies: data.frequencies, default_frequency: data.default_frequency, duration_days: data.duration_days,
        with_food: data.with_food, common_effects: data.common_effects, strength: '',
      });
      setSaved(`«${values.medication_name.trim()}» quedó en el vademécum de la clínica como ${data.generic_name}.`);
    } catch (error) {
      setCatalogMessage(error.response?.data?.active_ingredient?.[0] || error.response?.data?.detail || 'No se pudo guardar en el vademécum.');
    } finally {
      setSaving(false);
    }
  };
  const canSaveBrand = !selected && values.medication_name.trim().length >= 2 && values.active_ingredient.trim().length >= 3;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="relative sm:col-span-2">
        <label htmlFor={searchId} className="mb-1 block text-xs font-bold text-slate-700">Medicamento</label>
        <input
          id={searchId}
          value={query}
          onChange={(event) => typeName(event.target.value)}
          placeholder="Nombre genérico o marca: ibuprofeno, Augmentin..."
          maxLength={120}
          autoComplete="off"
          className={`w-full rounded-xl border ${errors.medication_name ? 'border-rose-400' : 'border-slate-200'} bg-slate-50/70 p-3 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100`}
        />
        {errors.medication_name && <p className="mt-1 text-[11px] font-normal text-rose-600">{errors.medication_name}</p>}
        {searching && <span className="absolute right-3 top-9 text-[10px] text-slate-400">Buscando...</span>}
        {suggestions.length > 0 && (
          <ul aria-label="Medicamentos encontrados" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            {suggestions.map((item) => (
              <li key={`${item.source}-${item.name}`}>
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
        {catalogMessage && <p className="mt-1 text-[11px] text-amber-700">{catalogMessage}</p>}
        {saved && <p role="status" className="mt-1 text-[11px] text-emerald-700">{saved}</p>}
      </div>
      <Field label="Principio activo" name="active_ingredient" value={values.active_ingredient} onChange={update} placeholder="Ej. ibuprofeno" maxLength={120} error={errors.active_ingredient} />
      <SelectField label="Concentración" name="strength" value={values.strength} onChange={update} options={strengthOptions} placeholder="Selecciona una concentración" error={errors.strength} />
      {canSaveBrand && (
        <p className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[11px] text-blue-900 sm:col-span-2">
          ¿Es una marca que no aparece en el catálogo?
          <button type="button" onClick={saveBrand} disabled={saving} className="inline-flex items-center gap-1.5 ml-2 rounded-lg bg-blue-600 px-2.5 py-1 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            <IconSave className="h-3.5 w-3.5 shrink-0" />{saving ? 'Guardando...' : `Guardar «${values.medication_name.trim()}» en el vademécum`}
          </button>
          <span className="mt-1 block text-blue-800">La próxima vez aparecerá en la búsqueda con las presentaciones de su principio activo.</span>
        </p>
      )}
      <SelectField label="Frecuencia" name="frequency" value={values.frequency} onChange={update} options={frequencyOptions} error={errors.frequency} />
      <SelectField label="Presentación" name="dosage_form" value={values.dosage_form} onChange={update} options={formOptions} error={errors.dosage_form} />
      <Field label="Duración (días)" name="duration" value={values.duration} onChange={update} placeholder="Ej. 3" inputMode="numeric" pattern="[0-9]*" maxLength={3} error={errors.duration} hint={selected?.duration_days ? 'Duración habitual de este fármaco; puedes cambiarla.' : undefined} />
      <div className="sm:col-span-2">
        <TextField label="Cómo tomarlo (se completa solo, puedes editarlo)" name="notes" value={values.notes ?? ''} onChange={update} maxLength={500} placeholder="Vía, toma con alimentos y efectos frecuentes" error={errors.notes} />
      </div>
      <div className="sm:col-span-2">
        <MedicationSheet name={values.active_ingredient.trim() || values.medication_name.trim()} />
      </div>
    </div>
  );
}
