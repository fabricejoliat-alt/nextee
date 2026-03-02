"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";

export default function ManagerOrganizationGroupNewPage() {
  const params = useParams<{ organizationId: string }>();
  const router = useRouter();
  const organizationId = String(params?.organizationId ?? "").trim();

  useEffect(() => {
    if (!organizationId) return;
    router.replace(`/manager/groups/new?organizationId=${encodeURIComponent(organizationId)}`);
  }, [organizationId, router]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="glass-card">
            <CompactLoadingBlock label="Chargement..." />
          </div>
        </div>
      </div>
    </div>
  );
}
