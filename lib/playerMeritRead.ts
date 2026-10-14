import { supabase } from "@/lib/supabaseClient";
export async function playerMeritRead<T>(organizationId:string,from:string,to:string,signal?:AbortSignal):Promise<T[]> {
  const {data}=await supabase.auth.getSession();
  const child=new URL(window.location.href).searchParams.get("child_id")?.trim() || localStorage.getItem("parent:selected_child_id")?.trim();
  const params=new URLSearchParams({organization_id:organizationId,from,to});
  if(child)params.set("child_id",child);
  const response=await fetch(`/api/player/merit-ranking?${params}`,{headers:{Authorization:`Bearer ${data.session?.access_token??""}`},cache:"no-store",signal});
  if(!response.ok)throw new Error("Unable to load ranking");
  return (await response.json()).rows as T[];
}
