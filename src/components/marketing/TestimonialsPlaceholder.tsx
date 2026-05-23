type Quote = {
  body: string;
  author: string;
};

const PLACEHOLDERS: Quote[] = [
  {
    body: "Your testimonial here. Did the bot save you 20 minutes today? Tell us.",
    author: "— You, after using listbull for a week",
  },
  {
    body: "Voice notes from the car turning into real reminders. Game-changer.",
    author: "— Future early adopter",
  },
  {
    body: "/password replaced 1Password for my low-stakes shared credentials.",
    author: "— Someone who values tap-to-copy",
  },
];

/**
 * Testimonials placeholder. Filled with prompts that suggest what a
 * good testimonial would look like, so the page doesn't read as
 * empty while real quotes are being gathered.
 */
export function TestimonialsPlaceholder() {
  return (
    <section
      aria-labelledby="lb-testimonials-title"
      className="mx-auto w-full max-w-6xl px-6 py-16"
    >
      <h2
        id="lb-testimonials-title"
        className="mb-2 text-center text-2xl font-semibold sm:text-3xl"
        style={{ letterSpacing: "var(--lb-tracking-title)" }}
      >
        Used it? Tell us.
      </h2>
      <p
        className="mx-auto mb-10 max-w-2xl text-center text-base"
        style={{ color: "var(--lb-muted-fg)" }}
      >
        Real quotes go here. The placeholders below show what&rsquo;d
        land well.
      </p>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PLACEHOLDERS.map((q, i) => (
          <li
            key={i}
            className="rounded-2xl border p-6"
            style={{
              borderColor: "var(--lb-border)",
              background: "var(--lb-card)",
            }}
          >
            <blockquote className="mb-3 text-base leading-relaxed">
              <span aria-hidden className="mr-2 text-2xl leading-none" style={{ color: "var(--lb-accent)" }}>
                &ldquo;
              </span>
              {q.body}
            </blockquote>
            <footer className="text-xs" style={{ color: "var(--lb-muted-fg)" }}>
              {q.author}
            </footer>
          </li>
        ))}
      </ul>
      <p
        className="mt-8 text-center text-sm"
        style={{ color: "var(--lb-muted-fg)" }}
      >
        Like the bot? DM{" "}
        <a
          href="https://github.com/buraksu42"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:underline"
          style={{ color: "var(--lb-fg)" }}
        >
          @buraksu42
        </a>{" "}
        — your quote may land here.
      </p>
    </section>
  );
}
