// Tratamiento vigente: el de inicio más reciente, igual que active_plan() en el backend.
export function currentPlan(plans) {
  return plans
    .filter((plan) => plan.is_active)
    .sort((a, b) => (b.surgery_date ?? '').localeCompare(a.surgery_date ?? '') || b.id - a.id)[0] ?? null;
}
