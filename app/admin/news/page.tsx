import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import AdminNewsWorkspace from "@/components/admin/news/AdminNewsWorkspace";

export default function AdminNewsPage() {
  return <SuperAdminGuard><AdminNewsWorkspace /></SuperAdminGuard>;
}
