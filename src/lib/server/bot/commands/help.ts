import type { Context } from "grammy";

import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale, t } from "@/lib/server/bot/i18n";

export async function handleHelp(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await getUserByTelegramId(from.id);
  const locale = pickLocale(user?.locale ?? from.language_code ?? null);
  const tr = t(locale);

  await ctx.reply(tr.help);
}
