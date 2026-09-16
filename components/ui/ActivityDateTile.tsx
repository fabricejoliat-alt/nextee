type ActivityDateTileProps = {
  startsAt: string;
  locale: string;
  className: string;
  showYear?: boolean;
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function ActivityDateTile({ startsAt, locale, className, showYear = false }: ActivityDateTileProps) {
  const date = new Date(startsAt);
  const format = (options: Intl.DateTimeFormatOptions) =>
    capitalize(new Intl.DateTimeFormat(locale, options).format(date).replace(".", ""));

  return (
    <div className={className} aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(date)}>
      <span>{format({ weekday: "short" })}</span>
      <strong>{date.getDate()}</strong>
      <span>{format({ month: "short" })}</span>
      {showYear ? <small>{date.getFullYear()}</small> : null}
    </div>
  );
}
