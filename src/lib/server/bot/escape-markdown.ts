/**
 * Escape user-provided strings before embedding into MarkdownV2 messages.
 * Telegram MarkdownV2 reserves: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(input: string): string {
  return input.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (match) => `\\${match}`);
}
