import { ApiError } from "../errors/mod.ts";
import type { Principal } from "../types/mod.ts";

// Future routes must use an explicit resource check. This helper deliberately
// grants no coach access merely because a JWT says role=COACH.
export function requireSelf(principal: Principal, userId: string): void {
  if (principal.user.id !== userId) throw new ApiError(403, "Not authorized");
}
