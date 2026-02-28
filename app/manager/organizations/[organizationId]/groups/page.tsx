"use client";

import { useParams } from "next/navigation";
import OrganizationGroupsBoard from "@/components/admin/organizations/OrganizationGroupsBoard";

export default function ManagerOrganizationGroupsPage() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;
  return <OrganizationGroupsBoard organizationId={organizationId} />;
}

