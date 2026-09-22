"use client";
/* eslint-disable @next/next/no-img-element -- editorial images can use administrator-configured HTTPS hosts */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import styles from "@/components/rules/RulesWorkspace.module.css";

type Question={position:number;question_id:string;prompt:string;image_url:string|null;image_alt:string;options:Array<{id:string;label:string}>;answered:boolean;selected_option_ids:string[]};
type Result={score:number;correct:number;base:number;speed_bonus:number;perfect_bonus:number;questions?:Array<{position:number;prompt:string;correct:boolean;explanation:string}>};

export default function RulesQuizPage(){
  const {locale}=useI18n(); const tr=(fr:string,en:string)=>pickLocaleText(locale,fr,en);
  const [context,setContext]=useState<{seriesId:string;clubId:string}|null>(null); const [attempt,setAttempt]=useState(""); const [question,setQuestion]=useState<Question|null>(null); const [position,setPosition]=useState(1); const [choice,setChoice]=useState(""); const [result,setResult]=useState<Result|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  useEffect(()=>{void (async()=>{const {data}=await supabase.auth.getSession();const res=await fetch("/api/rules/overview",{headers:{Authorization:`Bearer ${data.session?.access_token??""}`}});const json=await res.json().catch(()=>({}));if(res.ok&&json.currentSeriesId&&json.clubId)setContext({seriesId:json.currentSeriesId,clubId:json.clubId});else setError(tr("Le quiz n’est pas disponible.","The quiz is unavailable."));})();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function show(attemptId:string,next:number){const {data,error:rpcError}=await supabase.rpc("get_rules_quiz_question",{p_attempt_id:attemptId,p_position:next});if(rpcError){setError(rpcError.message);return;}setPosition(next);setQuestion(data as Question);setChoice(((data as Question).selected_option_ids??[])[0]??"");}
  async function start(){if(!context)return;setBusy(true);setError("");const {data,error:rpcError}=await supabase.rpc("start_rules_quiz",{p_series_id:context.seriesId,p_club_id:context.clubId});if(rpcError)setError(rpcError.message);else{const id=String(data);setAttempt(id);await show(id,1);}setBusy(false);}
  async function save(){if(!question||!choice)return;setBusy(true);const {error:rpcError}=await supabase.rpc("answer_rules_quiz_question",{p_attempt_id:attempt,p_question_id:question.question_id,p_option_ids:[choice]});if(rpcError){setError(rpcError.message);setBusy(false);return;}if(position<6)await show(attempt,position+1);else{const {data,error:submitError}=await supabase.rpc("submit_rules_quiz",{p_attempt_id:attempt});if(submitError)setError(submitError.message);else{const details=await supabase.rpc("get_rules_quiz_result",{p_attempt_id:attempt});setResult((details.data??data) as Result);}}setBusy(false);}
  return <main className={styles.page}><Link href="/player/rules" style={{display:"inline-flex",alignItems:"center",gap:6}}><ArrowLeft size={16}/>{tr("Retour aux règles","Back to rules")}</Link>
    {error&&<section className={styles.state}><CircleAlert/><h1>{tr("Quiz officiel","Official quiz")}</h1><p>{error}</p></section>}
    {!error&&!attempt&&!result&&<section className={styles.hero}><div><span><Clock3 size={16}/>{tr("Une tentative officielle","One official attempt")}</span><h1>{tr("Quiz du mois","Monthly quiz")}</h1><p>{tr("6 questions · 100 points par bonne réponse · jusqu’à 15 points de rapidité · 50 points pour un sans-faute. Le chrono démarre seulement lorsque chaque question est affichée.","6 questions · 100 points per correct answer · up to 15 speed points · 50 points for a perfect score. Timing starts only once each question is displayed.")}</p></div><button disabled={!context||busy} onClick={()=>void start()} className={styles.close} style={{position:"static",width:"auto",padding:"0 18px",borderRadius:10}}>{tr("Démarrer","Start")}</button></section>}
    {question&&!result&&<section className={styles.state} style={{justifyItems:"stretch",textAlign:"left"}}><span>{position}/6</span><h1>{question.prompt}</h1>{question.image_url&&<img src={question.image_url} alt={question.image_alt}/>}<div style={{display:"grid",gap:9}}>{question.options.map(option=><label key={option.id} style={{display:"flex",gap:10,padding:14,border:"1px solid #e3e9e2",borderRadius:12,cursor:"pointer"}}><input type="radio" name="answer" checked={choice===option.id} onChange={()=>setChoice(option.id)}/><span>{option.label}</span></label>)}</div><button disabled={!choice||busy} onClick={()=>void save()}>{position===6?tr("Soumettre définitivement","Submit final answers"):tr("Enregistrer et continuer","Save and continue")}</button></section>}
    {result&&<section className={styles.state}><Trophy/><h1>{result.score} points</h1><p>{result.correct}/6 · {tr("bonus rapidité","speed bonus")} {result.speed_bonus} · {tr("bonus sans-faute","perfect bonus")} {result.perfect_bonus}</p>{result.questions?.map(item=><article key={item.position} style={{width:"100%",maxWidth:650,padding:14,border:"1px solid #e3e9e2",borderRadius:12,textAlign:"left"}}><b>{item.correct?<CheckCircle2 size={16}/>:<CircleAlert size={16}/>} {item.prompt}</b><p>{item.explanation}</p></article>)}</section>}
  </main>;
}
