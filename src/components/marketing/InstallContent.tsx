/**
 * /install page content — step-by-step self-host runbook. Order
 * matters: the BotFather privacy + groups settings come BEFORE
 * "add the bot to a group" so users don't end up with broken
 * voice/mentions on first try.
 */

type Step = {
  n: number;
  title: string;
  body: React.ReactNode;
};

const STEPS: Step[] = [
  {
    n: 1,
    title: "Create the Telegram bot",
    body: (
      <>
        DM <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a> →
        <code> /newbot</code> → display name → username (must end in
        <code>_bot</code>). BotFather hands you an HTTP API token
        (<code>1234567890:ABC-DEF...</code>) — store it; you&rsquo;ll
        put it in <code>.env</code> later.
      </>
    ),
  },
  {
    n: 2,
    title: "Configure BotFather settings — BEFORE adding to any group",
    body: (
      <>
        Still in BotFather, with your bot selected:
        <ul style={{ margin: "10px 0 0 18px" }}>
          <li>
            <code>/setjoingroups</code> → <strong>Enable</strong>{" "}
            (so users can add the bot to groups)
          </li>
          <li>
            <code>/setprivacy</code> → <strong>Disable</strong>{" "}
            (required for group voice transcription and reliable
            mention handling — without this the bot only sees @mentions
            and slash commands; voice notes never reach it). The
            bot still won&rsquo;t spend tokens on every group
            message — a code-side filter only forwards mentions /
            replies to the LLM.
          </li>
        </ul>
        Doing both of these <em>before</em> users invite the bot to a
        group avoids a confusing first-run where voice silently fails.
      </>
    ),
  },
  {
    n: 3,
    title: "Point a domain at your server",
    body: (
      <>
        Pick a subdomain (e.g. <code>listbull.mydomain.com</code>).
        Add an A record pointing at your server&rsquo;s public IP.
        Wait for DNS to propagate (a couple of minutes); verify with{" "}
        <code>dig +short</code>. If using Cloudflare, keep proxy mode
        OFF so Let&rsquo;s Encrypt&rsquo;s HTTP-01 challenge works.
      </>
    ),
  },
  {
    n: 4,
    title: "Clone the repo and copy the env template",
    body: (
      <pre className="code-block">{`git clone https://github.com/buraksu42/listbull.git
cd listbull
cp .env.example .env
chmod 600 .env`}</pre>
    ),
  },
  {
    n: 5,
    title: "Generate secrets",
    body: (
      <>
        <pre className="code-block">{`# AES-256-GCM key for password + BYOK encryption (32-byte base64)
echo "ENV_KEY=$(openssl rand -base64 32)"

# Telegram webhook signature (16+ hex chars)
echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)"

# Postgres password
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"`}</pre>
        <p style={{ marginTop: 10, fontSize: 14, color: "var(--lb-muted-fg)" }}>
          <strong>Important:</strong> rotating <code>ENV_KEY</code> later
          invalidates every stored password and OpenRouter key.
          Generate once, store securely.
        </p>
      </>
    ),
  },
  {
    n: 6,
    title: "Fill the env file",
    body: (
      <>
        Open <code>.env</code> and fill in: the secrets you just
        generated, the bot token from step 1, the public URL from
        step 3, and the bot username (without <code>@</code>).
        Optionally set{" "}
        <code>LISTBULL_SHARED_OPENROUTER_KEY</code> to enable the
        free tier for keyless chats, and{" "}
        <code>LISTBULL_PER_USER_HOURLY_MSG_LIMIT=100</code> to cap
        anonymous spend.
      </>
    ),
  },
  {
    n: 7,
    title: "Reverse proxy / TLS",
    body: (
      <>
        listbull doesn&rsquo;t terminate TLS — put Caddy / Traefik /
        Cloudflare in front. Minimal Caddyfile:
        <pre className="code-block">{`listbull.mydomain.com {
    reverse_proxy 127.0.0.1:3000
}`}</pre>
        Compose binds the app to <code>127.0.0.1:3000</code> only,
        so the reverse proxy is mandatory for public access.
      </>
    ),
  },
  {
    n: 8,
    title: "Bring up the stack",
    body: (
      <>
        <pre className="code-block">{`docker compose up -d
docker compose logs -f app`}</pre>
        Wait for <code>✓ Ready in …ms</code>. First build takes
        ~3-5 minutes. Then health-check from another shell:
        <pre className="code-block">{`curl -s https://listbull.mydomain.com/api/health
# expected: {"status":"ok","db":"ok","bot":"ok",...}`}</pre>
      </>
    ),
  },
  {
    n: 9,
    title: "Apply DB migrations",
    body: (
      <>
        The cron container does this automatically on every boot,
        but you can also do it explicitly:
        <pre className="code-block">{`docker compose run --rm app npm run db:migrate`}</pre>
        Migrations are idempotent; already-applied entries are
        skipped.
      </>
    ),
  },
  {
    n: 10,
    title: "Register the webhook + slash menu",
    body: (
      <>
        One script does both — and emits any missing BotFather
        steps if you skipped them earlier:
        <pre className="code-block">{`TELEGRAM_BOT_TOKEN="<your bot token>" \\
TELEGRAM_WEBHOOK_SECRET="<your webhook secret>" \\
APP_BASE_URL="https://listbull.mydomain.com" \\
  npm run setup:bot`}</pre>
        Verifies via <code>getWebhookInfo</code> and prints the
        12 slash commands that landed in Telegram&rsquo;s menu.
      </>
    ),
  },
  {
    n: 11,
    title: "Smoke test",
    body: (
      <>
        DM your bot <code>/start</code>; you should see the welcome
        message + the &ldquo;🎯 Quick tour&rdquo; inline button. Then:
        <pre className="code-block">{`buy milk
buy milk in 2 minutes remind`}</pre>
        Within two minutes the bot should ping you with the reminder.
        Cron logs surface the dispatch (
        <code>docker compose logs cron</code>).
      </>
    ),
  },
  {
    n: 12,
    title: "Optional — Sentry + Umami",
    body: (
      <>
        Set <code>NEXT_PUBLIC_SENTRY_DSN</code> for crash reporting,{" "}
        <code>NEXT_PUBLIC_UMAMI_WEBSITE_ID</code> for cookieless
        analytics. Both are build args — rebuild the image after
        adding them:
        <pre className="code-block">{`docker compose build --no-cache app
docker compose up -d --force-recreate app`}</pre>
        Verify Sentry by triggering an error; verify Umami by
        opening the marketing page and checking the dashboard.
      </>
    ),
  },
];

export function InstallContent() {
  return (
    <>
      <section className="section-block" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="claim-cards">
            {STEPS.map((s) => (
              <article key={s.n} className="claim-card">
                <h3>
                  <span
                    style={{
                      display: "inline-block",
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--lb-accent)",
                      color: "#fff",
                      textAlign: "center",
                      lineHeight: "28px",
                      fontSize: 13,
                      marginRight: 12,
                      fontWeight: 700,
                      verticalAlign: "middle",
                    }}
                  >
                    {s.n}
                  </span>
                  <span style={{ verticalAlign: "middle" }}>{s.title}</span>
                </h3>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--lb-muted-fg)" }}>
                  {s.body}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-block" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="disclaimer" style={{ marginTop: 0 }}>
            <h2>If something breaks</h2>
            <ul>
              <li>
                Webhook silent: <code>curl getWebhookInfo</code> →
                check <code>last_error_message</code>. Usually
                Telegram can&rsquo;t reach your URL (DNS / proxy /
                cert).
              </li>
              <li>
                &ldquo;OpenRouter key not set&rdquo;: either set{" "}
                <code>LISTBULL_SHARED_OPENROUTER_KEY</code> in env
                (free tier for everyone), or have each user paste
                their key via <code>/settings → 🔑</code>.
              </li>
              <li>
                Updating: <code>git pull &amp;&amp; docker compose
                build app cron &amp;&amp; docker compose up -d</code>.
                The cron container reapplies any new migrations on
                its next boot.
              </li>
            </ul>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--lb-muted-fg)" }}>
              Deeper reference (in Turkish) lives in{" "}
              <a
                href="https://github.com/buraksu42/listbull/blob/main/docs/self-host.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                docs/self-host.md
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
