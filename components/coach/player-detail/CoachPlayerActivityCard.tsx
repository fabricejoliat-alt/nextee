import Link from "next/link";
import { MapPin } from "lucide-react";
import actionStyles from "../../admin/organizations/OrganizationSettingsAdmin.module.css";
import ManagementActivityDate from "@/components/ui/ManagementActivityDate";

type Props = {
  startsAt: string;
  endsAt?: string | null;
  dateLocale: string;
  typeLabel: string;
  title?: string;
  groupName: string;
  clubName: string;
  location?: string | null;
  href?: string;
  actionLabel?: string;
};

export default function CoachPlayerActivityCard({ startsAt, endsAt, dateLocale, typeLabel, title, groupName, clubName, location, href, actionLabel = "Ouvrir l’activité" }: Props) {
  const date = new Date(startsAt);
  const formatter = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(dateLocale, options).format(date);
  const time = formatter({ hour: "2-digit", minute: "2-digit" });
  const endTime = endsAt ? new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit" }).format(new Date(endsAt)) : null;

  return (
    <article className="planning-event-card">
      <div className="planning-event-card-inner">
        <ManagementActivityDate startsAt={startsAt} locale={dateLocale} />
        <div className="planning-event-content">
          <div className="manager-calendar-expanded">
            <div className="planning-event-title-row">
              <h3 className="planning-event-title">{typeLabel}{title ? <span className="planning-event-custom-title"> — {title}</span> : null}</h3>
              <span className="pill-soft">À venir</span>
            </div>
            <div className="manager-calendar-detail-grid">
              <div><span>Groupe</span><b>{groupName}</b></div>
              <div><span>Club</span><b>{clubName}</b></div>
              <div><span>Horaire</span><b>{time}{endTime ? ` — ${endTime}` : ""}</b></div>
            </div>
            <div className="planning-event-footer">
              <span className="planning-event-location"><MapPin size={16} aria-hidden="true" /><span>{location?.trim() || "Lieu non disponible"}</span></span>
              {href ? <div className="user-mgmt-card-actions"><Link className={actionStyles.secondaryButton} href={href}>{actionLabel}</Link></div> : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
