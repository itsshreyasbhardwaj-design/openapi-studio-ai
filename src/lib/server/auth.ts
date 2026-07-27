import "server-only";
import { capabilities } from "./env";

export interface Identity {
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly provider: "clerk" | "local";
}

/** Stable identity used when Clerk is not configured (self-hosted / local dev). */
export const LOCAL_IDENTITY: Identity = {
  userId: "local-user",
  email: null,
  displayName: "Local Developer",
  provider: "local",
};

/**
 * Resolve the current identity.
 *
 * Clerk is imported dynamically so that the app builds and runs with the Clerk
 * environment variables completely absent — a hard requirement for the
 * zero-config open-source experience.
 */
export async function currentIdentity(): Promise<Identity> {
  if (capabilities().auth === "local") return LOCAL_IDENTITY;

  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return {
    userId,
    email,
    displayName: name || user?.username || email || "Member",
    provider: "clerk",
  };
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Authentication is required to access this resource.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Assert that an identity owns (or collaborates on) a resource. */
export function assertOwner(resourceOwnerId: string, identity: Identity): void {
  if (resourceOwnerId !== identity.userId) throw new ForbiddenError();
}
