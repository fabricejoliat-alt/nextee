"use client";

import { useParams } from "next/navigation";
import OrganizationGroupsBoard from "@/components/admin/organizations/OrganizationGroupsBoard";

export default function ManagerOrganizationGroupsPage() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;
  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div />
            <div className="marketplace-actions" style={{ marginTop: 2 }} />
          </div>
        </div>

        <div className="glass-section">
          <OrganizationGroupsBoard organizationId={organizationId} />
        </div>
      </div>
    </div>
  );
}
