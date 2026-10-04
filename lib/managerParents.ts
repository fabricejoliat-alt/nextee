export type ManagerParent = {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  username: string | null;
  phone: string;
  is_active: boolean;
  can_manage: boolean;
  can_change_password: boolean;
  other_roles: string[];
  juniors: Array<{ player_id: string; member_id: string; name: string; shared: boolean }>;
};

export function managerParentName(parent: Pick<ManagerParent, "first_name" | "last_name">) {
  return [parent.first_name, parent.last_name].filter(Boolean).join(" ");
}
