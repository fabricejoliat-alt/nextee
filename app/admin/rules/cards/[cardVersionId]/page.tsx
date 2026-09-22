import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import AdminRuleCardEditor from "@/components/admin/rules/AdminRuleCardEditor";

export default async function AdminRuleCardPage({params}:{params:Promise<{cardVersionId:string}>}){
  const {cardVersionId}=await params;
  return <SuperAdminGuard><AdminRuleCardEditor cardVersionId={cardVersionId}/></SuperAdminGuard>;
}
