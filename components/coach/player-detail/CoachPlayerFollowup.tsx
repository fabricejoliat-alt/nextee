"use client";
import CoachActivityCard, { CoachActivityAction } from "../CoachActivityCard";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import type { CoachFollowupEvent, CoachFollowupSelfEvaluation, CoachFollowupCriterion, CoachFollowupResponse } from "@/lib/coachPlayerFollowup";
import styles from "./CoachPlayerFollowup.module.css";

type Feedback = { event_id: string; engagement: number | null; attitude: number | null; application: number | null; player_note: string | null; private_note: string | null };
type Note = { id: string; event_id: string; body: string; author_name?: string | null };
export default function CoachPlayerFollowup({ events, feedback, selfEvaluations, criteria, responses, notes, showClub }: {
 events: CoachFollowupEvent[]; feedback: Feedback[]; selfEvaluations: CoachFollowupSelfEvaluation[];
 criteria: CoachFollowupCriterion[]; responses: CoachFollowupResponse[]; notes: Note[]; showClub: boolean;
}) {
 const { t } = useI18n();
 return <div className={styles.list}>{events.map((event) => {
   const coach = feedback.find((row) => row.event_id === event.id);
   const self = selfEvaluations.find((row) => row.club_event_id === event.id);
   const privateNotes = notes.filter((note) => note.event_id === event.id && note.body !== coach?.private_note);
   const custom = (role: string) => responses.filter((response) => response.event_id === event.id && response.respondent_role === role).map((response) => {
     const criterion = criteria.find((item) => item.id === response.event_criterion_id);
     if (!criterion) return null;
     const value = criterion.snapshot_choices?.find((choice) => choice.value === response.value_json)?.label
       ?? (typeof response.value_json === "boolean" ? t(response.value_json ? "common.yes" : "common.no") : String(response.value_json ?? "—"));
     return <div key={criterion.id}><span>{criterion.snapshot_name}</span><b>{value}</b></div>;
   });
   const score = (label: string, value: number | null | undefined) => <div><span>{label}</span><b>{value == null ? "—" : `${value}/6`}</b></div>;
   return <CoachActivityCard key={event.id} startsAt={event.starts_at} endsAt={event.ends_at}
     typeLabel={t(`coach.activity.${event.event_type}`)} title={event.title} groupName={event.group_name}
     clubName={event.organization_name} showClub={showClub} location={event.location_text}
     actions={event.can_open_detail ? <CoachActivityAction state="view_activity" groupId={event.group_id} eventId={event.id}/> : undefined}>
     <div className={styles.notes}>
       <section><h3>{t("coach.followup.publicNote")}</h3><p>{coach?.player_note || "—"}</p></section>
       <section className={styles.privateNote}><h3>{t("coach.followup.privateNote")}</h3><p>{coach?.private_note || (privateNotes.length ? "" : "—")}</p>
         {privateNotes.map((note) => <div key={note.id}><p>{note.body}</p>{note.author_name ? <small>{note.author_name}</small> : null}</div>)}
       </section>
     </div>
     <div className={styles.evaluations}>
       <section><h3>{t("coach.followup.coachEvaluation")}</h3><div className={styles.scores}>
         {score(t("coachDebrief.engagement"), coach?.engagement)}
         {score(t("coachDebrief.attitude"), coach?.attitude)}
         {score(t("coachDebrief.application"), coach?.application)}
         {custom("coach")}
       </div></section>
       <section><h3>{t("coach.followup.selfEvaluation")}</h3><div className={styles.scores}>
         {score(t("common.motivation"), self?.motivation)}
         {score(t("common.difficulty"), self?.difficulty)}
         {score(t("common.satisfaction"), self?.satisfaction)}
         {custom("player")}
       </div>{self?.notes ? <p>{self.notes}</p> : null}</section>
     </div>
   </CoachActivityCard>;
 })}</div>;
}
