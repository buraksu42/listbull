import Link from "next/link";

import { CommandList } from "@/components/marketing/CommandList";
import { Footer } from "@/components/marketing/Footer";

export const metadata = {
  title: "Use the bot — listbull",
  description:
    "Open @listbull_bot in Telegram. Full slash-command reference and example flows for DM + group use.",
};

type Example = {
  title: string;
  steps: { you: string; bot: string }[];
};

const EXAMPLES: Example[] = [
  {
    title: "DM — first 60 seconds",
    steps: [
      {
        you: "/start",
        bot: "Welcome message + 🎯 Hızlı tur button. Tap it for an 8-step walkthrough.",
      },
      {
        you: "süt al",
        bot: "✓ \"süt al\" eklendi. /items shows it.",
      },
      {
        you: "yarın 18'de fatura öde",
        bot: "✓ added with deadline tomorrow 18:00. Row gets 📅.",
      },
      {
        you: "süt al'ı 1 saat sonra hatırlat",
        bot: "🔔 reminder set. In 60 minutes, the bot DMs \"⏰ süt al\".",
      },
    ],
  },
  {
    title: "Checklist — gate-complete in action",
    steps: [
      {
        you: "haftalık temizlik: çamaşır, bulaşık, çöp",
        bot: "✓ created parent + 3 sub-items. /items shows parent with 📂 0/3.",
      },
      {
        you: "tap 📂 → toggle çamaşır ✅",
        bot: "Parent badge updates to 📂 1/3.",
      },
      {
        you: "haftalık temizlik tamamlandı",
        bot: "❌ 2 alt item açık: bulaşık, çöp. Önce onları bitir veya cascade onayı ver.",
      },
      {
        you: "(toggle remaining children)",
        bot: "Parent auto-✅. 📂 3/3 ✅.",
      },
    ],
  },
  {
    title: "/password — encrypted, self-destruct",
    steps: [
      {
        you: "/password (in DM only)",
        bot: "1/3 — Hangi etiketle saklayalım?",
      },
      {
        you: "gmail",
        bot: "2/3 — Kullanıcı adı / e-posta?",
      },
      {
        you: "(you reply with each step)",
        bot: "✅ kaydedildi. Suffix shown; encrypted blob stored AES-256-GCM.",
      },
      {
        you: "/password view gmail",
        bot: "🔒 username + password in <code> tags. Message self-destructs in 15s.",
      },
    ],
  },
  {
    title: "Group — ambient voice + tag assignment",
    steps: [
      {
        you: "(add @listbull_bot to group; /setprivacy Disable in BotFather)",
        bot: "Bot joins; welcome message.",
      },
      {
        you: "@listbull_bot raporu Burak'a ata",
        bot: "✓ created with #burak tag. /tag burak lists it.",
      },
      {
        you: "(record group voice: \"toplantı yarın 14:00\")",
        bot: "Silently adds item with deadline. No reply spam.",
      },
      {
        you: "(record group voice: \"havalar güzel\")",
        bot: "(no reply — nothing actionable in the transcript.)",
      },
    ],
  },
];

export default function UseTheBotPage() {
  return (
    <main
      className="flex min-h-dvh flex-col"
      style={{ background: "var(--lb-bg)", color: "var(--lb-fg)" }}
    >
      <section className="mx-auto w-full max-w-3xl px-6 pt-20 text-center sm:pt-28">
        <h1
          className="text-balance text-3xl font-semibold sm:text-4xl"
          style={{ letterSpacing: "var(--lb-tracking-title)" }}
        >
          Open the bot in Telegram
        </h1>
        <p
          className="mx-auto mt-4 max-w-xl text-base sm:text-lg"
          style={{ color: "var(--lb-muted-fg)" }}
        >
          listbull is fully chat-driven. No Mini App, no signup, no
          waitlist. Tap below; type a message; you have a to-do list.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
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
            Open @listbull_bot
          </a>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold transition hover:bg-[var(--lb-subtle)]"
            style={{ borderColor: "var(--lb-border)", color: "var(--lb-fg)" }}
          >
            ← Back to home
          </Link>
        </div>
      </section>

      <CommandList />

      <section
        aria-labelledby="lb-examples-title"
        className="mx-auto w-full max-w-4xl px-6 py-16"
      >
        <h2
          id="lb-examples-title"
          className="mb-2 text-center text-2xl font-semibold sm:text-3xl"
          style={{ letterSpacing: "var(--lb-tracking-title)" }}
        >
          Example flows
        </h2>
        <p
          className="mx-auto mb-12 max-w-2xl text-center text-base"
          style={{ color: "var(--lb-muted-fg)" }}
        >
          What it actually looks like in chat.
        </p>
        <div className="space-y-10">
          {EXAMPLES.map((ex) => (
            <article
              key={ex.title}
              className="rounded-2xl border p-6"
              style={{
                borderColor: "var(--lb-border)",
                background: "var(--lb-card)",
              }}
            >
              <h3 className="mb-4 text-lg font-semibold">{ex.title}</h3>
              <dl className="space-y-3">
                {ex.steps.map((step, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_2fr] sm:gap-3"
                  >
                    <dt
                      className="font-mono text-sm"
                      style={{ color: "var(--lb-fg)" }}
                    >
                      <span className="mr-2" aria-hidden>
                        👤
                      </span>
                      {step.you}
                    </dt>
                    <dd
                      className="text-sm"
                      style={{ color: "var(--lb-muted-fg)" }}
                    >
                      <span className="mr-2" aria-hidden>
                        🤖
                      </span>
                      {step.bot}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
