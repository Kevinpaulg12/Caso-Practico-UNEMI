import { useEffect, useId, useState } from 'react';
import api from '../../services/api';
import { presetsFor, togglePhrase } from '../../services/instructionPresets';
import { IconCheck, IconPlus, IconSave, IconX } from '../Icons';
import { TextField } from './fields';

const MINE = 'Mis frases';

/**
 * Área de texto con frases rápidas: un clic añade la frase al final y otro clic la quita.
 * Debajo de los grupos del catálogo, el odontólogo guarda sus propias frases para la próxima vez.
 */
export default function PresetTextField({ field, specialty, name, value, onChange, maxLength = 1000, ...props }) {
  const groups = presetsFor(field, specialty);
  const [group, setGroup] = useState(null);
  const [mine, setMine] = useState([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const draftId = useId();

  useEffect(() => {
    let active = true;
    api.get('/doctor/instruction-presets/', { params: { field } })
      .then(({ data }) => { if (active) setMine(Array.isArray(data) ? data : data.results ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [field]);

  // El primer grupo visible: al cambiar de tratamiento puede aparecer o desaparecer el de la especialidad.
  const titles = [...groups.map(([title]) => title), MINE];
  const current = titles.includes(group) ? group : titles[0];
  const phrases = current === MINE ? mine.map((item) => item.text) : groups.find(([title]) => title === current)?.[1] ?? [];

  const emit = (text) => onChange({ target: { name, value: text } });

  const toggle = (phrase) => {
    const next = togglePhrase(value, phrase);
    if (next.length > maxLength) {
      setNotice(`No cabe: el texto no puede superar ${maxLength} caracteres.`);
      return;
    }
    setNotice('');
    emit(next);
  };

  const save = async () => {
    const text = draft.trim();
    if (text.length < 3) {
      setNotice('Escribe una frase de al menos 3 caracteres.');
      return;
    }
    try {
      const { data } = await api.post('/doctor/instruction-presets/', { field, text });
      setMine((items) => [...items, data]);
      setDraft('');
      setAdding(false);
      setNotice('');
    } catch (error) {
      setNotice(error.response?.data?.text?.[0] || 'No se pudo guardar la frase.');
    }
  };

  const remove = async (item) => {
    try {
      await api.delete(`/doctor/instruction-presets/${item.id}/`);
      setMine((items) => items.filter((entry) => entry.id !== item.id));
    } catch {
      setNotice('No se pudo borrar la frase.');
    }
  };

  // Lo seleccionado en el texto (o todo, si es corto) se propone como frase nueva.
  const startAdding = () => {
    const selected = typeof window !== 'undefined' ? String(window.getSelection?.() ?? '').trim() : '';
    setDraft(selected.slice(0, 200));
    setAdding(true);
    setNotice('');
  };

  return (
    <div className="space-y-2">
      <TextField name={name} value={value} onChange={onChange} maxLength={maxLength} {...props} />
      <div role="group" aria-label={`Frases rápidas: ${props.label}`} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Frases rápidas</span>
          {titles.map((title) => (
            <button
              key={title}
              type="button"
              aria-pressed={current === title}
              onClick={() => { setGroup(title); setAdding(false); setNotice(''); }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${current === title ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
            >
              {title}{title === MINE && mine.length > 0 ? ` (${mine.length})` : ''}
            </button>
          ))}
        </div>
        <ul aria-label={`Frases de ${current}`} className="mt-2 flex flex-wrap gap-1.5">
          {phrases.map((phrase) => {
            const used = value.includes(phrase);
            const own = current === MINE ? mine.find((item) => item.text === phrase) : null;
            return (
              <li key={phrase} className="ds-enter inline-flex max-w-full">
                <button
                  type="button"
                  aria-pressed={used}
                  onClick={() => toggle(phrase)}
                  className={`inline-flex max-w-full items-start gap-1 border px-2.5 py-1 text-left text-[11px] leading-snug transition ${own ? 'rounded-l-full border-r-0' : 'rounded-full'} ${used ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50'}`}
                >
                  {used ? <IconCheck className="mt-px h-3 w-3 shrink-0" /> : <IconPlus className="mt-px h-3 w-3 shrink-0 text-slate-400" />}
                  <span>{phrase}</span>
                </button>
                {own && (
                  <button
                    type="button"
                    aria-label={`Borrar mi frase «${phrase}»`}
                    title="Borrar de mis frases"
                    onClick={() => remove(own)}
                    className={`rounded-r-full border px-1.5 text-slate-400 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 ${used ? 'border-blue-600 bg-blue-600 text-blue-100' : 'border-slate-200 bg-white'}`}
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                )}
              </li>
            );
          })}
          {current === MINE && !adding && (
            <li>
              <button type="button" onClick={startAdding} className="inline-flex items-center gap-1 rounded-full border border-dashed border-blue-300 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-50">
                <IconPlus className="h-3 w-3" />Guardar una frase
              </button>
            </li>
          )}
        </ul>
        {current === MINE && mine.length === 0 && !adding && (
          <p className="mt-1.5 text-[11px] text-slate-500">Guarda las frases que repites siempre y aparecerán aquí en cada consulta.</p>
        )}
        {adding && (
          <div className="ds-enter mt-2 flex flex-wrap items-center gap-1.5">
            <label htmlFor={draftId} className="sr-only">Frase nueva</label>
            <input
              id={draftId}
              value={draft}
              maxLength={200}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); save(); }
                if (event.key === 'Escape') setAdding(false);
              }}
              placeholder="Ej. Usa la férula todas las noches."
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button type="button" onClick={save} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700">
              <IconSave className="h-3.5 w-3.5" />Guardar
            </button>
            <button type="button" onClick={() => { setAdding(false); setNotice(''); }} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-white">Cancelar</button>
          </div>
        )}
        {notice && <p role="alert" className="mt-1.5 text-[11px] text-rose-600">{notice}</p>}
      </div>
    </div>
  );
}
