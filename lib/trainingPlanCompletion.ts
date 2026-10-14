type TrainingPlanItem = { category: string; minutes: number };

function minutesByCategory(items: TrainingPlanItem[]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    const category = item.category.trim();
    const minutes = Number(item.minutes);
    if (!category || !Number.isFinite(minutes) || minutes <= 0) continue;
    totals.set(category, (totals.get(category) ?? 0) + minutes);
  }
  return totals;
}

/** Match sectors, cap each at its planned duration, then weight by planned minutes.
 * Repeated posts in a sector share one duration budget; actual time is never counted twice.
 */
export function trainingPlanCompletion(planned: TrainingPlanItem[], actual: TrainingPlanItem[]) {
  const plannedByCategory = minutesByCategory(planned);
  const actualByCategory = minutesByCategory(actual);
  const sectors = [...plannedByCategory].map(([category, plannedMinutes]) => {
    const actualMinutes = actualByCategory.get(category) ?? 0;
    const creditedMinutes = Math.min(plannedMinutes, actualMinutes);
    return { category, plannedMinutes, actualMinutes, creditedMinutes, percent: creditedMinutes / plannedMinutes * 100 };
  });
  const plannedMinutes = sectors.reduce((total, sector) => total + sector.plannedMinutes, 0);
  const creditedMinutes = sectors.reduce((total, sector) => total + sector.creditedMinutes, 0);
  return { plannedMinutes, creditedMinutes, sectors,
    percent: plannedMinutes > 0 ? Math.round(creditedMinutes / plannedMinutes * 100) : null };
}
