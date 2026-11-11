import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

const SESSION_DAYS = 7;
const COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-session" : "session";

export type SessionUser = { id: string; email: string; name: string };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Used to keep login timing similar for unknown emails.
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash;
}

/** Verifies credentials and, on success, creates a server-side session. */
export async function login(email: string, password: string): Promise<boolean> {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : (await verifyPassword(password, await getDummyHash()), false);
  if (!user || !ok) return false;

  // Opportunistic cleanup of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId: user.id, expiresAt });

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

/** Resolves the current user from the session cookie only. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.delete(COOKIE_NAME);
}
