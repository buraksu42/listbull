/**
 * `/reset` — clear conversation history for the current (user_id, chat_id).
 *
 * Two-step confirm flow:
 *   1. First `/reset`            → reply with "type /reset confirm to delete".
 *      The userId is recorded in an in-memory Map with a 60-second TTL.
 *   2. `/reset confirm` within 60s → DELETE messages WHERE user_id, chat_id.
 *
 * The in-memory map is per-process state — sufficient for Phase 3 (single
 * Next.js instance). Phase 4 may persist via a `pending_resets` table if
 * we run multiple instances behind a load balancer.
 */
import type { Context } from "grammy";

import { clearConversation } from "@/lib/db/queries/messages";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

const PENDING_TTL_MS = 60 * 1000;
const pendingResets = new Map<string, number>();

function pendingKey(userId: string, chatId: number): string {
  return `${userId}:${chatId}`;
}

const COPY = {
  tr: {
    needStart: "Önce /start yaz.",
    confirmAsk:
      "Tüm konuşma geçmişini silmek için `/reset confirm` yaz. (60 saniye içinde)",
    confirmExpired:
      "Onay süresi geçti. Yeniden /reset yazıp 60 saniye içinde `/reset confirm` ile onayla.",
    done: (n: number) => `${n} mesaj silindi. Konuşma geçmişin temiz.`,
    nothing: "Silinecek bir şey yoktu, konuşma zaten temiz.",
  },
  en: {
    needStart: "Run /start first.",
    confirmAsk:
      "Type `/reset confirm` to delete all conversation history. (within 60 seconds)",
    confirmExpired:
      "Confirmation timed out. Run /reset again and type `/reset confirm` within 60 seconds.",
    done: (n: number) => `Deleted ${n} messages. Your conversation history is clear.`,
    nothing: "Nothing to delete — conversation history is already empty.",
  },
} as const;

export async function handleReset(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply(COPY.en.needStart);
    return;
  }

  const locale = pickLocale(user.locale);
  const copy = COPY[locale];
  const chatId = message.chat.id;

  const arg =
    typeof ctx.match === "string"
      ? ctx.match.trim().toLowerCase()
      : Array.isArray(ctx.match)
        ? ctx.match.join(" ").trim().toLowerCase()
        : "";

  const key = pendingKey(user.id, chatId);
  const now = Date.now();

  // GC stale entries opportunistically.
  for (const [k, ts] of pendingResets) {
    if (ts < now - PENDING_TTL_MS) pendingResets.delete(k);
  }

  if (arg === "confirm") {
    const pending = pendingResets.get(key);
    if (!pending || pending < now - PENDING_TTL_MS) {
      pendingResets.delete(key);
      await ctx.reply(copy.confirmExpired, { parse_mode: "Markdown" });
      return;
    }
    pendingResets.delete(key);
    const deleted = await clearConversation(user.id, chatId);
    await ctx.reply(deleted > 0 ? copy.done(deleted) : copy.nothing);
    return;
  }

  // First /reset (or any non-confirm arg): set the pending window.
  pendingResets.set(key, now);
  await ctx.reply(copy.confirmAsk, { parse_mode: "Markdown" });
}
