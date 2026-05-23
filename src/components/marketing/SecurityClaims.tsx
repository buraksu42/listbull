import { ExternalIcon } from "@/components/marketing/BrandMark";

type Claim = {
  title: string;
  body: string;
  link?: { label: string; href: string };
};

type Section = {
  num: string;
  heading: string;
  lead: string;
  claims: Claim[];
};

const REPO = "https://github.com/buraksu42/listbull/blob/dev";

const SECTIONS: Section[] = [
  {
    num: "01",
    heading: "Encryption at rest",
    lead: "AES-256-GCM via ENV_KEY. Plaintext never reaches the database, never enters the activity log, never appears in any log statement.",
    claims: [
      {
        title: "Algorithm",
        body: "AES-256-GCM with a 12-byte random IV per encryption and a 128-bit auth tag. Envelope format: base64(iv ‖ authTag ‖ ciphertext). node:crypto only.",
        link: { label: "encryption.ts", href: `${REPO}/src/lib/server/encryption.ts` },
      },
      {
        title: "What's encrypted",
        body: "/password payloads in items.secret_encrypted; per-chat BYOK OpenRouter keys in chats.openrouter_api_key_encrypted. Both opaque envelope strings in TEXT columns.",
        link: {
          label: "schema.ts (secret_encrypted)",
          href: `${REPO}/src/lib/db/schema.ts#L179`,
        },
      },
      {
        title: "Reveal flow",
        body: "Decryption is lazy. Plaintext goes to Telegram as HTML <code> for tap-to-copy, then auto-deletes after 15 seconds. The activity_log row records {label, suffix} only.",
        link: {
          label: "reveal-secret.ts",
          href: `${REPO}/src/lib/server/tools/reveal-secret.ts`,
        },
      },
    ],
  },
  {
    num: "02",
    heading: "Multi-tenant isolation",
    lead: "Every Telegram chat is a tenant. No query reads or writes another chat's data; every callback handler verifies chat ownership before mutation.",
    claims: [
      {
        title: "Query scoping",
        body: "Every executor under src/lib/server/tools/ filters by ctx.chatId before any read or write. Search, create, update, complete, delete — same pattern.",
        link: {
          label: "search-items.ts",
          href: `${REPO}/src/lib/server/tools/search-items.ts#L40`,
        },
      },
      {
        title: "Callback verification",
        body: "When a user taps an inline button like item:toggle:<uuid>, the handler enforces and(eq(items.id, uuid), eq(items.chatId, currentChatId)) before mutation. A guessed UUID from another chat resolves to nothing.",
        link: {
          label: "item-action-callback.ts",
          href: `${REPO}/src/lib/server/bot/handlers/item-action-callback.ts#L130-L133`,
        },
      },
      {
        title: "Webhook authentication",
        body: "Every webhook request must carry X-Telegram-Bot-Api-Secret-Token. Verified with timingSafeEqual to prevent timing oracles.",
        link: {
          label: "webhook/route.ts",
          href: `${REPO}/src/app/api/telegram/webhook/route.ts#L67-L72`,
        },
      },
      {
        title: "Force-reply contexts",
        body: "Multi-step flows (e.g. saving a password) key on the composite (chatId, messageId) — never on messageId alone. Replay across chats impossible.",
        link: {
          label: "bot-action-contexts.ts",
          href: `${REPO}/src/lib/db/queries/bot-action-contexts.ts#L62-L67`,
        },
      },
    ],
  },
  {
    num: "03",
    heading: "In transit",
    lead: "HTTPS-only end-to-end; the app never listens on a public port directly.",
    claims: [
      {
        title: "TLS termination",
        body: "Docker Compose binds the app to 127.0.0.1:3000. A reverse proxy (Caddy / Traefik / Cloudflare) terminates TLS and forwards to localhost.",
      },
      {
        title: "Outbound calls",
        body: "Two external destinations: Telegram (the chat surface) and OpenRouter (the LLM turn). No analytics outbound by default — Sentry + Umami are opt-in via build args.",
      },
    ],
  },
  {
    num: "04",
    heading: "Logging discipline",
    lead: "No plaintext secret material is logged. The activity_log table is the only audit surface.",
    claims: [
      {
        title: "Decrypt failures",
        body: "If decryption errors, the log line records itemId + a generic error message — never the ciphertext, never the key, never the plaintext.",
        link: {
          label: "reveal-secret.ts (error path)",
          href: `${REPO}/src/lib/server/tools/reveal-secret.ts#L81-L84`,
        },
      },
      {
        title: "Activity-log payloads",
        body: "For secret events, payload_after records {label, secretSuffix} only. The encrypted blob is explicitly excluded.",
        link: {
          label: "handle-message.ts (secret_created)",
          href: `${REPO}/src/lib/server/bot/handle-message.ts#L1177-L1189`,
        },
      },
    ],
  },
];

export function SecurityClaims() {
  return (
    <div className="container">
      {SECTIONS.map((sec) => (
        <section key={sec.num} className="claim" aria-labelledby={`sec-${sec.num}`}>
          <div className="claim-head">
            <span className="claim-num">{sec.num}</span>
            <h2 id={`sec-${sec.num}`}>{sec.heading}</h2>
            <p className="lead">{sec.lead}</p>
          </div>
          <div className="claim-cards">
            {sec.claims.map((c) => (
              <div key={c.title} className="claim-card">
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                {c.link ? (
                  <a
                    className="permalink"
                    href={c.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {c.link.label}
                    <ExternalIcon />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      <aside className="disclaimer" aria-label="What we don't promise">
        <h2>What we don&rsquo;t promise</h2>
        <ul>
          <li>
            The Telegram client itself is out of scope. Plaintext
            passwords pass through Telegram DMs during the save
            flow.
          </li>
          <li>
            The bot host machine is out of scope. If <code>ENV_KEY</code>{" "}
            leaks (host compromise, env dump), every encrypted blob
            can be decrypted. Treat the host as the trust boundary.
          </li>
          <li>
            Hardware-backed key storage (HSM, Vault) not yet
            supported. Future work.
          </li>
        </ul>
      </aside>
    </div>
  );
}
