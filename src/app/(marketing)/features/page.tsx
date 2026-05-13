import Link from "next/link";

import { Footer } from "@/components/marketing/footer";
import { GITHUB_URL } from "@/components/marketing/links";

export const metadata = {
  title: "Features — listbull",
  description:
    "Everything listbull does today: 29+ AI tools, voice + photo + inline mode, workspaces with roles, reminders + recurrence, daily digest, BYOK via OpenRouter, full TR + EN.",
};

/**
 * /features — capability catalog.
 *
 * Sections grouped by surface, each ~80-120 words. No Mini-App
 * screenshots — screenshot maintenance is recurring debt; v1 is
 * copy-only. The full LLM tool list is on GitHub, linked at the
 * end of section 1 so we don't have to keep this page in sync with
 * every new tool added.
 *
 * Visual treatment matches `/install`: numbered cards on a paper
 * background, anti-list strict.
 */
export default function FeaturesPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--lb-bg)",
        color: "var(--lb-fg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "var(--lb-sp-12) var(--lb-sp-4) var(--lb-sp-8)",
          textAlign: "center",
          maxWidth: 800,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-sm)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "var(--lb-sp-3)",
          }}
        >
          Capability catalog
        </p>
        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3.25rem)",
            fontWeight: "var(--lb-fw-bold)",
            letterSpacing: "var(--lb-tracking-title)",
            lineHeight: 1.15,
            marginBottom: "var(--lb-sp-4)",
          }}
        >
          What listbull does
        </h1>
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-lg)",
            lineHeight: 1.6,
          }}
        >
          A complete inventory of what&apos;s shipped today. Each capability
          is wired through the bot, the Mini App, or both — the
          interfaces stay in sync within 5 seconds.
        </p>
      </header>

      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "0 var(--lb-sp-4) var(--lb-sp-12)",
          width: "100%",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "var(--lb-sp-5)",
        }}
      >
        <FeatureCard title="AI tools you can call by chat">
          <p style={pStyle}>
            29+ LLM tools cover the full CRUD on items, lists,
            workspaces, members, invites, snapshots, deadlines,
            reminders, attachments, and checklists. Just talk: &ldquo;buy
            milk and eggs, due Friday, remind me Thursday at 6pm&rdquo; — the
            bot parses intent, calls the right tools in one
            transaction, and confirms what it did.
          </p>
          <p style={pStyle}>
            Each call writes an audit row with{" "}
            <code style={inlineCodeStyle}>payload_before</code> /{" "}
            <code style={inlineCodeStyle}>payload_after</code> JSONB —
            restore deleted items for 30 days.{" "}
            <a
              href={`${GITHUB_URL}/blob/main/src/lib/ai/tools.ts`}
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              Full tool list on GitHub →
            </a>
          </p>
        </FeatureCard>

        <FeatureCard title="Talk to it however you want">
          <ul style={listStyle}>
            <li>
              <strong>Text</strong> — Turkish or English, free-form.
            </li>
            <li>
              <strong>Voice / audio / video notes</strong> — transcribed
              via Gemini Flash, then processed as text. The{" "}
              <code style={inlineCodeStyle}>🎤</code> marker stays in
              history so reset-and-resume reads naturally.
            </li>
            <li>
              <strong>Forwarded messages</strong> — the bot extracts up
              to 20 distinct action items from forwards (recipes,
              meeting notes, channel posts).
            </li>
            <li>
              <strong>Photo / document attachments</strong> — attach to
              an item; Mini App shows a lightbox preview.
            </li>
            <li>
              <strong>Inline mode</strong> —{" "}
              <code style={inlineCodeStyle}>@listbull_bot foo</code> in
              any chat returns matching items + a Quick Create card to
              push <em>foo</em> into your active workspace&apos;s Inbox.
            </li>
          </ul>
        </FeatureCard>

        <FeatureCard title="Mini App">
          <p style={pStyle}>
            Inherits Telegram&apos;s theme automatically. Surfaces:
          </p>
          <ul style={listStyle}>
            <li>
              <strong>Inbox</strong> — today + overdue items across
              every list.
            </li>
            <li>
              <strong>Lists</strong> — drag-to-reorder items, edit
              sheet for text + deadline + reminders + attachments +
              assignee + tags.
            </li>
            <li>
              <strong>Smart views</strong> — Today / Week / Board
              (workspace-wide Kanban, filter by priority or assignee).
            </li>
            <li>
              <strong>Activity</strong> — append-only audit feed; click
              any deleted entity within 30 days to restore.
            </li>
            <li>
              <strong>Workspace & user settings</strong> — locale,
              timezone, date / time format, default LLM model, member
              roles, OpenRouter API key.
            </li>
          </ul>
        </FeatureCard>

        <FeatureCard title="Sharing with real roles">
          <p style={pStyle}>
            Two sharing layers, both via 7-day Telegram-DM invite links:
          </p>
          <ul style={listStyle}>
            <li>
              <strong>Workspaces</strong> with 5 roles — owner, admin,
              editor, viewer, guest. All members share lists, items,
              reminders, and activity feed.
            </li>
            <li>
              <strong>Lists</strong> with 3 roles — owner, editor,
              viewer. Independent of workspace role; you can be a
              workspace viewer but a list editor.
            </li>
            <li>
              <strong>Snapshots</strong> — HMAC-signed read-only URL,
              30-day expiry. Public, no login. Send to anyone.
            </li>
          </ul>
        </FeatureCard>

        <FeatureCard title="Reminders + deadlines">
          <p style={pStyle}>
            Deadlines and reminders are separate primitives. An item
            with no deadline can still have an absolute reminder. Each
            item can carry multiple reminders, each with its own
            optional recurrence rule (RRULE).
          </p>
          <p style={pStyle}>
            Cron polls every 60 seconds, so sub-minute offsets like
            &ldquo;remind me in 30 seconds&rdquo; work — they fire within ~60s of
            the requested moment. Recurring reminders auto-schedule the
            next occurrence after firing.
          </p>
        </FeatureCard>

        <FeatureCard title="Daily digest">
          <p style={pStyle}>
            Runs at 09:00 user-local. Pulls items with deadlines in the
            next 24 hours plus overdue items from the last 7 days,
            formats them with relative dates, and DMs the user. Skips
            empty days — no noise.
          </p>
          <p style={pStyle}>
            Toggle from user settings. Timezone-aware per-user, so a
            user in EST and a user in TRT both get theirs at local
            morning.
          </p>
        </FeatureCard>

        <FeatureCard title="BYOK via OpenRouter">
          <p style={pStyle}>
            One key per workspace, set by the owner in Workspace
            settings. AES-256-GCM encrypted at rest with the operator&apos;s{" "}
            <code style={inlineCodeStyle}>ENV_KEY</code>. 13 models in
            the picker (Claude Sonnet 4, Haiku 4.5, GPT-4.1 series,
            Gemini 2.5 Flash + Pro, and more); workspace owner picks
            the default model for their team.
          </p>
          <p style={pStyle}>
            No operator-key fallback: workspaces without a key get a
            polite &ldquo;set your key&rdquo; reply with the exact steps. Cost
            stays with the workspace owner.
          </p>
        </FeatureCard>

        <FeatureCard title="Background jobs">
          <ul style={listStyle}>
            <li>
              <strong>Reminder dispatcher</strong> — every 60s, sends
              due reminders, marks{" "}
              <code style={inlineCodeStyle}>sent=true</code> on success
              only (idempotent retry).
            </li>
            <li>
              <strong>Daily digest</strong> — 09:00 user-local,
              timezone-aware, skips empty days.
            </li>
            <li>
              <strong>Stale cleanup</strong> — once daily, prunes
              expired invites and audit rows ≥90 days old.
            </li>
            <li>
              <strong>Bot rate limit</strong> — per-user token bucket;
              spam doesn&apos;t reach the LLM.
            </li>
          </ul>
        </FeatureCard>

        <FeatureCard title="Open source + self-host">
          <p style={pStyle}>
            MIT licensed. Single Next.js app, Postgres, one cron
            container. No managed-cloud dependencies, no Vercel
            lock-in, no telemetry by default — Sentry and Umami are
            opt-in via env var.
          </p>
          <p style={pStyle}>
            Attachments stay on Telegram&apos;s CDN (no S3 needed). Backups
            via{" "}
            <code style={inlineCodeStyle}>pg_dump</code> to any
            S3-compatible bucket — example scripts in{" "}
            <a
              href={`${GITHUB_URL}/tree/main/docs`}
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              docs/
            </a>
            .
          </p>
        </FeatureCard>

        <FeatureCard title="Turkish + English, no compromises">
          <p style={pStyle}>
            Both locales reach 100% UI parity — CI fails if a key is
            missing from either side (151+ keys, growing). Locale
            is server-side, driven by{" "}
            <code style={inlineCodeStyle}>users.locale</code>, not by
            URL prefix.
          </p>
          <p style={pStyle}>
            Auto-detected at <code style={inlineCodeStyle}>/start</code>{" "}
            from Telegram&apos;s{" "}
            <code style={inlineCodeStyle}>language_code</code>, then
            user-overridable in settings. The bot replies in your
            language; the Mini App switches the entire UI.
          </p>
        </FeatureCard>
      </div>

      <section
        style={{
          padding: "var(--lb-sp-10) var(--lb-sp-6) var(--lb-sp-12)",
          textAlign: "center",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h2
          style={{
            fontSize: "var(--lb-fs-2xl)",
            fontWeight: "var(--lb-fw-semibold)",
            marginBottom: "var(--lb-sp-3)",
          }}
        >
          Ready to run it?
        </h2>
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-base)",
            lineHeight: 1.6,
            marginBottom: "var(--lb-sp-5)",
          }}
        >
          15 minutes on a €5/mo VPS. The install guide walks every
          step.
        </p>
        <Link
          href="/install"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "var(--lb-sp-3) var(--lb-sp-6)",
            minHeight: "var(--lb-tap-target)",
            borderRadius: "var(--lb-r-full)",
            background: "var(--lb-accent)",
            color: "var(--lb-accent-fg)",
            fontWeight: "var(--lb-fw-semibold)",
            textDecoration: "none",
          }}
        >
          Read the install guide →
        </Link>
      </section>

      <Footer
        hostedLabel="Self-host: Docker Compose, Postgres, Next.js"
        licenseLabel="MIT licensed · open source"
        copyrightLabel="© 2026 listbull"
      />
    </main>
  );
}

function FeatureCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--lb-paper)",
        border: "1px solid var(--lb-border)",
        borderRadius: "var(--lb-r-lg)",
        padding: "var(--lb-sp-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--lb-sp-3)",
      }}
    >
      <h2
        style={{
          fontSize: "var(--lb-fs-xl)",
          fontWeight: "var(--lb-fw-semibold)",
          color: "var(--lb-ink-deep)",
          margin: 0,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

const pStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--lb-fs-md)",
  lineHeight: 1.65,
  color: "var(--lb-fg)",
};

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: "var(--lb-sp-5)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--lb-sp-2)",
  fontSize: "var(--lb-fs-md)",
  lineHeight: 1.65,
};

const linkStyle: React.CSSProperties = {
  color: "var(--lb-accent-strong, var(--lb-accent))",
  textDecoration: "underline",
  textUnderlineOffset: "0.2em",
};

const inlineCodeStyle: React.CSSProperties = {
  background: "var(--lb-card)",
  border: "1px solid var(--lb-border)",
  borderRadius: 4,
  padding: "0.1em 0.4em",
  fontFamily:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  fontSize: "0.9em",
};
