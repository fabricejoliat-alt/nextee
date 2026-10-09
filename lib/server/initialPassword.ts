import { randomInt } from "node:crypto";

export function randomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*?";
  if (!Number.isInteger(length) || length < 12 || length > 128) throw new Error("Invalid password length");
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}
