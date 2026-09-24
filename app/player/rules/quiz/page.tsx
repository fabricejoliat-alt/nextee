"use client";
/* eslint-disable @next/next/no-img-element -- editorial images can use administrator-configured HTTPS hosts */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Clock3, HelpCircle, Lightbulb, Medal, ShieldCheck, Sparkles, Timer, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import styles from "./PlayerRulesQuiz.module.css";

type Question = { position: number; question_id: string; prompt: string; image_url: string | null; image_alt: string; options: Array<{ id: string; label: string }>; answered: boolean; selected_option_ids: string[] };
type ResultOption = { id: string; label: string; correct: boolean; explanation: string };
type ResultQuestion = { position: number; prompt: string; correct: boolean; explanation: string; selected: string[]; options: ResultOption[] };
type Result = { score: number; correct: number; base: number; speed_bonus: number; perfect_bonus: number; questions?: ResultQuestion[] };
const TOTAL_QUESTIONS = 6;

export default function RulesQuizPage() {
  const searchParams = useSearchParams();
  const requestedSeriesId = searchParams.get("series_id") ?? "";
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const [context, setContext] = useState<{ seriesId: string; clubId: string } | null>(null);
  const [attempt, setAttempt] = useState("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [position, setPosition] = useState(1);
  const [choice, setChoice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const query = requestedSeriesId ? `?series_id=${encodeURIComponent(requestedSeriesId)}` : "";
        const response = await fetch(`/api/rules/overview${query}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.currentSeriesId || !payload.clubId) {
          setError(pickLocaleText(locale, "Le quiz n’est pas disponible.", "The quiz is unavailable."));
          return;
        }
        setContext({ seriesId: payload.currentSeriesId, clubId: payload.clubId });
        if (payload.quizAttempt?.status === "submitted" && payload.quizAttempt.id) {
          const attemptId = String(payload.quizAttempt.id);
          const { data: quizResult, error: resultError } = await supabase.rpc("get_rules_quiz_result", { p_attempt_id: attemptId });
          if (resultError) throw resultError;
          setAttempt(attemptId);
          setResult(quizResult as Result);
        }
      } catch {
        setError(pickLocaleText(locale, "Le quiz n’est pas disponible.", "The quiz is unavailable."));
      } finally {
        setLoading(false);
      }
    })();
  }, [locale, requestedSeriesId]);

  async function show(attemptId: string, next: number) {
    const { data, error: rpcError } = await supabase.rpc("get_rules_quiz_question", { p_attempt_id: attemptId, p_position: next });
    if (rpcError) { setError(rpcError.message); return; }
    setPosition(next);
    setQuestion(data as Question);
    setChoice(((data as Question).selected_option_ids ?? [])[0] ?? "");
  }

  async function start() {
    if (!context) return;
    setBusy(true); setError("");
    const { data, error: rpcError } = await supabase.rpc("start_rules_quiz", { p_series_id: context.seriesId, p_club_id: context.clubId });
    if (rpcError) setError(rpcError.message);
    else { const id = String(data); setAttempt(id); await show(id, 1); }
    setBusy(false);
  }

  async function save() {
    if (!question || !choice) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("answer_rules_quiz_question", { p_attempt_id: attempt, p_question_id: question.question_id, p_option_ids: [choice] });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    if (position < TOTAL_QUESTIONS) await show(attempt, position + 1);
    else {
      const { data, error: submitError } = await supabase.rpc("submit_rules_quiz", { p_attempt_id: attempt });
      if (submitError) setError(submitError.message);
      else {
        const details = await supabase.rpc("get_rules_quiz_result", { p_attempt_id: attempt });
        if (details.error) setError(details.error.message);
        else setResult((details.data ?? data) as Result);
      }
    }
    setBusy(false);
  }

  return <main className={styles.page} aria-busy={loading || busy}>
    <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: tr("Règles de golf", "Golf rules"), href: "/player/rules" }, { label: tr("Quiz officiel", "Official quiz") }]} />
    <header className={styles.topline}><div><h1>{tr("Quiz officiel", "Official quiz")}</h1><p className={styles.lead}>{tr("Teste tes connaissances : tes points alimentent ton pourcentage de maîtrise pour la saison.", "Test your knowledge: your points contribute to your season mastery percentage.")}</p></div></header>

    {loading && <QuizLoading label={tr("Préparation du quiz…", "Preparing the quiz…")} />}

    {!loading && !error && busy && !question && !result && <QuizLoading label={tr("Chargement de la première question…", "Loading the first question…")} />}

    {!loading && error && <section className={styles.messageCard} role="alert"><span className={styles.messageIcon}><CircleAlert size={24} /></span><div><span className={styles.eyebrow}>{tr("Quiz officiel", "Official quiz")}</span><h2>{tr("Le quiz n’est pas accessible", "The quiz is unavailable")}</h2><p>{error}</p><Link href="/player/rules" className={styles.secondaryButton}><ArrowLeft size={16} />{tr("Retour aux règles", "Back to rules")}</Link></div></section>}

    {!loading && !error && !busy && !attempt && !result && <section className={styles.introCard}>
      <div className={styles.introCopy}>
        <span className={styles.eyebrow}><ShieldCheck size={15} />{tr("Une tentative officielle", "One official attempt")}</span>
        <h2>{tr("Prêt pour le quiz du mois ?", "Ready for this month’s quiz?")}</h2>
        <p>{tr("Réponds aux six questions de la série. Le chrono démarre uniquement lorsque chaque question est affichée.", "Answer the six questions in the series. Timing starts only once each question is displayed.")}</p>
        <div className={styles.factGrid}>
          <div><span><HelpCircle size={18} /></span><strong>6</strong><small>{tr("questions", "questions")}</small></div>
          <div><span><Medal size={18} /></span><strong>100</strong><small>{tr("points par réponse", "points per answer")}</small></div>
          <div><span><Timer size={18} /></span><strong>+15</strong><small>{tr("bonus rapidité", "speed bonus")}</small></div>
          <div><span><Sparkles size={18} /></span><strong>+50</strong><small>{tr("bonus sans-faute", "perfect bonus")}</small></div>
        </div>
        <button disabled={!context || busy} onClick={() => void start()} className={styles.primaryButton}>{busy ? tr("Préparation…", "Preparing…") : tr("Démarrer le quiz", "Start the quiz")}<ArrowRight size={16} /></button>
      </div>
      <div className={styles.introArt} aria-hidden="true"><span className={styles.artSparkle}><Sparkles size={19} /></span><span className={styles.artTrophy}><Trophy size={57} strokeWidth={1.7} /></span><span className={styles.artScore}>650<small>pts</small></span></div>
    </section>}

    {!loading && !error && question && !result && <section className={styles.questionCard}>
      <div className={styles.questionTop}><div className={styles.questionLabel}><span><HelpCircle size={17} /></span><div><small>{tr("Quiz du mois", "Monthly quiz")}</small><strong>{tr("Question", "Question")} {position} {tr("sur", "of")} {TOTAL_QUESTIONS}</strong></div></div><span className={styles.progressValue}>{Math.round((position / TOTAL_QUESTIONS) * 100)}%</span></div>
      <div className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${(position / TOTAL_QUESTIONS) * 100}%` }} /></div>
      <div className={styles.questionBody}>
        <h2>{question.prompt}</h2>
        {question.image_url && <div className={styles.questionImage}><img src={question.image_url} alt={question.image_alt} /></div>}
        <fieldset className={styles.answers} disabled={busy}><legend className={styles.srOnly}>{tr("Choisis une réponse", "Choose an answer")}</legend>{question.options.map((option, index) => <label key={option.id} className={`${styles.answer} ${choice === option.id ? styles.answerSelected : ""}`}><input type="radio" name="answer" checked={choice === option.id} onChange={() => setChoice(option.id)} /><span className={styles.answerLetter}>{String.fromCharCode(65 + index)}</span><span className={styles.answerText}>{option.label}</span><CheckCircle2 className={styles.answerCheck} size={20} /></label>)}</fieldset>
      </div>
      <div className={styles.questionFooter}><span><Clock3 size={15} />{tr("Prends le temps de bien lire", "Take time to read carefully")}</span><button disabled={!choice || busy} onClick={() => void save()} className={styles.primaryButton}>{busy ? tr("Enregistrement…", "Saving…") : position === TOTAL_QUESTIONS ? tr("Terminer le quiz", "Finish the quiz") : tr("Question suivante", "Next question")}<ArrowRight size={16} /></button></div>
    </section>}

    {!loading && !error && result && <section className={styles.resultCard}>
      <div className={styles.resultSummary}><span className={styles.resultIcon}><Trophy size={34} /></span><span className={styles.eyebrow}>{tr("Quiz terminé", "Quiz complete")}</span><h2>{result.score} <small>points</small></h2><p>{tr("Bravo, ton résultat est enregistré dans ton classement de saison. Ta participation reste visible jusqu’à ton classement définitif.", "Well done, your result is saved in your season ranking. Your participation remains visible until you become fully ranked.")}</p><div className={styles.resultStats}><div><CheckCircle2 size={18} /><strong>{result.correct}/{TOTAL_QUESTIONS}</strong><small>{tr("bonnes réponses", "correct answers")}</small></div><div><Timer size={18} /><strong>+{result.speed_bonus}</strong><small>{tr("bonus rapidité", "speed bonus")}</small></div><div><Sparkles size={18} /><strong>+{result.perfect_bonus}</strong><small>{tr("bonus sans-faute", "perfect bonus")}</small></div></div><Link href={requestedSeriesId ? `/player/rules?series_id=${encodeURIComponent(requestedSeriesId)}` : "/player/rules"} className={styles.primaryButton}>{tr("Retour aux règles", "Back to rules")}<ArrowRight size={16} /></Link></div>
      {result.questions && result.questions.length > 0 && <div className={styles.review}>
        <div className={styles.reviewHeading}><span className={styles.eyebrow}>{tr("Correction", "Review")}</span><h3>{tr("Revoir tes réponses", "Review your answers")}</h3></div>
        <div className={styles.reviewList}>{result.questions.map((item) => <article className={styles.reviewItem} key={item.position}>
          <span className={item.correct ? styles.reviewCorrect : styles.reviewWrong}>{item.correct ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}</span>
          <div className={styles.reviewContent}>
            <small>{tr("Question", "Question")} {item.position}</small>
            <strong>{item.prompt}</strong>
            <div className={styles.reviewOptions}>{item.options.map((option, index) => {
              const selected = item.selected.includes(option.id);
              const optionClass = option.correct ? styles.reviewOptionCorrect : selected ? styles.reviewOptionWrong : "";
              return <div className={`${styles.reviewOption} ${optionClass}`} key={option.id}>
                <span className={styles.reviewOptionLetter}>{String.fromCharCode(65 + index)}</span>
                <div><span className={styles.reviewOptionLabel}>{option.label}</span>{(selected || option.correct) && option.explanation && <p className={styles.reviewOptionExplanation}>{option.explanation}</p>}</div>
                <span className={styles.reviewBadges}>{selected && <em className={styles.reviewBadgeAnswer}>{tr("Ma réponse", "My answer")}</em>}{option.correct && <em className={styles.reviewBadgeCorrect}>{tr("Bonne réponse", "Correct answer")}</em>}</span>
              </div>;
            })}</div>
            <div className={styles.reviewExplanation}><Lightbulb size={17} /><div><b>{tr("Le corrigé", "Explanation")}</b><p>{item.explanation}</p></div></div>
          </div>
        </article>)}</div>
      </div>}
    </section>}
  </main>;
}

function QuizLoading({ label }: { label: string }) {
  return <section className={styles.loadingGrid}>
    <div className={styles.loadingTile} aria-hidden="true"><span className={styles.loadingIcon} /><span className={styles.loadingTitle} /><span className={styles.loadingLine} /></div>
    <div className={styles.loadingTile} aria-hidden="true"><span className={styles.loadingIcon} /><span className={styles.loadingTitle} /><span className={styles.loadingLine} /></div>
    <div className={styles.loadingTile} aria-hidden="true"><span className={styles.loadingIcon} /><span className={styles.loadingTitle} /><span className={styles.loadingLine} /></div>
    <span className={styles.srOnly} role="status">{label}</span>
  </section>;
}
