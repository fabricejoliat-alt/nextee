"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import OrganizationGroupsBoard from "@/components/admin/organizations/OrganizationGroupsBoard";

export default function OrganizationGroupsPage() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;

  return (
    <SuperAdminGuard>
      <div style={{ display: "grid", gap: 14 }}>
        <div className="card">
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Gestion des groupes</h1>
          <p style={{ marginTop: 6, color: "var(--muted)" }}>
            Drag & drop: un drag depuis un groupe vers un autre fait un transfert (retire de la source + ajoute à la cible).
            Un drag depuis la liste globale ajoute au groupe cible sans retirer des autres groupes.
          </p>
          <div style={{ marginTop: 8 }}>
            <Link className="btn" href={`/admin/organizations/${organizationId}`}>
              Retour à l’organisation
            </Link>
          </div>
        </div>

        <OrganizationGroupsBoard organizationId={organizationId} />
      </div>
    </SuperAdminGuard>
  );
}
