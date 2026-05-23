import Link from "next/link";

import { Footer } from "@/components/marketing/Footer";

export const metadata = {
  title: "Security — listbull",
  description:
    "How listbull encrypts passwords, isolates chats, and authenticates webhooks. Every claim linked to source on GitHub.",
};

type Claim = {
  title: string;
  body: string;
  link?: { label: string; href: string };
};

// Permalinks pin to the `dev` branch — all current code lives
// there; `main` is the initial scaffold. Swap to a specific commit
// SHA or to `main` once the merge happens.
const REPO = "https://github.com/buraksu42/listbull/blob/dev";

const SECTIONS: { heading: string; lead: string; claims: Claim[] }[] = [
  {
    heading: "1. Encryption at rest",
    lead: "AES-256-GCM via ENV_KEY. Plaintext never reaches the database, never enters the activity log, never appears in any log statement.",
    claims: [
      {
        title: "Algorithm",
        body: "AES-256-GCM with a 12-byte random IV per encryption and a 128-bit auth tag. Envelope format: base64(iv ‖ authTag ‖ ciphertext). Implementation is ~30 lines, uses node:crypto only.",
        link: {
          label: "encryption.ts",
          href: `${REPO}/src/lib/server/encryption.ts`,
        },
      },
      {
        title: "What's encrypted",
        body: "/password secret payloads land in items.secret_encrypted; per-chat BYOK OpenRouter keys land in chats.openrouter_api_key_encrypted. Both are TEXT columns holding the opaque envelope.",
        link: {
          label: "schema.ts (secret_encrypted)",
          href: `${REPO}/src/lib/db/schema.ts#L179`,
        },
      },
      {
        title: "Reveal flow",
        body: "Decryption happens lazily in reveal-secret.ts. Plaintext is sent as HTML <code> to Telegram for tap-to-copy, then the message auto-deletes after 15 seconds. The activity_log row records {label, suffix} only.",
        link: {
          label: "reveal-secret.ts",
          href: `${REPO}/src/lib/server/tools/reveal-secret.ts`,
        },
      },
    ],
  },
  {
    heading: "2. Multi-tenant isolation",
    lead: "Every Telegram chat is a tenant. No query reads or writes another chat's data; every callback handler verifies chat ownership before mutation.",
    claims: [
      {
        title: "Query scoping",
        body: "Every executor under src/lib/server/tools/ filters by ctx.chatId before any read or write. Search, create, update, complete, delete — same pattern.",
        link: {
          label: "search-items.ts (chatId filter)",
          href: `${REPO}/src/lib/server/tools/search-items.ts#L40`,
        },
      },
      {
        title: "Callback verification",
        body: "When the user taps an inline button like item:toggle:<uuid>, the handler enforces and(eq(items.id, uuid), eq(items.chatId, currentChatId)) before any mutation. A guessed UUID from another chat resolves to nothing.",
        link: {
          label: "item-action-callback.ts",
          href: `${REPO}/src/lib/server/bot/handlers/item-action-callback.ts#L130-L133`,
        },
      },
      {
        title: "Webhook authentication",
        body: "Every webhook request must carry the X-Telegram-Bot-Api-Secret-Token header. Verified with timingSafeEqual to prevent timing oracles.",
        link: {
          label: "webhook/route.ts",
          href: `${REPO}/src/app/api/telegram/webhook/route.ts#L67-L72`,
        },
      },
      {
        title: "Force-reply contexts",
        body: "Multi-step flows (e.g. saving a password) key on the composite (chatId, messageId) — never on messageId alone. Replay across chats is impossible.",
        link: {
          label: "bot-action-contexts.ts",
          href: `${REPO}/src/lib/db/queries/bot-action-contexts.ts#L62-L67`,
        },
      },
    ],
  },
  {
    heading: "3. In transit",
    lead: "HTTPS-only end-to-end; the app never listens on a public port directly.",
    claims: [
      {
        title: "TLS termination",
        body: "Docker Compose binds the app to 127.0.0.1:3000. A reverse proxy (Caddy / Traefik / Cloudflare) terminates TLS and forwards to localhost.",
      },
      {
        title: "Outbound calls",
        body: "Only two external destinations: Telegram (the chat surface) and OpenRouter (the LLM turn). No analytics outbound by default — Sentry + Umami are opt-in via build args.",
      },
    ],
  },
  {
    heading: "4. Logging discipline",
    lead: "No plaintext secret material is logged. The activity_log table is the only audit surface.",
    claims: [
      {
        title: "Decrypt failures",
        body: "If decryption errors, the log line records the itemId and a generic error message — never the ciphertext, never the key, never the plaintext.",
        link: {
          label: "reveal-secret.ts (error path)",
          href: `${REPO}/src/lib/server/tools/reveal-secret.ts#L81-L84`,
        },
      },
      {
        title: "Activity log payloads",
        body: "For secret events, payload_after records {label, secretSuffix} only. The encrypted blob is explicitly excluded.",
        link: {
          label: "handle-message.ts (secret_created payload)",
          href: `${REPO}/src/lib/server/bot/handle-message.ts#L1177-L1189`,
        },
      },
    ],
  },
];

export default function SecurityPage() {
  return (
    <main
      className="flex min-h-dvh flex-col"
      style={{ background: "var(--lb-bg)", color: "var(--lb-fg)" }}
    >
      <section className="mx-auto w-full max-w-3xl px-6 pt-20 sm:pt-28">
        <p
          className="mb-2 text-xs uppercase tracking-widest"
          style={{ color: "var(--lb-accent)" }}
        >
          Security
        </p>
        <h1
          className="text-balance text-3xl font-semibold sm:text-4xl"
          style={{ letterSpacing: "var(--lb-tracking-title)" }}
        >
          Every guarantee, linked to source.
        </h1>
        <p
          className="mt-4 max-w-2xl text-base sm:text-lg"
          style={{ color: "var(--lb-muted-fg)" }}
        >
          listbull stores your /password secrets and OpenRouter keys
          AES-256-GCM-encrypted; isolates every chat&rsquo;s data; and
          authenticates the Telegram webhook with a constant-time
          secret check. Click any link below to verify against the
          actual code.
        </p>
        <p className="mt-6 text-sm" style={{ color: "var(--lb-muted-fg)" }}>
          Full write-up:{" "}
          <a
            href={`https://github.com/buraksu42/listbull/blob/dev/SECURITY.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--lb-fg)" }}
          >
            SECURITY.md
          </a>
          . Report a vulnerability privately via{" "}
          <a
            href="https://github.com/buraksu42/listbull/security/advisories/new"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--lb-fg)" }}
          >
            GitHub Security Advisories
          </a>
          .
        </p>
      </section>

      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        {SECTIONS.map((sec) => (
          <section
            key={sec.heading}
            aria-labelledby={`sec-${sec.heading}`}
            className="mb-12"
          >
            <h2
              id={`sec-${sec.heading}`}
              className="mb-2 text-xl font-semibold sm:text-2xl"
              style={{ letterSpacing: "var(--lb-tracking-title)" }}
            >
              {sec.heading}
            </h2>
            <p
              className="mb-6 text-base"
              style={{ color: "var(--lb-muted-fg)" }}
            >
              {sec.lead}
            </p>
            <ul className="space-y-4">
              {sec.claims.map((c) => (
                <li
                  key={c.title}
                  className="rounded-2xl border p-5"
                  style={{
                    borderColor: "var(--lb-border)",
                    background: "var(--lb-card)",
                  }}
                >
                  <h3 className="mb-1 text-sm font-semibold">{c.title}</h3>
                  <p
                    className="mb-2 text-sm leading-relaxed"
                    style={{ color: "var(--lb-muted-fg)" }}
                  >
                    {c.body}
                  </p>
                  {c.link ? (
                    <a
                      href={c.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono underline-offset-4 hover:underline"
                      style={{ color: "var(--lb-accent)" }}
                    >
                      {c.link.label} ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div
          className="rounded-2xl border p-6"
          style={{
            borderColor: "var(--lb-border)",
            background: "var(--lb-subtle)",
          }}
        >
          <h2 className="mb-2 text-base font-semibold">What we don&rsquo;t promise</h2>
          <ul
            className="list-inside list-disc space-y-2 text-sm"
            style={{ color: "var(--lb-muted-fg)" }}
          >
            <li>
              The Telegram client itself is out of scope. Plaintext
              passwords pass through Telegram DMs during the save
              flow.
            </li>
            <li>
              The bot host machine is out of scope. If <code>ENV_KEY</code>
              {" "}leaks (host compromise, env dump), every encrypted blob
              can be decrypted. Treat the host as the trust boundary.
            </li>
            <li>
              Hardware-backed key storage (HSM, Vault) not yet
              supported. Future work.
            </li>
          </ul>
        </div>

        <p className="mt-10 text-center">
          <Link
            href="/"
            className="text-sm underline-offset-4 hover:underline"
            style={{ color: "var(--lb-muted-fg)" }}
          >
            ← Back to home
          </Link>
        </p>
      </div>

      <Footer />
    </main>
  );
}
