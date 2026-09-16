import PlayerEditPage from "@/components/manager/PlayerEditPage";

export default async function ManagerPlayerEditPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  return <PlayerEditPage memberId={memberId} />;
}
