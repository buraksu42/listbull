"use client";

type Shot = {
  src: string;
  alt: string;
  caption: string;
};

const SHOTS: Shot[] = [
  {
    src: "/marketing/screenshots/items.png",
    alt: "Screenshot of the /items command listing open to-dos with toggle and action buttons",
    caption: "/items — your open list",
  },
  {
    src: "/marketing/screenshots/checklist.png",
    alt: "Screenshot of a checklist parent with three sub-items in the drill-in view",
    caption: "Checklist with gate-complete",
  },
  {
    src: "/marketing/screenshots/password-reveal.png",
    alt: "Screenshot of /password reveal showing a 15-second countdown self-destruct message",
    caption: "/password — 15s self-destruct",
  },
  {
    src: "/marketing/screenshots/onboarding.png",
    alt: "Screenshot of the interactive onboarding walkthrough step 3 of 8",
    caption: "/onboarding — 8-step walkthrough",
  },
];

/**
 * Four-shot mosaic. Images are placeholders until the user drops
 * real PNGs into public/marketing/screenshots/. A graceful fallback
 * (CSS gradient block + caption) renders if an image is missing.
 *
 * Uses plain <img> rather than next/image because next/image would
 * 404-fail the build if the asset is missing; a soft missing-image
 * placeholder is preferable while the page ships before art.
 */
export function ScreenshotMosaic() {
  return (
    <section
      aria-labelledby="lb-shots-title"
      className="mx-auto w-full max-w-6xl px-6 py-16"
    >
      <h2
        id="lb-shots-title"
        className="mb-2 text-center text-2xl font-semibold sm:text-3xl"
        style={{ letterSpacing: "var(--lb-tracking-title)" }}
      >
        See it in the wild
      </h2>
      <p
        className="mx-auto mb-10 max-w-2xl text-center text-base"
        style={{ color: "var(--lb-muted-fg)" }}
      >
        Four moments from a real chat with the bot.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {SHOTS.map((shot) => (
          <figure
            key={shot.src}
            className="overflow-hidden rounded-2xl border"
            style={{
              borderColor: "var(--lb-border)",
              background: "var(--lb-card)",
            }}
          >
            <div
              className="relative aspect-[9/16] w-full overflow-hidden"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in oklch, var(--lb-accent) 12%, var(--lb-card)) 0%, var(--lb-card) 80%)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shot.src}
                alt={shot.alt}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
                onError={(e) => {
                  // Graceful fallback when the asset hasn't been
                  // dropped in yet — hide the broken-image icon and
                  // let the gradient + caption speak.
                  (e.currentTarget as HTMLImageElement).style.display =
                    "none";
                }}
              />
            </div>
            <figcaption
              className="px-3 py-2 text-xs"
              style={{ color: "var(--lb-muted-fg)" }}
            >
              {shot.caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
