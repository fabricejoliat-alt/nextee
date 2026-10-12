import { randomInt } from "node:crypto";

export function randomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*?";
  if (!Number.isInteger(length) || length < 6 || length > 128) throw new Error("Invalid password length");
  const password = Array.from({ length }, () => alphabet[randomInt(alphabet.length)]);
  password[0] = "ABCDEFGHJKLMNPQRSTUVWXYZ"[randomInt(24)];
  password[1] = "!@$%*?"[randomInt(6)];
  for (let index = password.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [password[index], password[other]] = [password[other], password[index]];
  }
  return password.join("");
}
