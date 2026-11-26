const LEVEL_ORDER = { verde: 0, amarillo: 1, rojo: 2 };

function dayOf(report, firstDate) {
  if (report.postoperative_day !== null && report.postoperative_day !== undefined) return report.postoperative_day;
  return Math.round((new Date(report.created_at) - firstDate) / 86400000);
}

// Un punto por día: el EVA más alto y el nivel de alerta más grave de ese día.
// Sin nivel de alerta (lo que ve el paciente) el punto queda en el color neutro de la serie.
export function buildSeries(reports, expectedCurve = []) {
  const firstDate = reports.length ? Math.min(...reports.map((item) => new Date(item.created_at))) : 0;
  const byDay = new Map();
  for (const report of reports) {
    // En la conversación el paciente puede no haber dicho su dolor: ese día no tiene punto.
    if (report.pain_level === null || report.pain_level === undefined) continue;
    const day = dayOf(report, firstDate);
    const current = byDay.get(day);
    const color = report.alert_color ?? null;
    byDay.set(day, {
      reported: Math.max(current?.reported ?? 0, report.pain_level),
      reports: (current?.reports ?? 0) + 1,
      color: current && (LEVEL_ORDER[current.color] ?? -1) > (LEVEL_ORDER[color] ?? -1) ? current.color : color,
    });
  }
  const lastDay = Math.max(expectedCurve.length - 1, ...byDay.keys(), 0);
  return Array.from({ length: lastDay + 1 }, (_, day) => ({
    day,
    reported: byDay.get(day)?.reported ?? null,
    reports: byDay.get(day)?.reports ?? 0,
    color: byDay.get(day)?.color ?? null,
    expected: expectedCurve[day] ?? null,
  }));
}
