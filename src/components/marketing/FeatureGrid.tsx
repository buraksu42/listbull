type Feature = {
  icon: React.ReactNode;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: "Natural-language to-dos",
    body: "Type \"buy milk\" or \"tomorrow 9am dentist\". The bot creates the item, sets the deadline, drops it on the list.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7h6l2 3h10v9a2 2 0 0 1-2 2H3z" />
        <path d="M8 14l3 3 5-5" />
      </svg>
    ),
    title: "Checklists with gate-complete",
    body: "Group multi-step work under one umbrella. The parent can't close until every child does — no silently-skipped subtasks.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2 2" />
        <path d="M5 3l-2 2" />
        <path d="M19 3l2 2" />
      </svg>
    ),
    title: "Reminders, group-aware",
    body: "DM items remind in your DM; group items remind in the group. Per-minute cron, RRULE-aware for recurring tasks.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: "Encrypted passwords",
    body: "/password stores credentials AES-256-GCM at rest. Reveal sends a 15-second self-destruct message with tap-to-copy.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M19 11a7 7 0 0 1-14 0" />
        <path d="M12 18v3" />
      </svg>
    ),
    title: "Voice notes, ambient",
    body: "DM voice notes get transcribed and captured. In groups, the bot listens silently — to-dos surface, chatter doesn't.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    ),
    title: "BYOK or free tier",
    body: "Paste your own OpenRouter key for top models, or use the operator's shared free-tier key — zero setup, zero cost.",
  },
];

export function FeatureGrid() {
  return (
    <section className="section-block">
      <div className="container">
        <div className="section-head">
          <h2>What the bot does today.</h2>
          <p className="lead">
            Six capabilities, all shipped on the live bot. No
            &ldquo;coming soon&rdquo;, no waitlist.
          </p>
        </div>
        <ul className="features" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {FEATURES.map((f) => (
            <li key={f.title} className="feature">
              <span className="ficon" aria-hidden>
                {f.icon}
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
