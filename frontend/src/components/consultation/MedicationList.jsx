import { useState } from 'react';
import IconButton from '../IconButton';
import { IconCheck, IconPencil, IconPill, IconPlus, IconTrash } from '../Icons';
import { MAX_MEDICATIONS, newMedication, validateMedications } from '../../services/consultationRules';
import MedicationSection from './MedicationSection';

const NO_ERRORS = [];
const isEmpty = (item) => !item.medication_name.trim() && !item.strength;
const hasErrors = (errors) => Boolean(errors && Object.keys(errors).length);

const summary = (item) => [
  item.dosage_form,
  item.frequency,
  item.duration ? `${item.duration} ${item.duration === '1' ? 'día' : 'días'}` : '',
].filter(Boolean).join(' · ');

/**
 * Receta con uno o más medicamentos. Solo uno se edita a la vez (flujo de tres clics de
 * MedicationSection); los ya recetados se pliegan en una ficha con botones de editar y eliminar.
 */
export default function MedicationList({ items, errors = NO_ERRORS, general = '', onChange }) {
  const [openUid, setOpenUid] = useState(() => items.find(isEmpty)?.uid ?? null);
  // Errores de validación local (al plegar o añadir), por medicamento.
  const [localErrors, setLocalErrors] = useState({});
  // Si el servidor devuelve errores, se abre el primer medicamento con problemas.
  const [seenErrors, setSeenErrors] = useState(errors);
  if (errors !== seenErrors) {
    setSeenErrors(errors);
    const failing = errors.findIndex(hasErrors);
    if (failing >= 0 && items[failing]) setOpenUid(items[failing].uid);
  }

  // Abierto: el elegido; si ya no existe (p. ej. tras guardar la consulta), el primero aún vacío,
  // que queda fijado para que no se pliegue en cuanto se empieza a escribir.
  const chosen = items.find((item) => item.uid === openUid);
  const fallback = chosen ? null : items.find(isEmpty);
  if (fallback && fallback.uid !== openUid) setOpenUid(fallback.uid);
  const open = chosen ?? fallback ?? null;
  const errorsAt = (index) => localErrors[items[index].uid] ?? errors[index] ?? {};

  const update = (uid, patch) => {
    onChange(items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)));
    setLocalErrors((current) => ({ ...current, [uid]: undefined }));
  };

  // Pliega el abierto si está completo; si no, muestra lo que falta y devuelve false.
  const closeOpen = () => {
    if (!open || isEmpty(open)) return true;
    const index = items.indexOf(open);
    const listErrors = validateMedications(items);
    if (listErrors && hasErrors(listErrors[index])) {
      setLocalErrors((current) => ({ ...current, [open.uid]: listErrors[index] }));
      return false;
    }
    return true;
  };

  const add = () => {
    if (open && isEmpty(open)) return;
    if (!closeOpen()) return;
    const item = newMedication();
    onChange([...items, item]);
    setOpenUid(item.uid);
  };

  const edit = (uid) => {
    if (open && isEmpty(open) && items.length > 1) {
      // Un medicamento añadido y sin datos se descarta al pasar a editar otro.
      onChange(items.filter((item) => item !== open));
    } else if (!closeOpen()) {
      return;
    }
    setOpenUid(uid);
  };

  const done = () => {
    if (closeOpen()) setOpenUid('');
  };

  const remove = (uid) => {
    setLocalErrors((current) => ({ ...current, [uid]: undefined }));
    if (items.length === 1) {
      const item = newMedication();
      onChange([item]);
      setOpenUid(item.uid);
      return;
    }
    onChange(items.filter((item) => item.uid !== uid));
  };

  return (
    <div className="space-y-2.5">
      {items.map((item, index) => {
        const title = `Medicamento ${index + 1}${item.medication_name ? `: ${item.medication_name}` : ''}`;
        if (item === open) {
          return (
            <section key={item.uid} aria-label={`Medicamento ${index + 1}`} className="ds-enter rounded-2xl border border-blue-200 bg-white p-3 shadow-sm ring-4 ring-blue-50">
              <header className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-xs font-black text-slate-800">{title}</h4>
                <div className="flex items-center gap-1.5">
                  {!isEmpty(item) && <IconButton icon={IconCheck} tone="success" label={`Listo, plegar el medicamento ${index + 1}`} onClick={done} />}
                  {(items.length > 1 || !isEmpty(item)) && <IconButton icon={IconTrash} tone="danger" label={`Eliminar el medicamento ${index + 1}`} onClick={() => remove(item.uid)} />}
                </div>
              </header>
              <MedicationSection values={item} errors={errorsAt(index)} onChange={(patch) => update(item.uid, patch)} />
            </section>
          );
        }
        const failing = hasErrors(errorsAt(index));
        return (
          <section
            key={item.uid}
            aria-label={`Medicamento ${index + 1}`}
            className={`ds-enter flex items-center gap-3 rounded-2xl border p-3 ${failing ? 'border-rose-300 bg-rose-50/60' : 'border-slate-200 bg-slate-50/60'}`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${failing ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-700'}`}>
              <IconPill className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-black text-slate-900">
                {item.medication_name || `Medicamento ${index + 1}`}{item.strength ? ` ${item.strength}` : ''}
              </p>
              <p className="truncate text-[11px] text-slate-600">{summary(item) || 'Sin pauta'}</p>
              {failing ? (
                <p className="text-[11px] font-semibold text-rose-600">Revisa este medicamento.</p>
              ) : item.notes ? (
                <p className="truncate text-[11px] text-slate-400">{item.notes}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <IconButton icon={IconPencil} tone="primary" label={`Editar el ${title.charAt(0).toLowerCase()}${title.slice(1)}`} onClick={() => edit(item.uid)} />
              <IconButton icon={IconTrash} tone="danger" label={`Eliminar el ${title.charAt(0).toLowerCase()}${title.slice(1)}`} onClick={() => remove(item.uid)} />
            </div>
          </section>
        );
      })}
      {general && <p role="alert" className="text-[11px] text-rose-600">{general}</p>}
      {items.length < MAX_MEDICATIONS && !(open && isEmpty(open)) && (
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-blue-300 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
        >
          <IconPlus className="h-3.5 w-3.5" />Añadir otro medicamento
        </button>
      )}
    </div>
  );
}
