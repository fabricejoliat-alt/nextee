import { PLAYER_GUIDE_URL, renderFamilyTemplate, renderAccessInvitationBody, type AccessStatus, type FamilyMailConfig } from "./familyAccess.ts";

export type FamilyParent = { parent_user_id: string; parent_name: string; parent_username: string | null; parent_email: string | null; parent_status: AccessStatus; parent_last_sent_at: string | null; parent_last_activity_at: string | null; parent_send_count: number; linked_juniors: Array<{ junior_user_id: string; junior_name: string }> };
export type JuniorParent = { parent_user_id: string; parent_name: string; parent_email: string | null; relation: string | null; is_primary: boolean };
export type FamilyJunior = { junior_user_id: string; junior_name: string; junior_username: string | null; junior_email: string | null; parents: JuniorParent[]; recipient_kind: "junior" | "parent" | "selection_required" | "missing"; recipient_user_id: string | null; recipient_name: string | null; recipient_email: string | null; junior_status: AccessStatus; junior_last_sent_at: string | null; junior_last_activity_at: string | null; junior_send_count: number };
export type FamilyAccessData = { club: { id: string; name: string }; parents: FamilyParent[]; juniors: FamilyJunior[]; mail_config: FamilyMailConfig };
export type FamilySelection = { key: string; kind: "parent_access" | "junior_access"; parent_user_id?: string; junior_user_id?: string; recipient_user_id?: string };
export type FamilyAccessTarget = { selection: FamilySelection; name: string; recipient: string | null; recipientName: string | null; status: AccessStatus; canSend: boolean; sendCount: number };
export type FamilySendSummary = { sent: number; skipped: number; errors: Array<{ index: number; error: string }> };

export function parentAccessTarget(parent: FamilyParent): FamilyAccessTarget {
  return { selection: { key: `parent:${parent.parent_user_id}`, kind: "parent_access", parent_user_id: parent.parent_user_id }, name: parent.parent_name,
    recipient: parent.parent_email, recipientName: parent.parent_name, status: parent.parent_status,
    canSend: Boolean(parent.parent_email && parent.parent_username && parent.parent_status !== "not_ready"), sendCount: parent.parent_send_count };
}

/** A selected recipient must still be one of the authorized, emailable parents returned by the server. */
export function juniorAccessTarget(junior: FamilyJunior, selectedRecipient?: string): FamilyAccessTarget {
  const direct = Boolean(junior.junior_email);
  const parent = direct ? undefined : junior.parents.find(row => row.parent_user_id === (selectedRecipient ?? junior.recipient_user_id) && row.parent_email);
  const recipientId = direct ? junior.junior_user_id : parent?.parent_user_id;
  const recipient = direct ? junior.junior_email : parent?.parent_email ?? null;
  const canSend = Boolean(recipientId && recipient && junior.junior_username);
  const status = junior.junior_status === "not_ready" && canSend && junior.recipient_kind === "selection_required" ? "ready" : junior.junior_status;
  return { selection: { key: `junior:${junior.junior_user_id}`, kind: "junior_access", junior_user_id: junior.junior_user_id, recipient_user_id: recipientId },
    name: junior.junior_name, recipient, recipientName: direct ? junior.junior_name : parent?.parent_name ?? null,
    status, canSend: canSend && status !== "not_ready", sendCount: junior.junior_send_count };
}

/** These are illustrative links only. Previewing never creates a token or sends a message. */
export function familyAccessPreview(data: FamilyAccessData, target: FamilyAccessTarget) {
  const variables: Record<string, string> = { app_url: "https://www.activitee.golf/", player_guide_url: PLAYER_GUIDE_URL,
    reset_url: "https://www.activitee.golf/reset-password?invite_token=exemple", club_name: data.club.name };
  let subject: string, body: string;
  if (target.selection.kind === "parent_access") {
    const parent = data.parents.find(row => row.parent_user_id === target.selection.parent_user_id);
    if (!parent) return null;
    Object.assign(variables, { parent_name: parent.parent_name, parent_username: parent.parent_username ?? "", parent_username_or_existing: parent.parent_username ?? "" });
    subject = data.mail_config.parent_subject; body = data.mail_config.parent_body;
  } else {
    const junior = data.juniors.find(row => row.junior_user_id === target.selection.junior_user_id);
    if (!junior) return null;
    Object.assign(variables, { junior_name: junior.junior_name, junior_username: junior.junior_username ?? "", parent_name: junior.junior_email ? "" : target.recipientName ?? "" });
    subject = junior.junior_email ? data.mail_config.junior_direct_subject : data.mail_config.junior_parent_subject;
    body = junior.junior_email ? data.mail_config.junior_direct_body : data.mail_config.junior_parent_body;
  }
  return { subject: renderFamilyTemplate(subject, variables), body: renderAccessInvitationBody(body, variables) };
}

/** Do not report an empty/malformed HTTP success as a confirmed delivery result. */
export function familySendSummary(value: unknown, count: number): FamilySendSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as FamilySendSummary;
  if (!Number.isInteger(row.sent) || row.sent < 0 || !Number.isInteger(row.skipped) || row.skipped < 0 || !Array.isArray(row.errors)) return null;
  if (row.sent + row.skipped + row.errors.length !== count || row.errors.some(error => !Number.isInteger(error.index) || error.index < 0 || error.index >= count || typeof error.error !== "string")) return null;
  if (new Set(row.errors.map(error => error.index)).size !== row.errors.length) return null;
  return row;
}
