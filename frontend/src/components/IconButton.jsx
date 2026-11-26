import { Link } from 'react-router-dom';

const TONES = {
  primary: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600',
  neutral: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white hover:border-emerald-600',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white hover:border-rose-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-500 hover:text-white hover:border-amber-500',
};

/**
 * Botón de acción solo con ícono. El texto va en aria-label (lectores de pantalla y pruebas) y en
 * una etiqueta flotante que aparece al pasar el ratón o al enfocar con el teclado.
 */
export default function IconButton({ icon: Icon, label, to, tone = 'neutral', className = '', busy = false, ...props }) {
  const classes = `group/tip relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ease-out active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${TONES[tone]} ${className}`;
  const content = (
    <>
      <Icon className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} />
      <span
        aria-hidden="true"
        // A la izquierda del botón: las tablas con desplazamiento horizontal recortarían una etiqueta encima.
        className="pointer-events-none absolute right-full top-1/2 z-30 mr-1.5 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-all duration-150 group-hover/tip:translate-x-0 group-hover/tip:opacity-100 group-focus-visible/tip:translate-x-0 group-focus-visible/tip:opacity-100"
      >
        {label}
      </span>
    </>
  );
  if (to) {
    return <Link to={to} aria-label={label} className={classes} {...props}>{content}</Link>;
  }
  return <button type="button" aria-label={label} aria-busy={busy || undefined} className={classes} {...props}>{content}</button>;
}
