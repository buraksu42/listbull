type Step = { you: string; bot: string };
type Flow = {
  title: string;
  sub: string;
  steps: Step[];
};

const FLOWS: Flow[] = [
  {
    title: "DM — first 60 seconds",
    sub: "What you'll see right after /start.",
    steps: [
      {
        you: "/start",
        bot: "Welcome + 🎯 Quick tour button. Tap for the 8-step walkthrough.",
      },
      {
        you: "buy milk",
        bot: '✓ "buy milk" added. /items shows it.',
      },
      {
        you: "tomorrow 6pm pay the bill",
        bot: "✓ added with deadline tomorrow 18:00. Row gets 📅.",
      },
      {
        you: "remind me about the milk in 1 hour",
        bot: '🔔 reminder set. In 60 minutes, the bot DMs "⏰ buy milk".',
      },
    ],
  },
  {
    title: "Checklist — gate-complete in action",
    sub: "Parents can't close while children are open.",
    steps: [
      {
        you: "weekly cleanup: laundry, dishes, trash",
        bot: "✓ created parent + 3 sub-items. /items shows 📂 0/3.",
      },
      {
        you: "(tap 📂 → toggle laundry ✅)",
        bot: "Parent badge updates to 📂 1/3.",
      },
      {
        you: "weekly cleanup done",
        bot: "❌ 2 sub-items still open: dishes, trash. Finish them first, or confirm cascade.",
      },
      {
        you: "(toggle remaining children)",
        bot: "Parent auto-✅. 📂 3/3 ✅.",
      },
    ],
  },
  {
    title: "/password — encrypted, self-destruct",
    sub: "3-step DM save, 15-second reveal.",
    steps: [
      {
        you: "/password (in DM only)",
        bot: "1/3 — Which label?",
      },
      {
        you: "gmail",
        bot: "2/3 — Username / email?",
      },
      {
        you: "(you reply with each step)",
        bot: "✅ saved. Suffix shown; encrypted blob AES-256-GCM at rest.",
      },
      {
        you: "/password view gmail",
        bot: "🔒 username + password in <code>. Self-destructs in 15s.",
      },
    ],
  },
  {
    title: "Group — ambient voice + tag-based assignment",
    sub: "Voice with a to-do surfaces; chatter stays silent.",
    steps: [
      {
        you: "(add @listbull_bot to group; /setprivacy Disable in BotFather)",
        bot: "Bot joins; welcome.",
      },
      {
        you: "@listbull_bot assign the report to Michael",
        bot: "✓ created with #michael tag. /tag michael lists it.",
      },
      {
        you: '(record group voice: "meeting tomorrow 2pm")',
        bot: "Silently adds item with deadline. No reply spam.",
      },
      {
        you: '(record group voice: "weather is nice")',
        bot: "(no reply — nothing actionable.)",
      },
    ],
  },
];

export function WorkedExamples() {
  return (
    <section className="section-block">
      <div className="container">
        <div className="section-head">
          <h2>What it actually looks like.</h2>
          <p className="lead">
            Four worked flows — DM, checklists, password reveal, and
            group ambient voice. Copy them, adapt them, send them to
            the bot.
          </p>
        </div>
        {FLOWS.map((flow) => (
          <article key={flow.title} className="flow">
            <h3>{flow.title}</h3>
            <p className="flow-sub">{flow.sub}</p>
            <dl className="flow-list">
              {flow.steps.map((step, i) => (
                <div
                  key={i}
                  style={{ display: "contents" }}
                >
                  <dt className="you">{step.you}</dt>
                  <dd className="bot">{step.bot}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
