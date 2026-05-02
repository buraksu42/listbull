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
        padding: "var(--lb-sp-10) var(--lb-sp-4)",
        background: "var(--lb-card)",
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <h2
          id="how-heading"
          style={{
            fontSize: "var(--lb-fs-2xl)",
            fontWeight: "var(--lb-fw-bold)",
            letterSpacing: "var(--lb-tracking-title)",
            textAlign: "center",
            marginBottom: "var(--lb-sp-8)",
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
            gap: "var(--lb-sp-4)",
          }}
        >
          {steps.map((step, idx) => (
            <li
              key={step.title}
              style={{
                padding: "var(--lb-sp-6)",
                borderRadius: "var(--lb-r-lg)",
                background: "var(--lb-paper)",
                border: "1px solid var(--lb-border)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--lb-sp-3)",
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
                  borderRadius: "var(--lb-r-full)",
                  background: "var(--lb-ink-deep)",
                  color: "var(--lb-accent)",
                  fontWeight: "var(--lb-fw-bold)",
                  fontSize: "var(--lb-fs-md)",
                }}
              >
                {idx + 1}
              </span>
              <h3
                style={{
                  fontSize: "var(--lb-fs-lg)",
                  fontWeight: "var(--lb-fw-semibold)",
                  color: "var(--lb-ink-deep)",
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  fontSize: "var(--lb-fs-md)",
                  color: "var(--lb-muted-fg)",
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
