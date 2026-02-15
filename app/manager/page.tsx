import RoleGuard from "@/components/auth/RoleGuard";

export default function ManagerHome() {
  return (
    <RoleGuard allow="manager">
      <div style={{ padding: 24 }}>Espace Manager</div>
    </RoleGuard>
  );
}
