type Feature = {
  title: string;
  body: string;
};

type Category = {
  heading: string;
  lead: string;
  features: Feature[];
};

const CATEGORIES: Category[] = [
  {
    heading: "Capture",
    lead: "Everything in becomes an item. Type, forward, drop a voice note.",
    features: [
      {
        title: "Natural-language to-dos",
        body: "Type \"buy milk\" or \"tomorrow 9am dentist\" — the bot creates the item, sets the deadline, drops it on the list.",
      },
      {
        title: "Forward-to-capture",
        body: "Forward any Telegram message into the chat (DM or group, bot mentioned). Up to 20 distinct action items extracted in a single turn.",
      },
      {
        title: "Voice notes — DM",
        body: "Drop a voice message in DM. Transcribed via OpenRouter Gemini 2.5 Flash and routed through the same item-capture flow.",
      },
      {
        title: "Voice notes — group ambient",
        body: "In groups the bot listens to every voice note silently. To-dos surface as items; chatter never becomes a message. No reply spam, no token waste.",
      },
      {
        title: "Photo / document / file attachments",
        body: "Bot uploads attach to the most recently mentioned item. Stored as Telegram file_id references — zero local disk, zero S3 bill.",
      },
    ],
  },
  {
    heading: "Organize",
    lead: "Lists per chat. Checklists for multi-step work. Tags for everything.",
    features: [
      {
        title: "One list per Telegram chat",
        body: "Every chat (DM or group) is its own to-do context. /items shows the open list for the chat you're in.",
      },
      {
        title: "Checklists with gate-complete",
        body: "Group multi-step work under one umbrella. Parent can't close while any child is open — the bot blocks the action and surfaces the unfinished children.",
      },
      {
        title: "Cascade-archive on delete",
        body: "Delete a parent checklist; all open children are archived in the same transaction. Confirmation phrase explicitly states the child count.",
      },
      {
        title: "Memory mode",
        body: "Tickets, docs, receipts, warranties — long-lived keepsakes that never auto-archive. /memory lists them; deletion requires explicit confirmation.",
      },
      {
        title: "Tags",
        body: "Free-form tags by prefixing #. \"Buy bread #shopping\" lands tagged. /tag shopping filters the list to that tag's open items.",
      },
      {
        title: "Tag-based assignment",
        body: "\"Assign the report to Michael\" creates an item tagged #michael. /tag michael lists Michael's items. No per-user role grants, no permission UI to babysit.",
      },
      {
        title: "Smart views",
        body: "/today, /thisweek, /done, /reminders — pre-canned views, all chat-scoped. Replies stay tight: counts + tappable rows + the right action buttons.",
      },
    ],
  },
  {
    heading: "Remind",
    lead: "Natural-language scheduling. Routes to the right chat.",
    features: [
      {
        title: "Natural-language scheduling",
        body: "\"Remind me about the milk in 1 hour\" or \"remind me Friday 6pm\". Deadlines and reminders both get parsed from one sentence.",
      },
      {
        title: "Button preset menu",
        body: "Tap ⏰ on any item → preset offsets (5 min, 1 hr, tomorrow morning…). Faster than typing for routine intervals.",
      },
      {
        title: "Group-aware routing",
        body: "Reminders set on a DM item ring in DM. Reminders set on a group item ring in the group — so the whole team sees it.",
      },
      {
        title: "Multiple reminders per item",
        body: "Stack reminders (\"30 min before deadline\" + \"day-of 9am\"). Each item carries its own independent list — no global digest noise.",
      },
      {
        title: "Recurring tasks — clone on complete",
        body: "Set daily / weekly / monthly / custom RRULE on any item via natural language (\"every day 9am vitamins\") or the 🔁 button next to ✏️. Completing a cycle archives the original to /done as the audit row and opens a fresh clone in /items — same text, reminders, attachments, with the deadline advanced to the next occurrence. No accidental loops, no manual recreate.",
      },
      {
        title: "Per-minute cron",
        body: "A separate cron container polls every 60 seconds and dispatches due reminders. Idempotent — never double-sends.",
      },
    ],
  },
  {
    heading: "Secrets, privacy, security",
    lead: "Credentials stay encrypted. Chat data stays in the chat.",
    features: [
      {
        title: "/password — encrypted vault",
        body: "Save credentials in a 3-step DM flow (label → username → password). AES-256-GCM at rest via ENV_KEY. Plaintext never reaches the database.",
      },
      {
        title: "15-second self-destruct reveal",
        body: "Asking for a password sends a Telegram message with HTML <code> tap-to-copy. The bot auto-deletes the message after 15 seconds.",
      },
      {
        title: "DM-save, group-aware reveal",
        body: "Save the secret in DM (always); the secret is scoped to its chat. Reveal works in the originating group as long as the requester is a chat member.",
      },
      {
        title: "Per-chat isolation",
        body: "Every database query is scoped to the Telegram chatId. Callback handlers verify (itemId, chatId) before any mutation — a guessed UUID from another chat resolves to nothing.",
      },
      {
        title: "Constant-time webhook auth",
        body: "The Telegram webhook authenticates via crypto.timingSafeEqual on the secret token header. No timing oracles, no header smuggling.",
      },
      {
        title: "Audit log",
        body: "Every mutation writes an activity_log row with payload_before / payload_after. Useful for undo, debugging, and explaining what the bot did.",
      },
    ],
  },
  {
    heading: "Conversation + onboarding",
    lead: "How the bot greets new users and lets you tune it.",
    features: [
      {
        title: "/onboarding — interactive walkthrough",
        body: "9 steps, edits a single message in place. Covers to-dos, checklists, recurring tasks, tags, reminders, /password, voice notes, /settings. Skip anytime.",
      },
      {
        title: "/settings",
        body: "One screen for language (TR / EN), notification toggle, date/time format, and your own OpenRouter key (set via force-reply paste; remove falls back to free tier).",
      },
      {
        title: "/reset",
        body: "Clears the LLM conversation history for this chat. Items, reminders, and memory are untouched — the bot just forgets the back-and-forth.",
      },
      {
        title: "Bilingual replies",
        body: "Bot replies in Turkish or English based on users.locale. Switch from /settings; bot remembers per-user, not per-chat.",
      },
    ],
  },
  {
    heading: "BYOK + free-tier model",
    lead: "Bring your own OpenRouter key, or use the operator's shared free tier.",
    features: [
      {
        title: "Free-tier on first message",
        body: "Without any key, the chat runs on the operator's shared OpenRouter key + a free model. Zero cost, basic quality. 100 messages/hour during trial.",
      },
      {
        title: "Voice off on free tier",
        body: "Voice transcription needs a paid audio model. The free tier silently rejects voice and tells the user to add a key for it.",
      },
      {
        title: "One key per chat",
        body: "Set your own OpenRouter key via /settings → 🔑. Stored AES-256-GCM-encrypted; only the chat owner can set or remove it. Rate limit lifts; voice unlocks; better models open.",
      },
      {
        title: "Per-user hourly cap",
        body: "Self-host operators set LISTBULL_PER_USER_HOURLY_MSG_LIMIT to prevent runaway spend from a noisy user. Hosted prod runs 100/hour on free tier.",
      },
    ],
  },
  {
    heading: "Self-host posture",
    lead: "Runs on a 5€ VPS. Yours to operate.",
    features: [
      {
        title: "One Docker compose stack",
        body: "postgres + app + cron. No managed dependencies. Bring your own reverse proxy (Caddy / Traefik / Cloudflare) for TLS.",
      },
      {
        title: "Cron auto-applies migrations",
        body: "Every cron container boot runs `drizzle-kit migrate` first (idempotent — already-applied migrations are skipped). New schema lands on the next deploy.",
      },
      {
        title: "Telemetry off by default",
        body: "Self-host setups don't ship a single byte to third parties. Sentry + Umami are opt-in via build args. Hosted prod.listbull.org runs both (cookieless Umami + Sentry crashes).",
      },
      {
        title: "Attachments live on Telegram CDN",
        body: "Bot only stores `telegram_file_id` references; the bytes never touch your disk. Zero storage cost, zero backup burden. (Bot token rotation invalidates all file_ids — plan the rotation.)",
      },
    ],
  },
];

export function FeatureGrid() {
  return (
    <>
      {CATEGORIES.map((cat) => (
        <section
          key={cat.heading}
          aria-labelledby={`cat-${cat.heading}`}
          className="section-block"
          style={{ paddingTop: 0 }}
        >
          <div className="container">
            <div className="section-head">
              <h2 id={`cat-${cat.heading}`}>{cat.heading}</h2>
              <p className="lead">{cat.lead}</p>
            </div>
            <ul
              className="features"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {cat.features.map((f) => (
                <li key={f.title} className="feature">
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </>
  );
}
