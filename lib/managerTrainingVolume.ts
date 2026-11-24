import { trainingReferenceForWeek, type WeeklyTrainingObjective } from "./trainingVolumeReference";
import { uniqueTrainingRows, type DateRange, type TrainingInput } from "./playerStatistics";

export type TrainingVolumeWeek = { week: string; club: number; private: number; individual: number; other: number; total: number; objective: number | null };
type Objective = WeeklyTrainingObjective;

/** Match the weekly FTEM reference displayed on Player. */
export function managerTrainingVolumeSeries(range: DateRange, sessions: TrainingInput[], objective: Objective): TrainingVolumeWeek[] {
  const cursor = new Date(`${range.from}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  const end = new Date(`${range.to}T12:00:00Z`);
  const rows: TrainingVolumeWeek[] = [];
  const training = uniqueTrainingRows(sessions);
  while (cursor <= end) {
    const week = cursor.toISOString().slice(0, 10);
    const weekEnd = new Date(cursor); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const from = week < range.from ? range.from : week;
    const to = weekEnd.toISOString().slice(0, 10) > range.to ? range.to : weekEnd.toISOString().slice(0, 10);
    const row: TrainingVolumeWeek = { week, club: 0, private: 0, individual: 0, other: 0, total: 0, objective: trainingReferenceForWeek(week, objective).minutes };
    for (const session of training) {
      const day = session.startAt.slice(0, 10);
      if (day < from || day > to) continue;
      const origin = session.sessionType === "club" || session.sessionType === "private" || session.sessionType === "individual" ? session.sessionType : "other";
      const minutes = Math.max(0, Number(session.minutes ?? 0));
      row[origin] += minutes; row.total += minutes;
    }
    rows.push(row); cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return rows;
}
