"use client";

/**
 * Hero demo GIF. ~2-3 MB target.
 *
 * Plain <img loading="lazy"> rather than next/image so the asset is
 * served as-is (animated GIFs survive better outside the Next image
 * pipeline). If the GIF is missing, falls back to a static PNG with
 * the same base name; if that's missing too, the figure renders an
 * empty placeholder gradient.
 */
export function DemoGif() {
  return (
    <section
      aria-labelledby="lb-demo-title"
      className="mx-auto w-full max-w-4xl px-6 py-8"
    >
      <h2 id="lb-demo-title" className="sr-only">
        Demo
      </h2>
      <figure
        className="overflow-hidden rounded-3xl border"
        style={{
          borderColor: "var(--lb-border)",
          background: "var(--lb-card)",
        }}
      >
        <div
          className="relative aspect-video w-full overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklch, var(--lb-accent) 20%, var(--lb-card)) 0%, var(--lb-card) 100%)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/marketing/demo.gif"
            alt="A 10-second animated demo of adding to-dos, setting a reminder, and revealing a password in chat"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              if (img.src.endsWith(".gif")) {
                img.src = "/marketing/demo.png";
              } else {
                img.style.display = "none";
              }
            }}
          />
        </div>
      </figure>
    </section>
  );
}
