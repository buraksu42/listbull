/**
 * Group reply-threading middleware.
 *
 * In group / supergroup chats, every `ctx.reply(...)` call is wrapped
 * so it auto-quotes the user's triggering message. Effects:
 *   - Telegram clients render the bot's response as a threaded reply,
 *     so the conversation is easy to follow when multiple people talk.
 *   - The user can swipe-to-reply on the bot's response without
 *     re-typing the @-mention.
 *   - Combined with bot-privacy-mode-off (set by the operator in
 *     BotFather), this gives a fluid back-and-forth in groups.
 *
 * Scope:
 *   - Applies in `group` and `supergroup` only. DMs unaffected.
 *   - Applies to `ctx.reply` only (the common path). Direct
 *     `ctx.api.sendMessage(chatId, ...)` calls — e.g. the confirm
 *     sheets emitted inside callback handlers — are intentionally
 *     left alone; those messages already render in-context.
 *   - If the caller has already supplied `reply_parameters` or the
 *     legacy `reply_to_message_id`, we don't overwrite.
 */
import type { Context, MiddlewareFn } from "grammy";

export const groupReplyMiddleware: MiddlewareFn<Context> = async (
  ctx,
  next,
) => {
  const isGroup =
    ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
  const replyToMsgId = ctx.msg?.message_id;
  if (isGroup && replyToMsgId) {
    const origReply = ctx.reply.bind(ctx);
    ctx.reply = ((
      text: string,
      opts?: Parameters<typeof origReply>[1],
    ) => {
      const merged: Record<string, unknown> = { ...(opts ?? {}) };
      if (
        !("reply_parameters" in merged) &&
        !("reply_to_message_id" in merged)
      ) {
        merged.reply_parameters = {
          message_id: replyToMsgId,
          // If the user's message has been deleted by the time we
          // reply, still send rather than erroring.
          allow_sending_without_reply: true,
        };
      }
      return origReply(
        text,
        merged as Parameters<typeof origReply>[1],
      );
    }) as typeof ctx.reply;
  }
  await next();
};
