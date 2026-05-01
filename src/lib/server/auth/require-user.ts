import "server-only";

import { redirect } from "next/navigation";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { User } from "@/lib/types";
import { eq } from "drizzle-orm";

/**
 * Server-side: read session cookie, look up user, redirect to "/" if missing.
 * Use inside server components and route handlers that require auth.
 */
export async function requireUser(): Promise<User> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!row) redirect("/");

  return row;
}
