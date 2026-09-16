import CoachEditPage from "@/components/manager/CoachEditPage";

export default async function ManagerCoachEditPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  return <CoachEditPage memberId={memberId} />;
}
