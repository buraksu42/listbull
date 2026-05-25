type SetupStep = { n: number; title: string; body: React.ReactNode };

const SETUP_STEPS: SetupStep[] = [
  {
    n: 1,
    title: "Open BotFather and disable privacy mode",
    body: (
      <>
        Telegram bots default to <em>privacy on</em> — meaning the bot
        only sees @mentions, slash commands, and replies. listbull
        needs this OFF so it can transcribe group voice notes.
        It still won&rsquo;t spend tokens on every group message
        (there&rsquo;s a code-side filter), but the OFF setting is the
        switch that lets voice through.
        <br />
        <code>@BotFather → /setprivacy → Disable</code>
      </>
    ),
  },
  {
    n: 2,
    title: "Add the bot to your Telegram group",
    body: (
      <>
        Group settings → Add member → search <code>@listbull_bot</code>
        {" "}→ add. The bot greets the group with a short hello and
        marks itself as ready.
      </>
    ),
  },
  {
    n: 3,
    title: "Mention the bot to capture your first item",
    body: (
      <>
        <code>@listbull_bot buy coffee beans for the office</code>
        {" "}— bot replies with <code>✓ added</code>. Anyone else in
        the group can do the same; everyone sees the same{" "}
        <code>/items</code> list.
      </>
    ),
  },
  {
    n: 4,
    title: "One OpenRouter key per group, optional",
    body: (
      <>
        Without any key, the group runs on the operator&rsquo;s shared
        free-tier model — zero cost, basic quality. To upgrade,
        anyone in the group DMs the bot{" "}
        <code>/settings → 🔑</code> and pastes an OpenRouter key. That
        key signs all the group&rsquo;s LLM calls (encrypted at rest;
        see <a href="/security">Security</a>).
      </>
    ),
  },
];

type Capability = {
  title: string;
  body: string;
  detail?: string;
};

const CAPABILITIES: Capability[] = [
  {
    title: "Ambient voice in groups",
    body: "Drop a voice note in the group; if it contains a to-do, it lands on the list. If it's chatter, the bot stays silent. No reply spam, no token waste.",
    detail: "Voice STT runs only when an OpenRouter key is set on the group (free tier disables it — paid audio model).",
  },
  {
    title: "Tag-based assignment",
    body: "\"Assign the report to Michael\" creates an item tagged #michael. Anyone runs /tag michael to see Michael's items. No per-user role grants, no permission UI to babysit.",
    detail: "Tags are case-insensitive and lowercased on save.",
  },
  {
    title: "Reminders fire in the group",
    body: "A reminder set on a group item rings in the group, not in your DM. Nobody misses it because they weren't in the original chat.",
    detail: "DM items still ring in DM — routing is item-scoped, not user-scoped.",
  },
  {
    title: "Shared password vault",
    body: "Anyone DMs the bot /password to save credentials (label + username + password). The secret reveals back in the originating group with a 15-second self-destruct message.",
    detail: "AES-256-GCM at rest; plaintext only in process memory for the duration of the reveal.",
  },
  {
    title: "Everyone sees the same list",
    body: "/items, /done, /memory, /reminders — all chat-scoped. No private slices, no role-gated views. The list is the chat.",
  },
  {
    title: "Forward-to-capture",
    body: "Forward a message into the group with the bot @mentioned: \"@listbull_bot bunu listeye al\". Up to 20 distinct items extracted per forward.",
  },
];

type Story = {
  who: string;
  flow: { who: string; said: string; bot: string }[];
};

const STORIES: Story[] = [
  {
    who: "Marketing duo planning a launch",
    flow: [
      {
        who: "Sarah",
        said: "@listbull_bot launch checklist: copy, hero illustration, og image, blog post, twitter thread",
        bot: "✓ created parent + 5 sub-items. /items shows 📂 0/5.",
      },
      {
        who: "Michael",
        said: "@listbull_bot assign the og image to sarah, blog post to me",
        bot: "✓ tagged: og image → #sarah, blog post → #michael.",
      },
      {
        who: "Sarah",
        said: "/tag sarah",
        bot: "📂 og image (open)",
      },
      {
        who: "Michael",
        said: "(voice note) blog post draft is in notion, lemme know if it's too long",
        bot: "(silent — not actionable)",
      },
      {
        who: "Michael",
        said: "(voice note) reminder: ship the og image tomorrow 10am",
        bot: "🔔 reminder set on \"og image\" for tomorrow 10:00.",
      },
    ],
  },
  {
    who: "Three roommates sharing chores + a shopping list",
    flow: [
      {
        who: "Roommate 1",
        said: "@listbull_bot weekly cleanup: bins, hallway, kitchen, bathroom",
        bot: "✓ parent + 4 sub-items.",
      },
      {
        who: "Roommate 2",
        said: "@listbull_bot süt, ekmek, kahve, yumurta #market",
        bot: "✓ 4 items added with tag #market.",
      },
      {
        who: "Roommate 3",
        said: "@listbull_bot what's the wifi password?",
        bot: "🔒 revealing wifi… (15s self-destruct)",
      },
      {
        who: "Roommate 1",
        said: "(tap ✅ on \"bins\")",
        bot: "→ Parent: 📂 1/4",
      },
    ],
  },
];

export function TeamsContent() {
  return (
    <>
      <section className="section-block" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <h2>Why a Telegram group?</h2>
            <p className="lead">
              Because your team is already there. No new login, no
              browser tab, no Slack workspace to provision. Pin the
              bot to the group everyone already coordinates in;
              your to-dos live next to the conversations that
              generated them.
            </p>
          </div>
          <ul className="features" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="feature">
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                {c.detail ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--lb-muted-fg)",
                      borderTop: "1px solid var(--lb-border)",
                      paddingTop: 10,
                      marginTop: 6,
                    }}
                  >
                    {c.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-block" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <h2>Get the team on in four steps.</h2>
            <p className="lead">
              Five minutes end-to-end. The setup is mostly Telegram
              admin, not listbull.
            </p>
          </div>
          <div className="claim-cards">
            {SETUP_STEPS.map((s) => (
              <div key={s.n} className="claim-card">
                <h3>
                  <span
                    style={{
                      display: "inline-block",
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "var(--lb-accent)",
                      color: "#fff",
                      textAlign: "center",
                      lineHeight: "24px",
                      fontSize: 13,
                      marginRight: 10,
                      fontWeight: 700,
                    }}
                  >
                    {s.n}
                  </span>
                  {s.title}
                </h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-block" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <h2>What it looks like for two teams.</h2>
            <p className="lead">
              Real flows from real groups. Mix capture, assignment,
              reminders, secrets, voice — all in one Telegram
              conversation.
            </p>
          </div>
          {STORIES.map((s) => (
            <article key={s.who} className="flow">
              <h3>{s.who}</h3>
              <dl className="flow-list" style={{ gridTemplateColumns: "180px 1fr" }}>
                {s.flow.map((step, i) => (
                  <div key={i} style={{ display: "contents" }}>
                    <dt className="you">
                      <strong style={{ color: "var(--lb-fg)" }}>
                        {step.who}
                      </strong>
                      <br />
                      <span style={{ fontWeight: 400 }}>{step.said}</span>
                    </dt>
                    <dd className="bot">{step.bot}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block" style={{ paddingTop: 0 }}>
        <div className="container">
          <div
            className="disclaimer"
            style={{ marginTop: 0 }}
            aria-label="Cost model"
          >
            <h2>What does it cost?</h2>
            <p style={{ fontSize: 14, color: "var(--lb-muted-fg)", lineHeight: 1.6 }}>
              <strong>If you don&rsquo;t set a key:</strong> nothing.
              The bot uses the operator&rsquo;s shared OpenRouter
              free-tier key — limited to free models, voice
              transcription disabled. Good enough for a small team
              starting out.
            </p>
            <p style={{ fontSize: 14, color: "var(--lb-muted-fg)", lineHeight: 1.6 }}>
              <strong>If you set your own key:</strong> a typical
              4-person team writing 100-200 messages a day spends
              about <strong>$1-3/month</strong> on Claude Haiku 4.5
              via OpenRouter. Voice transcription adds ~$0.10 per
              minute of audio. There&rsquo;s no listbull subscription —
              your OpenRouter bill is the only line item.
            </p>
            <p style={{ fontSize: 14, color: "var(--lb-muted-fg)", lineHeight: 1.6 }}>
              <strong>If you self-host:</strong> add your VPS
              (~5€/month on Hetzner) to the OpenRouter bill above.
              Bot lives where you put it; nobody else sees your
              data.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
