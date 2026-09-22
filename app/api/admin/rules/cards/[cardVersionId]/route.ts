import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function db(){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});}
async function authorize(req:NextRequest){const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";const database=db();const auth=await database.auth.getUser(token);if(auth.error||!auth.data.user)return {error:NextResponse.json({error:"Unauthorized"},{status:401})} as const;const admin=await database.from("app_admins").select("user_id").eq("user_id",auth.data.user.id).maybeSingle();if(admin.error||!admin.data)return {error:NextResponse.json({error:"Forbidden"},{status:403})} as const;return {database,userId:auth.data.user.id} as const;}

export async function GET(req:NextRequest,{params}:{params:Promise<{cardVersionId:string}>}){
  try{const access=await authorize(req);if("error" in access)return access.error;const {cardVersionId}=await params;const version=await access.database.from("rules_card_versions").select("*,rules_cards(*)").eq("id",cardVersionId).single();if(version.error)throw version.error;const questions=await access.database.from("rules_questions").select("*,rules_question_options(*)").eq("card_version_id",cardVersionId).order("kind").order("variant");if(questions.error)throw questions.error;return NextResponse.json({version:version.data,questions:questions.data??[]});}catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:"Unable to load card"},{status:500});}
}

export async function PATCH(req:NextRequest,{params}:{params:Promise<{cardVersionId:string}>}){
  try{const access=await authorize(req);if("error" in access)return access.error;const {cardVersionId}=await params;const body=await req.json().catch(()=>({}));
    if(body?.action==="save_question"){
      const question=body.question??{};
      const {data,error}=await access.database.rpc("admin_save_rules_question",{
        p_actor_user_id:access.userId,p_card_version_id:cardVersionId,
        p_question_id:question.id||null,p_kind:question.kind,p_variant:Number(question.variant),
        p_prompt:question.prompt,p_explanation:question.explanation,
        p_illustration_prompt:question.illustration_prompt,p_image_url:question.image_url||null,
        p_image_alt:question.image_alt,p_allows_multiple:Boolean(question.allows_multiple),
        p_editorial_status:question.editorial_status,p_options:question.options
      });
      if(error)throw error;
      return NextResponse.json({questionId:data});
    }
    if(body?.action==="delete_question"){
      if(!body.questionId)return NextResponse.json({error:"Question manquante."},{status:400});
      const {error}=await access.database.rpc("admin_delete_rules_question",{
        p_actor_user_id:access.userId,p_card_version_id:cardVersionId,p_question_id:body.questionId
      });
      if(error)throw error;
      return NextResponse.json({deleted:true});
    }
    const current=await access.database.from("rules_card_versions").select("*,rules_cards(*)").eq("id",cardVersionId).single();if(current.error)throw current.error;
    if(body?.action==="approve"){
      if(current.data.approved_at)return NextResponse.json({error:"Cette version est déjà approuvée."},{status:409});
      const questions=await access.database.from("rules_questions").select("*,rules_question_options(*)").eq("card_version_id",cardVersionId).eq("editorial_status","approved");if(questions.error)throw questions.error;
      const rows=questions.data??[];const practice=rows.filter(q=>q.kind==="practice").length;const official=rows.filter(q=>q.kind==="official").length;
      const questionsValid=rows.every(q=>String(q.prompt??"").trim()&&String(q.explanation??"").trim()&&String(q.image_alt??"").trim()&&q.rules_question_options.length>=3&&q.rules_question_options.length<=4&&q.rules_question_options.filter((option:{is_correct:boolean})=>option.is_correct).length>=(q.allows_multiple?1:1)&&(!q.allows_multiple?q.rules_question_options.filter((option:{is_correct:boolean})=>option.is_correct).length===1:true)&&q.rules_question_options.every((option:{label:string;explanation:string})=>option.label.trim()&&option.explanation.trim()));
      if(practice<1||official<2||!questionsValid)return NextResponse.json({error:"La fiche nécessite une question d’entraînement et deux variantes officielles approuvées, avec 3 ou 4 réponses expliquées."},{status:409});
      const textFields=["title","situation","simple_explanation","action_text","common_mistake","coach_tip","official_reference","reference_version","illustration_prompt","image_alt"];
      if(textFields.some(field=>!String(current.data[field]??"").trim()))return NextResponse.json({error:"Le contenu pédagogique est incomplet."},{status:409});
      const now=new Date().toISOString();const approved=await access.database.from("rules_card_versions").update({human_review_required:false,approved_by:access.userId,approved_at:now}).eq("id",cardVersionId).select("*").single();if(approved.error)throw approved.error;
      const cardApproved=await access.database.from("rules_cards").update({editorial_status:"approved"}).eq("id",current.data.card_id).select("*").single();if(cardApproved.error)throw cardApproved.error;
      await access.database.from("rules_admin_events").insert({actor_user_id:access.userId,entity_type:"card_version",entity_id:cardVersionId,action:"approved",details:{card_id:current.data.card_id}});return NextResponse.json({version:approved.data,card:cardApproved.data});
    }
    if(current.data.approved_at)return NextResponse.json({error:"Cette version approuvée est verrouillée. Une nouvelle version est nécessaire."},{status:409});
    const required=["title","situation","simple_explanation","action_text","common_mistake","coach_tip","official_reference","reference_version","illustration_prompt","image_alt"] as const;for(const field of required){if(!String(body?.[field]??"").trim())return NextResponse.json({error:`Le champ ${field} est obligatoire.`},{status:400});}
    const ageMin=Number(body.recommended_age_min),ageMax=Number(body.recommended_age_max);if(!Number.isInteger(ageMin)||!Number.isInteger(ageMax)||ageMin<4||ageMax>25||ageMax<ageMin)return NextResponse.json({error:"La tranche d’âge est invalide."},{status:400});
    const version=await access.database.from("rules_card_versions").update({title:String(body.title).trim(),situation:String(body.situation).trim(),simple_explanation:String(body.simple_explanation).trim(),action_text:String(body.action_text).trim(),common_mistake:String(body.common_mistake).trim(),coach_tip:String(body.coach_tip).trim(),official_reference:String(body.official_reference).trim(),reference_version:String(body.reference_version).trim(),illustration_prompt:String(body.illustration_prompt).trim(),image_url:String(body.image_url??"").trim()||null,image_alt:String(body.image_alt).trim(),image_credit:String(body.image_credit??"").trim()||null,image_status:["pending","approved","rejected"].includes(body.image_status)?body.image_status:"pending",human_review_required:true}).eq("id",cardVersionId).select("*").single();if(version.error)throw version.error;
    const card=await access.database.from("rules_cards").update({difficulty:["beginner","intermediate","advanced"].includes(body.difficulty)?body.difficulty:"beginner",recommended_age_min:ageMin,recommended_age_max:ageMax,editorial_status:"needs_review"}).eq("id",current.data.card_id).select("*").single();if(card.error)throw card.error;
    await access.database.from("rules_admin_events").insert({actor_user_id:access.userId,entity_type:"card_version",entity_id:cardVersionId,action:"updated",details:{card_id:current.data.card_id}});return NextResponse.json({version:version.data,card:card.data});
  }catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:"Unable to update card"},{status:500});}
}
