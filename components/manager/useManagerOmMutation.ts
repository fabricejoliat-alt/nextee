"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { omError, type OmKind } from "@/lib/managerOrderOfMerit";
export type OmWrite = { club: string; kind: OmKind; action: "create" | "delete" | "toggle" | "publish"; id?: string; expected?: string; payload: Record<string, unknown> };
type Receipt = { ok: true; id: string; action: string; replayed?: boolean; saved_rows?: number; bonus_rows?: number };

export function useManagerOmMutation(scope: string, onSaved: (result: Receipt) => void | Promise<void>) {
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
 const attempt=useRef<{ requestId:string; input:OmWrite } | null>(null),running=useRef(false),wasUncertain=useRef(false),version=useRef(0);
 useEffect(()=>{++version.current;attempt.current=null;running.current=false;wasUncertain.current=false;setBusy(false);setUncertain(false);setError("");return()=>{version.current+=1;};},[scope]);
 async function run(input?:OmWrite) {
  if(running.current || !scope) return;
  if(!attempt.current){if(!input)return;attempt.current={requestId:crypto.randomUUID(),input};}
  running.current=true;setBusy(true);setError("");const token=version.current;const request=attempt.current;
  try {
   const q=request.input;
   const {data,error:cause}=await supabase.rpc("write_manager_om_v1",{p_request_id:request.requestId,p_club_id:q.club,p_kind:q.kind,p_action:q.action,p_id:q.id??null,p_expected:q.expected??null,p_payload:q.payload});
   if(cause)throw cause;
   if(data?.ok!==true || typeof data.id!=="string" || data.action!==q.action)throw new Error("unconfirmed");
   if(token!==version.current)return;
   attempt.current=null;wasUncertain.current=false;setUncertain(false);
   // A refresh failure cannot turn a committed operation into a failed save.
   await onSaved(data as Receipt);
  }catch(cause){
   if(token!==version.current)return;
   if(!attempt.current){setError("refresh");return;}
   const failure=omError(cause);
   if(failure.definite&&!wasUncertain.current){attempt.current=null;setError(failure.key);}else{wasUncertain.current=true;setUncertain(true);setError("unconfirmed");}
  }finally{if(token===version.current){running.current=false;setBusy(false);}}
 }
 return {busy,uncertain,locked:busy||uncertain,error,run,retry:()=>run(),clearError:()=>setError("")};
}
