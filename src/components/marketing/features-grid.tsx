/**
 * Marketing features grid — 6 cards, 2-3 column responsive.
 *
 * Cards are flat (no drop shadow, no glassmorphism); border + small icon
 * + heading + body. Icons are simple geometric lucide marks rendered at
 * 20px stroke 2px on the brand teal background.
 */
import {
  KeyRound,
  MessageSquareText,
  Network,
  Smartphone,
  Sparkles,
  WifiOff,
} from "lucide-react";

type Feature = {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
};

type FeaturesGridProps = {
  heading: string;
  features: Array<Pick<Feature, "title" | "body">>;
};

const ICONS = [
  MessageSquareText, // talk to it like a friend
  Network, // share lists, not chats
  KeyRound, // BYOK
  Sparkles, // open source
  Smartphone, // native to Telegram
  WifiOff, // works offline-ish
] as const;

export function FeaturesGrid({ heading, features }: FeaturesGridProps) {
  return (
    <section
      aria-labelledby="features-heading"
      style={{
        padding: "var(--lg-sp-10) var(--lg-sp-4)",
        maxWidth: 1080,
        margin: "0 auto",
      }}
    >
      <h2
        id="features-heading"
        style={{
          fontSize: "var(--lg-fs-2xl)",
          fontWeight: "var(--lg-fw-bold)",
          letterSpacing: "var(--lg-tracking-title)",
          textAlign: "center",
          marginBottom: "var(--lg-sp-8)",
        }}
      >
        {heading}
      </h2>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "var(--lg-sp-4)",
        }}
      >
        {features.map((f, idx) => {
          const Icon = ICONS[idx % ICONS.length] ?? MessageSquareText;
          return (
            <li
              key={f.title}
              style={{
                padding: "var(--lg-sp-6)",
                borderRadius: "var(--lg-r-lg)",
                border: "1px solid var(--lg-border)",
                background: "var(--lg-paper)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--lg-sp-3)",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  borderRadius: "var(--lg-r-md)",
                  background: "var(--lg-accent)",
                  color: "var(--lg-accent-fg)",
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <h3
                style={{
                  fontSize: "var(--lg-fs-lg)",
                  fontWeight: "var(--lg-fw-semibold)",
                  color: "var(--lg-ink-deep)",
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontSize: "var(--lg-fs-md)",
                  color: "var(--lg-muted-fg)",
                  lineHeight: 1.5,
                }}
              >
                {f.body}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
