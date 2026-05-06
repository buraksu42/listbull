/**
 * Forwarded-message system prompt for listbull's bot LLM turn.
 *
 * Phase 4 / A3 — when the user forwards a Telegram message to the bot,
 * the webhook router (`src/lib/server/bot/handle-message.ts`) detects
 * `update.message.forward_origin` and routes the text through THIS
 * prompt instead of the conversational `system.v2` / `system.v3`
 * prompts. The caller swaps the system prompt at call time:
 *
 *   import { forwardedMessagePrompt } from "@/lib/ai/prompts/forwarded";
 *   // ...
 *   const system = forwardedMessagePrompt({ userLocale, userFirstName,
 *     userTimezone, forwardedFrom, forwardedText });
 *   await respond({ messages, user, apiKey, model, toolDispatcher,
 *     systemOverride: system, ... });
 *
 * Identity is preserved (the assistant is still listbull), but this
 * turn is a SINGLE-PURPOSE extraction task — emit one `create_item`
 * tool call per detected action item, no conversational Q&A. The
 * standard tool-loop in `respond.ts` then fires the `create_item`
 * executors transactionally.
 *
 * Per Architect's Phase 4 contract § A3 + Inv-16:
 *   - Cap of ≤20 distinct action items per forward (refuse politely
 *     if the message clearly exceeds — surface "20'den fazla görev
 *     gördüm, ilk 20'sini ekledim" or equivalent).
 *   - Default target list: user's Inbox unless the forwarded text
 *     suggests a specific list (e.g. mentions "shopping list" /
 *     "alışveriş" → resolve via `create_item`'s `list_name` field; the
 *     executor's defensive resolution handles fuzzy match → Inbox
 *     fallback).
 *   - Tool policy: `create_item` only — no `search_items`,
 *     `update_item`, `complete_item`, `delete_item`, etc. (extraction
 *     is additive; nothing existing should be touched).
 *   - Forwarded text truncated at 6_000 chars before injection (head-
 *     preserve, tail-truncate with `... [truncated]` suffix).
 */

/** Inv-16: hard cap on extracted items per forward. */
export const FORWARDED_MAX_ITEMS = 20;

/** Inv-16: forwarded message text truncation threshold (chars). */
export const FORWARDED_TEXT_MAX_CHARS = 6000;

export type ForwardedMessagePromptInput = {
  userLocale: string;
  userFirstName: string;
  /** IANA timezone, e.g. "Europe/Istanbul". */
  userTimezone: string;
  /**
   * Display label for the original sender — channel name, sender's
   * first name, or "Bilinmeyen kaynak" if forward_origin's `type` is
   * `hidden_user`. Used for prompt context only; NOT stored in
   * `items.text` (per A3 spec — sender attribution is metadata).
   */
  forwardedFrom: string;
  /**
   * Raw forwarded message body. Truncated by this function to
   * `FORWARDED_TEXT_MAX_CHARS` before injection.
   */
  forwardedText: string;
};

/**
 * Truncate a forwarded message body to `FORWARDED_TEXT_MAX_CHARS`. We
 * head-preserve (keep the start, drop the tail) because forwarded
 * action-item dumps put the leading items first and the LLM is most
 * likely to find the highest-value items in the head. A clean
 * `... [truncated]` marker tells the LLM the text is incomplete.
 */
function truncateForwardedText(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= FORWARDED_TEXT_MAX_CHARS) {
    return { text, truncated: false };
  }
  const head = text.slice(0, FORWARDED_TEXT_MAX_CHARS);
  return { text: `${head}\n\n... [truncated]`, truncated: true };
}

/**
 * Build the listbull forwarded-message system prompt.
 * Pure string assembly — no I/O, no LLM call.
 *
 * NOTE: this prompt is invoked SEPARATELY from `system.v2` / `system.v3`.
 * The caller (Backend's `handle-message.ts` forwarded branch) swaps the
 * system prompt at call time and otherwise reuses the standard
 * `respond()` orchestration + tool-loop machinery in `src/lib/ai/respond.ts`.
 */
export function forwardedMessagePrompt(
  input: ForwardedMessagePromptInput,
): string {
  const {
    userLocale,
    userFirstName,
    userTimezone,
    forwardedFrom,
    forwardedText,
  } = input;
  const { text: safeText, truncated } = truncateForwardedText(forwardedText);
  const truncationNotice = truncated
    ? "\n\n(The forwarded message was longer than the cap; the trailing portion has been truncated.)"
    : "";
  const nowIso = new Date().toISOString();

  return `You are listbull, a helpful list assistant inside Telegram. You are talking with ${userFirstName} (locale: ${userLocale}, timezone: ${userTimezone}). Current UTC time is ${nowIso}.

# This turn is a single-purpose extraction task
The user just forwarded a Telegram message to you (forwarded from: ${forwardedFrom}). Your ONLY job this turn is to extract DISCRETE action items from the forwarded text and create one item per action via the \`create_item\` tool. This is NOT a conversational turn — do not answer questions about the message, do not summarize it narratively, do not editorialize. Extract → emit \`create_item\` calls → then write a brief confirmation reply.

# Extraction rules
- An "action item" is a concrete, individually-actionable task or note. "Süt al", "Sapiens kitabını oku", "Ali'yi ara" each = ONE item. Long descriptive paragraphs without explicit tasks = ZERO items (reply "Bu mesajda eyleme dönüştürülecek bir madde göremedim" or its English equivalent).
- Cap: extract at most ${FORWARDED_MAX_ITEMS} distinct items. If the forwarded text clearly contains more than ${FORWARDED_MAX_ITEMS} candidates, take the first ${FORWARDED_MAX_ITEMS} and tell the user in your reply ("${FORWARDED_MAX_ITEMS}'den fazla madde gördüm; ilk ${FORWARDED_MAX_ITEMS} tanesini ekledim" or English equivalent).
- One \`create_item\` call PER item — do not batch multiple items into one call's \`text\` field.
- Item text should be the action itself, lightly normalized (trim whitespace, drop bullet markers like "- " or "• ", keep capitalization natural). Do NOT include sender attribution — "Ali'den: süt al" should become just "süt al". Sender info is conversation context, not item content.

# Target list resolution
- DEFAULT target: the user's Inbox. If you do not pass \`list_id\` or \`list_name\`, the \`create_item\` executor places the item in Inbox.
- If the forwarded text contains an EXPLICIT list reference ("alışveriş listesi", "okuma listesi", "shopping list", "reading list"), pass \`list_name\` so the executor's defensive resolver can match it (exact → fuzzy → Inbox fallback). When in doubt, prefer Inbox — the user can move items later.
- Do NOT call \`list_lists\` to enumerate first; that's an unnecessary round-trip. Trust the executor's name resolution.

# Tool policy this turn
- Use ONLY \`create_item\`. Do NOT call \`search_items\`, \`update_item\`, \`complete_item\`, \`delete_item\`, \`list_lists\`, \`share_list\`, \`schedule_reminder\`, or \`assign_item\` — extraction is purely additive; nothing existing should be touched on a forwarded turn.
- Emit all \`create_item\` calls in a SINGLE turn (one round-trip). The bot's forwarded-path orchestration expects this; don't carry state across turns.
- If you detect a deadline phrasing in an action ("yarın 18:00'de Ali'yi ara"), pass \`due_at\` as ISO 8601 with the user's timezone offset (${userTimezone}) — same rules as a normal \`create_item\` call.

# Reply
After all \`create_item\` calls return, write ONE brief confirmation message in ${userLocale}: how many items were created and which list they landed in. Example: "${forwardedFrom}'tan gelen mesajdan 3 madde Inbox'a eklendi: süt, ekmek, peynir." Or in English: "I added 3 items from ${forwardedFrom}'s message to your Inbox: milk, bread, cheese." Keep it under 4 lines.

If you find ZERO action items in the forwarded text, do NOT call \`create_item\` at all — reply with a one-line note that the message had nothing actionable.

# Forwarded message text
"""
${safeText}
"""${truncationNotice}`;
}

export default forwardedMessagePrompt;
