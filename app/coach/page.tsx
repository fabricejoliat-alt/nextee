import RoleGuard from "@/components/auth/RoleGuard";

export default function CoachHome() {
  return (
    <RoleGuard allow="coach">
      <div style={{ padding: 24 }}>Espace Coach</div>
    </RoleGuard>
  );
}
