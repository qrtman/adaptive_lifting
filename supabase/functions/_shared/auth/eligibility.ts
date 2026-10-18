import { ApiError } from "../errors/mod.ts";
import type { AppUser } from "../types/mod.ts";

export function requiresVerification(
  user: AppUser,
  enforceLegacy: boolean,
): boolean {
  if (user.email_verified_at !== null || user.google_sub !== null) return false;
  if (user.email_verification_legacy_exempt) return enforceLegacy;
  return user.email_verification_required;
}

export function requireEligibleAccount(
  user: AppUser | null,
  enforceLegacy: boolean,
): asserts user is AppUser {
  if (!user || user.deleted_at !== null) {
    throw new ApiError(403, "This account is unavailable");
  }
  if (requiresVerification(user, enforceLegacy)) {
    throw new ApiError(403, {
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Verify your email before signing in.",
    });
  }
}
