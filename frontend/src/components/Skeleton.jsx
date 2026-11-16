// Esqueletos de carga: ocupan el lugar del contenido para que la pantalla no salte al llegar los datos.

export function Skeleton({ className = '' }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none ${className}`} />;
}

export function SkeletonCard({ lines = 3, className = '' }) {
  return (
    <div aria-hidden="true" className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <Skeleton className="h-4 w-2/5" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className={`h-3 ${index === lines - 1 ? 'w-3/5' : 'w-full'}`} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 5, className = '' }) {
  return (
    <div aria-hidden="true" className={`space-y-2.5 ${className}`}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Región de carga accesible: el lector de pantalla anuncia el texto y los bloques grises son decorativos.
export default function Loading({ label = 'Cargando...', children, className = '' }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
