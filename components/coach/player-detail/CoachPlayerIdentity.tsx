import styles from "../../../app/coach/players/[playerId]/CoachPlayerDetail.module.css";

type Props = {
  avatarUrl: string;
  avatarAlt: string;
  initials: string;
  handicap: string;
  ftemLevel: string;
  groups: string;
  clubs: string;
  nextActivity: string;
};

export default function CoachPlayerIdentity(props: Props) {
  const items = [
    ["Handicap", props.handicap],
    ["Niveau FTEM", props.ftemLevel],
    ["Groupe", props.groups],
    ["Club", props.clubs],
    ["Prochaine activité", props.nextActivity],
  ];

  return (
    <div className={styles.identity}>
      <div className={styles.avatar}>
        {props.avatarUrl ? <img src={props.avatarUrl} alt={props.avatarAlt} /> : props.initials}
      </div>
      <div className={styles.identityGrid}>
        {items.map(([label, value]) => (
          <div className={styles.identityItem} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
