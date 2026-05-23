type Feature = {
  icon: string;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    icon: "📝",
    title: "Natural-language to-dos",
    body: "Type 'süt al' or 'tomorrow 9am dentist' — the bot creates the item, sets the deadline, drops it on the list.",
  },
  {
    icon: "📂",
    title: "Checklists with gate-complete",
    body: "Group multi-step work under one umbrella. The parent can't close until every child does — no silently-skipped subtasks.",
  },
  {
    icon: "⏰",
    title: "Reminders, group-aware",
    body: "DM items remind in your DM; group items remind in the group. Per-minute cron, RRULE-aware for recurring tasks.",
  },
  {
    icon: "🔒",
    title: "Encrypted passwords",
    body: "/password stores credentials AES-256-GCM at rest. Reveal sends a 15-second self-destruct message with tap-to-copy.",
  },
  {
    icon: "🎤",
    title: "Voice notes, ambient",
    body: "DM voice notes get transcribed and captured. In groups, the bot listens silently — to-dos surface, chatter doesn't.",
  },
  {
    icon: "🆓",
    title: "BYOK or free tier",
    body: "Paste your own OpenRouter key for better models. Or use the operator's shared free-tier key — zero setup, zero cost.",
  },
];

export function FeatureGrid() {
  return (
    <section
      aria-labelledby="lb-features-title"
      className="mx-auto w-full max-w-6xl px-6 py-16"
    >
      <h2
        id="lb-features-title"
        className="mb-2 text-center text-2xl font-semibold sm:text-3xl"
        style={{ letterSpacing: "var(--lb-tracking-title)" }}
      >
        What the bot does
      </h2>
      <p
        className="mx-auto mb-12 max-w-2xl text-center text-base"
        style={{ color: "var(--lb-muted-fg)" }}
      >
        Everything below ships today. No &ldquo;coming soon&rdquo;, no waitlist.
      </p>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li
            key={feature.title}
            className="rounded-2xl border p-6 transition hover:shadow-md"
            style={{
              borderColor: "var(--lb-border)",
              background: "var(--lb-card)",
            }}
          >
            <div className="mb-3 text-2xl" aria-hidden>
              {feature.icon}
            </div>
            <h3 className="mb-2 text-base font-semibold">
              {feature.title}
            </h3>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--lb-muted-fg)" }}
            >
              {feature.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
