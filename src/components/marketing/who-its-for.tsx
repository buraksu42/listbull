import { Briefcase, Heart, Home, Users } from "lucide-react";

type Audience = {
  icon: React.ReactNode;
  title: string;
  body: string;
};

/**
 * Phase 5 marketing reframe — "Who it's for" section. Four
 * audiences: families, roommates, freelancer pairs, small offices.
 * Each gets an icon + 1-line title + 2-line body. 4-col on desktop,
 * 1-col mobile (no breakpoint media queries — relies on grid
 * auto-fit to handle responsive layout cleanly).
 */
export function WhoItsFor({
  heading,
  audiences,
}: {
  heading: string;
  audiences: Audience[];
}) {
  return (
    <section
      style={{
        padding: "var(--lb-sp-12) var(--lb-sp-6)",
        maxWidth: "1280px",
        margin: "0 auto",
        width: "100%",
      }}
    >
      <h2
        style={{
          fontSize: "var(--lb-fs-2xl)",
          fontWeight: "var(--lb-fw-semibold)",
          letterSpacing: "var(--lb-tracking-title)",
          marginBottom: "var(--lb-sp-8)",
          textAlign: "center",
        }}
      >
        {heading}
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "var(--lb-sp-4)",
        }}
      >
        {audiences.map((a) => (
          <div
            key={a.title}
            style={{
              background: "var(--lb-card)",
              border: "1px solid var(--lb-border)",
              borderRadius: "var(--lb-radius-md)",
              padding: "var(--lb-sp-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--lb-sp-3)",
            }}
          >
            <div
              style={{
                color: "var(--lb-accent)",
                width: 40,
                height: 40,
                borderRadius: "var(--lb-radius-md)",
                background:
                  "color-mix(in srgb, var(--lb-accent) 12%, transparent)",
                display: "grid",
                placeItems: "center",
              }}
            >
              {a.icon}
            </div>
            <div
              style={{
                fontSize: "var(--lb-fs-lg)",
                fontWeight: "var(--lb-fw-semibold)",
              }}
            >
              {a.title}
            </div>
            <div
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-sm)",
                lineHeight: 1.5,
              }}
            >
              {a.body}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export const DEFAULT_AUDIENCES: Audience[] = [
  {
    icon: <Heart width={20} height={20} aria-hidden />,
    title: "Families",
    body: "Shopping lists, chore rotation, school supplies. Everyone in Telegram already; everyone keeps the same list.",
  },
  {
    icon: <Home width={20} height={20} aria-hidden />,
    title: "Roommates",
    body: "Groceries, bills, who's on dishes. Add by @username, no group bots, no shared accounts.",
  },
  {
    icon: <Users width={20} height={20} aria-hidden />,
    title: "Freelancer pairs",
    body: "Client deliverables across projects. Switch workspaces by chat; reminders go to whoever's assigned.",
  },
  {
    icon: <Briefcase width={20} height={20} aria-hidden />,
    title: "Small offices",
    body: "5-15 person teams that already live in Telegram. Roles, audit log, white-label bot — no Slack tax.",
  },
];
