type ManagementActivityDateProps = {
  startsAt: string;
  locale?: string;
  showTime?: boolean;
  className?: string;
};

export default function ManagementActivityDate({
  startsAt,
  locale = "fr-CH",
  showTime = true,
  className = "",
}: ManagementActivityDateProps) {
  const date = new Date(startsAt);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(date);

  return (
    <div className={`planning-event-date manager-calendar-date-column ${className}`.trim()}>
      <div className="planning-event-day">{format({ weekday: "long" })}</div>
      <div className="planning-event-number">{date.getDate()}</div>
      <div className="planning-event-month">{format({ month: "long" })}</div>
      {showTime ? (
        <>
          <div className="planning-event-time-divider" />
          <div className="planning-event-times">
            <span>{format({ hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
