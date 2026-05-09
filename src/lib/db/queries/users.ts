import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { NewUser, User } from "@/lib/types";

export async function getUserByTelegramId(
  telegramId: number,
): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
  });
}

/** Fetch a user row by its primary key. Returns undefined if missing. */
export async function getUserById(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function upsertUserFromTelegram(input: {
  telegramId: number;
  telegramUsername: string | null;
  telegramFirstName: string;
  telegramLastName: string | null;
  telegramPhotoUrl: string | null;
  languageCode: string | null;
}): Promise<User> {
  const locale = input.languageCode === "tr" ? "tr" : "en";
  // TR-locale users get Europe/Istanbul; everyone else stays on the
  // schema default (UTC) until they pick a TZ in /settings. Without
  // this, the LLM defaults due_at to UTC and "yarın 21:00" is 3 hours
  // off for TR users.
  const timezone = locale === "tr" ? "Europe/Istanbul" : undefined;

  const insertValues: NewUser = {
    telegramId: input.telegramId,
    telegramUsername: input.telegramUsername,
    telegramFirstName: input.telegramFirstName,
    telegramLastName: input.telegramLastName,
    telegramPhotoUrl: input.telegramPhotoUrl,
    locale,
    ...(timezone ? { timezone } : {}),
  };

  const [row] = await db
    .insert(users)
    .values(insertValues)
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        telegramUsername: input.telegramUsername,
        telegramFirstName: input.telegramFirstName,
        telegramLastName: input.telegramLastName,
        telegramPhotoUrl: input.telegramPhotoUrl,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new Error("upsertUserFromTelegram: insert returned no row");
  }
  return row;
}
