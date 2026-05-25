import Link from "next/link";

type Card = {
  href: string;
  title: string;
  body: string;
};

const CARDS: Card[] = [
  {
    href: "/features",
    title: "Features →",
    body: "What the bot does today. Six things, no \"coming soon\".",
  },
  {
    href: "/teams",
    title: "Teams →",
    body: "Pin the bot to your team's Telegram group. Tag-based assignment, ambient voice, group reminders.",
  },
  {
    href: "/commands",
    title: "Commands →",
    body: "Twelve slash commands with worked examples for DM and group chats.",
  },
  {
    href: "/security",
    title: "Security →",
    body: "How we handle your data, linked to source. AES-256-GCM at rest, per-chat isolation.",
  },
];

/**
 * Four-card "next destination" grid on the home page. Pure
 * navigation — keeps the home minimal and pushes deep content to
 * dedicated pages.
 */
export function LinkCards() {
  return (
    <section style={{ padding: "24px 0 96px" }}>
      <div className="container">
        <div className="section-head">
          <h2>Four places to go from here.</h2>
          <p className="lead">
            Solo or with a team, scan the commands, or read how we
            handle your data with source links.
          </p>
        </div>
        <div
          className="features"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        >
          {CARDS.map((c) => (
            <Link key={c.href} href={c.href} className="feature">
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
