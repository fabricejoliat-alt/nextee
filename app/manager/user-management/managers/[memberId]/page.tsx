import ManagerEditPage from "@/components/manager/ManagerEditPage";

export default async function ManagerEditManagerPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  return <ManagerEditPage memberId={memberId} />;
}
