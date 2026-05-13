import Link from "next/link";

import { Footer } from "@/components/marketing/footer";
import { GITHUB_URL } from "@/components/marketing/links";

export const metadata = {
  title: "Install listbull — self-host guide",
  description:
    "Deploy listbull on your own server in 15 minutes. Docker Compose, Postgres, Next.js. BotFather setup, env vars, smoke test.",
};

/**
 * /install — self-host walkthrough.
 *
 * Mirrors `docs/self-host.md` but tightened for in-browser readability:
 * each step is a numbered card with a heading, body copy, and (where
 * useful) a code block. No syntax highlighting library — plain monospace
 * on the card background keeps the page static-renderable and the bundle
 * lean.
 *
 * Anti-list strict: no glassmorphism, no gradient text, no decorative
 * line art, no animated reveal. Elegance comes from spacing + type
 * hierarchy.
 */
export default function InstallPage() {
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
          Self-host guide
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
          Deploy listbull in 15 minutes
        </h1>
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-lg)",
            lineHeight: 1.6,
          }}
        >
          Docker Compose, Postgres, Next.js. The numbered steps below are
          the same ones in <code style={inlineCodeStyle}>docs/self-host.md</code>{" "}
          — start to finish, plan ~30–45 minutes including DNS propagation
          and the first build.
        </p>
      </header>

      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 var(--lb-sp-4) var(--lb-sp-12)",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-6)",
        }}
      >
        <InstallSection title="Prerequisites" indexLabel="0">
          <ul style={listStyle}>
            <li>
              <strong>A server</strong> with Docker + Docker Compose
              installed and SSH access. A Hetzner CPX21 (€5/mo) handles
              a household; €20/mo handles a 5–15 person team.
            </li>
            <li>
              <strong>A domain</strong> with DNS you control. Subdomain
              is fine (e.g. <code style={inlineCodeStyle}>listbull.mydomain.com</code>).
            </li>
            <li>
              <strong>A Telegram account</strong> to create a bot via{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                @BotFather
              </a>
              .
            </li>
            <li>
              <strong>An OpenRouter account</strong>{" "}
              (<a
                href="https://openrouter.ai"
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                openrouter.ai
              </a>
              ). $5 credit covers ~5,000 messages on the default
              Claude Haiku 4.5 model. BYOK per workspace — every
              workspace owner brings their own.
            </li>
            <li>
              Locally: <code style={inlineCodeStyle}>git</code>,{" "}
              <code style={inlineCodeStyle}>openssl</code>,{" "}
              <code style={inlineCodeStyle}>curl</code>.
            </li>
          </ul>
        </InstallSection>

        <InstallSection title="Create your Telegram bot" indexLabel="1">
          <p style={pStyle}>
            DM <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              @BotFather
            </a>{" "}
            and send <code style={inlineCodeStyle}>/newbot</code>. Pick a
            display name and a username (must end in{" "}
            <code style={inlineCodeStyle}>_bot</code>). BotFather hands
            you an HTTP API token — save it for the env file.
          </p>
        </InstallSection>

        <InstallSection title="Point your DNS" indexLabel="2">
          <p style={pStyle}>
            Add an A record for your domain pointing at the server&apos;s
            public IP. If you use Cloudflare, set proxy mode{" "}
            <strong>off</strong> so Let&apos;s Encrypt&apos;s HTTP-01 challenge can
            reach origin.
          </p>
          <CodeBlock>{`A   myapp.com       → <server_ip>
A   www.myapp.com   → <server_ip>   (optional)`}</CodeBlock>
          <p style={pStyle}>
            Propagation takes 2–30 minutes. Confirm with{" "}
            <code style={inlineCodeStyle}>dig myapp.com +short</code>.
          </p>
        </InstallSection>

        <InstallSection title="Clone the repo + bootstrap env" indexLabel="3">
          <CodeBlock>{`git clone https://github.com/buraksu42/listbull.git
cd listbull
cp .env.example .env
chmod 600 .env`}</CodeBlock>
        </InstallSection>

        <InstallSection title="Generate secrets" indexLabel="4">
          <p style={pStyle}>
            All four are required. Generate locally or on the server —
            paste the outputs into <code style={inlineCodeStyle}>.env</code>.
          </p>
          <CodeBlock>{`# Better Auth session signing (≥32 bytes)
openssl rand -base64 48

# AES-256-GCM key for stored OpenRouter keys (32 bytes)
openssl rand -base64 32

# Telegram webhook validation token (≥16 hex chars)
openssl rand -hex 32

# Postgres password
openssl rand -hex 16`}</CodeBlock>
          <p style={pStyle}>
            <strong>ENV_KEY rotation = data loss.</strong> This key
            decrypts every stored OpenRouter key. Rotating it means
            every workspace owner has to re-paste their key. Generate
            once, store somewhere safe.
          </p>
        </InstallSection>

        <InstallSection title="Fill in .env" indexLabel="5">
          <CodeBlock>{`# Public URL (where DNS points)
NEXT_PUBLIC_APP_URL=https://myapp.com
BETTER_AUTH_URL=https://myapp.com
NEXT_PUBLIC_ENV=production

# Step 4 secrets
BETTER_AUTH_SECRET=...
ENV_KEY=...
TELEGRAM_WEBHOOK_SECRET=...
POSTGRES_PASSWORD=...

# Postgres (compose-internal network)
DATABASE_URL=postgres://listbull:<POSTGRES_PASSWORD>@postgres:5432/listbull
POSTGRES_DB=listbull
POSTGRES_USER=listbull

# Step 1 bot info
TELEGRAM_BOT_TOKEN=1234567890:ABC-DEF...
TELEGRAM_BOT_USERNAME=my_listbull_bot   # no @ prefix

# Optional: your Telegram user id (numeric) — flags YOU as operator
OPERATOR_TELEGRAM_ID=

# Optional: Sentry + Umami
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_UMAMI_WEBSITE_ID=`}</CodeBlock>
        </InstallSection>

        <InstallSection title="Reverse proxy + TLS" indexLabel="6">
          <p style={pStyle}>
            listbull doesn&apos;t terminate HTTPS itself. Put Caddy or
            Traefik in front. Simplest Caddyfile:
          </p>
          <CodeBlock>{`myapp.com {
    reverse_proxy 127.0.0.1:3000
}`}</CodeBlock>
          <p style={pStyle}>
            Caddy fetches a Let&apos;s Encrypt cert automatically. If you
            run Dokploy, its bundled Traefik handles this — just add
            the domain in the panel.
          </p>
        </InstallSection>

        <InstallSection title="Start the stack" indexLabel="7">
          <CodeBlock>{`docker compose up -d
docker compose logs -f app   # wait for "✓ Ready in ...ms"`}</CodeBlock>
          <p style={pStyle}>
            First build runs ~3–5 minutes. After &ldquo;Ready&rdquo;, Ctrl+C the
            log (service stays up). Health check:
          </p>
          <CodeBlock>{`curl -s https://myapp.com/api/health
# expected: {"status":"ok","db":"ok","bot":"ok",...}`}</CodeBlock>
        </InstallSection>

        <InstallSection title="Apply migrations" indexLabel="8">
          <CodeBlock>{`docker compose run --rm app npm run db:migrate`}</CodeBlock>
          <p style={pStyle}>
            You should see <code style={inlineCodeStyle}>[✓] migrations applied successfully!</code>
          </p>
        </InstallSection>

        <InstallSection
          title="Configure the bot — automatic"
          indexLabel="9a"
        >
          <p style={pStyle}>
            One script wires the Telegram side: webhook, slash commands,
            and the Mini App menu button.
          </p>
          <CodeBlock>{`TELEGRAM_BOT_TOKEN="<your bot token>" \\
TELEGRAM_WEBHOOK_SECRET="<your webhook secret>" \\
APP_BASE_URL="https://myapp.com" \\
  npm run setup:bot`}</CodeBlock>
          <p style={pStyle}>
            On success the script prints the remaining BotFather steps —
            those can&apos;t be automated because Telegram&apos;s public Bot API
            doesn&apos;t expose <code style={inlineCodeStyle}>/newapp</code>,{" "}
            <code style={inlineCodeStyle}>/setmainminiapp</code>,{" "}
            <code style={inlineCodeStyle}>/setdomain</code>,{" "}
            <code style={inlineCodeStyle}>/setinline</code>,{" "}
            <code style={inlineCodeStyle}>/setinlinefeedback</code>, or{" "}
            <code style={inlineCodeStyle}>/setjoingroups</code>.
          </p>
        </InstallSection>

        <InstallSection
          title="Configure the bot — manual BotFather"
          indexLabel="9b"
        >
          <p style={pStyle}>
            In a chat with{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              @BotFather
            </a>{" "}
            → select your bot → Bot Settings:
          </p>
          <ul style={listStyle}>
            <li>
              <code style={inlineCodeStyle}>/setdomain</code> →{" "}
              <code style={inlineCodeStyle}>myapp.com</code>
            </li>
            <li>
              <code style={inlineCodeStyle}>/setjoingroups</code> →{" "}
              <strong>Disable</strong>
            </li>
            <li>
              <code style={inlineCodeStyle}>/setinline</code> →{" "}
              <strong>Enable</strong>, placeholder:{" "}
              <code style={inlineCodeStyle}>Search items…</code>
            </li>
            <li>
              <code style={inlineCodeStyle}>/setinlinefeedback</code> →{" "}
              <strong>Enabled</strong> (required for inline Quick
              Create — without this, Telegram never sends{" "}
              <code style={inlineCodeStyle}>chosen_inline_result</code>{" "}
              updates).
            </li>
          </ul>
          <p style={pStyle}>
            <strong>Chat-list &ldquo;Open&rdquo; affordance</strong> — surfaces a
            launch icon next to your bot&apos;s row in Telegram&apos;s chat list:
          </p>
          <ul style={listStyle}>
            <li>
              <code style={inlineCodeStyle}>/newapp</code> → pick your
              bot → Title <code style={inlineCodeStyle}>listbull</code>,
              Web App URL <code style={inlineCodeStyle}>https://myapp.com/app</code>,
              short name <code style={inlineCodeStyle}>app</code>. Tap
              the bot button BotFather offers — don&apos;t type the username
              manually (it returns &ldquo;Invalid bot&rdquo;).
            </li>
            <li>
              <code style={inlineCodeStyle}>/setmainminiapp</code> →
              pick your bot → select <code style={inlineCodeStyle}>app</code>{" "}
              → Enabled.
            </li>
          </ul>
          <p style={pStyle}>
            Fully restart your Telegram client after this — the
            chat-list affordance is cached aggressively.
          </p>
        </InstallSection>

        <InstallSection
          title="Open the Mini App + set your OpenRouter key"
          indexLabel="10"
        >
          <p style={pStyle}>
            DM your bot, send <code style={inlineCodeStyle}>/start</code>,
            then tap the Mini App button (bottom-right). Open Workspace
            settings → Workspace API key → paste a key from{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              openrouter.ai/keys
            </a>{" "}
            → Save. The key is AES-256-GCM encrypted at rest with{" "}
            <code style={inlineCodeStyle}>ENV_KEY</code>; you won&apos;t see
            it plaintext again.
          </p>
          <p style={pStyle}>
            Send your bot any message (&ldquo;buy milk&rdquo;) — it should parse
            intent, create the item in your Inbox, and reply in your
            chosen language.
          </p>
        </InstallSection>

        <InstallSection title="Where to go next" indexLabel="∞">
          <ul style={listStyle}>
            <li>
              <Link href="/features" style={linkStyle}>
                See all features →
              </Link>{" "}
              the full capability catalog.
            </li>
            <li>
              <a
                href={`${GITHUB_URL}/tree/main/docs`}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                docs/ in the repo
              </a>{" "}
              — advanced topics (backups, monitoring, Sentry/Umami,
              cron debugging, attachment storage, cert renewal).
            </li>
            <li>
              <a
                href={`${GITHUB_URL}/issues`}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                GitHub Issues
              </a>{" "}
              — stuck somewhere? Open one.
            </li>
          </ul>
        </InstallSection>
      </div>

      <Footer
        hostedLabel="Self-host: Docker Compose, Postgres, Next.js"
        licenseLabel="MIT licensed · open source"
        copyrightLabel="© 2026 listbull"
      />
    </main>
  );
}

function InstallSection({
  title,
  indexLabel,
  children,
}: {
  title: string;
  indexLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--lb-paper)",
        border: "1px solid var(--lb-border)",
        borderRadius: "var(--lb-r-lg)",
        padding: "var(--lb-sp-6) var(--lb-sp-6) var(--lb-sp-7)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--lb-sp-3)",
          marginBottom: "var(--lb-sp-4)",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 36,
            height: 36,
            padding: "0 var(--lb-sp-2)",
            borderRadius: "var(--lb-r-full)",
            background: "var(--lb-ink-deep)",
            color: "var(--lb-accent)",
            fontWeight: "var(--lb-fw-bold)",
            fontSize: "var(--lb-fs-md)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {indexLabel}
        </span>
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
      </header>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-3)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: "var(--lb-card)",
        border: "1px solid var(--lb-border)",
        borderRadius: "var(--lb-r-md)",
        padding: "var(--lb-sp-4)",
        overflowX: "auto",
        fontSize: "var(--lb-fs-sm)",
        lineHeight: 1.6,
        margin: 0,
        fontFamily:
          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
        color: "var(--lb-fg)",
      }}
    >
      <code>{children}</code>
    </pre>
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
