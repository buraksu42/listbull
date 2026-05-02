/**
 * "How it works" — 3-step illustration. No stock illustrations per
 * anti-list; we use small inline SVG steps and a numbered card pattern.
 */
type Step = { title: string; body: string };

type HowItWorksProps = {
  heading: string;
  steps: Step[];
};

export function HowItWorks({ heading, steps }: HowItWorksProps) {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      style={{
        padding: "var(--lg-sp-10) var(--lg-sp-4)",
        background: "var(--lg-card)",
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <h2
          id="how-heading"
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

        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "var(--lg-sp-4)",
          }}
        >
          {steps.map((step, idx) => (
            <li
              key={step.title}
              style={{
                padding: "var(--lg-sp-6)",
                borderRadius: "var(--lg-r-lg)",
                background: "var(--lg-paper)",
                border: "1px solid var(--lg-border)",
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
                  width: 32,
                  height: 32,
                  borderRadius: "var(--lg-r-full)",
                  background: "var(--lg-ink-deep)",
                  color: "var(--lg-accent)",
                  fontWeight: "var(--lg-fw-bold)",
                  fontSize: "var(--lg-fs-md)",
                }}
              >
                {idx + 1}
              </span>
              <h3
                style={{
                  fontSize: "var(--lg-fs-lg)",
                  fontWeight: "var(--lg-fw-semibold)",
                  color: "var(--lg-ink-deep)",
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  fontSize: "var(--lg-fs-md)",
                  color: "var(--lg-muted-fg)",
                  lineHeight: 1.5,
                }}
              >
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
