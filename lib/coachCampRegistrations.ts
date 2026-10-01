type Registration = {
  player_id: string;
  registration_status: string;
  day_status_by_day_index: Record<string, string>;
};

/** PATCH payload: never replay untouched attendance from an old UI snapshot. */
export function coachCampRegistrationChanges(
  original: Registration[],
  draft: Record<string, Omit<Registration, "player_id">>
) {
  const previous = new Map(original.map((row) => [row.player_id, row]));
  return Object.entries(draft).flatMap(([player_id, row]) => {
    const before = previous.get(player_id);
    const statusChanged = row.registration_status !== (before?.registration_status ?? "invited");
    const days = row.registration_status === "registered" ? Object.fromEntries(
      Object.entries(row.day_status_by_day_index).filter(([day, status]) =>
        status !== (before?.day_status_by_day_index[day] ?? "present"))) : {};
    if (!statusChanged && !Object.keys(days).length) return [];
    return [{ player_id, ...(statusChanged ? { registration_status: row.registration_status } : {}),
      ...(Object.keys(days).length ? { day_status_by_day_index: days } : {}) }];
  });
}
