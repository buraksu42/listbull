import Link from "next/link";

/**
 * Landing hero — wordmark, tagline, two CTAs.
 *
 * Server component; no client JS. Bot CTA is the primary visual
 * action (filled accent button); self-host CTA is secondary (outline).
 */
export function Hero() {
  return (
    <section
      aria-labelledby="lb-hero-title"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 pb-16 pt-20 text-center sm:pt-28"
    >
      <span
        className="lb-wordmark text-[clamp(2.75rem,8vw,4.5rem)] leading-none"
        style={{ letterSpacing: "var(--lb-tracking-wordmark)" }}
      >
        listbull
      </span>
      <h1
        id="lb-hero-title"
        className="text-balance text-[clamp(1.5rem,4vw,2.25rem)] font-semibold leading-tight"
        style={{ letterSpacing: "var(--lb-tracking-title)" }}
      >
        Telegram-native AI to-do bot.
        <br className="hidden sm:inline" />
        <span style={{ color: "var(--lb-accent)" }}>
          {" "}Every chat is its own list.
        </span>
      </h1>
      <p
        className="max-w-xl text-balance text-base leading-relaxed sm:text-lg"
        style={{ color: "var(--lb-muted-fg)" }}
      >
        Send a message, drop a voice note, forward a recipe — the bot
        extracts items, schedules reminders, keeps your secrets
        encrypted. Bring your own OpenRouter key, or use the
        operator&rsquo;s free tier. Open source, self-hostable on a 5€ VPS.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <a
          href="https://t.me/listbull_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:opacity-90"
          style={{
            background: "var(--lb-accent)",
            color: "var(--lb-accent-fg)",
          }}
        >
          <span aria-hidden>💬</span>
          Try @listbull_bot
        </a>
        <a
          href="https://github.com/buraksu42/listbull"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold transition hover:bg-[var(--lb-subtle)]"
          style={{
            borderColor: "var(--lb-border)",
            color: "var(--lb-fg)",
          }}
        >
          <span aria-hidden>⚙️</span>
          Self-host on GitHub
        </a>
        <Link
          href="/use-the-bot"
          className="text-sm underline-offset-4 hover:underline"
          style={{ color: "var(--lb-muted-fg)" }}
        >
          See commands →
        </Link>
      </div>
    </section>
  );
}
