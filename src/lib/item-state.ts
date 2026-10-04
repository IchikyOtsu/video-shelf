import { createHash } from "node:crypto";

export function deterministicItemStateId(userId: string, itemId: string) {
  const hex = createHash("sha256").update(userId + ":" + itemId).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
