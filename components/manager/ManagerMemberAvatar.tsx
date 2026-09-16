import Image from "next/image";

export default function ManagerMemberAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "—";
  return <span className="user-mgmt-member-avatar" aria-hidden="true">{avatarUrl ? <Image src={avatarUrl} alt="" width={34} height={34} unoptimized /> : initials}</span>;
}
