import { Check } from "lucide-react";

type Tier = {
  name: string;
  price: string;
  priceSuffix: string;
  bullet: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlighted?: boolean;
};

/**
 * Phase 5 marketing pricing grid. 3 tiers stacked on mobile, 3-col
 * on desktop. Locale-aware pricing (TRY / USD) is the caller's job —
 * they pass `tiers` populated for the right currency.
 */
export function PricingGrid({
  heading,
  subheading,
  tiers,
}: {
  heading: string;
  subheading: string;
  tiers: Tier[];
}) {
  return (
    <section
      id="pricing"
      style={{
        padding: "var(--lb-sp-12) var(--lb-sp-6)",
        maxWidth: "1280px",
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div
        style={{
          textAlign: "center",
          marginBottom: "var(--lb-sp-8)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-2)",
        }}
      >
        <h2
          style={{
            fontSize: "var(--lb-fs-2xl)",
            fontWeight: "var(--lb-fw-semibold)",
            letterSpacing: "var(--lb-tracking-title)",
            margin: 0,
          }}
        >
          {heading}
        </h2>
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-base)",
            margin: 0,
          }}
        >
          {subheading}
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "var(--lb-sp-4)",
          alignItems: "stretch",
        }}
      >
        {tiers.map((t) => (
          <div
            key={t.name}
            style={{
              background: "var(--lb-card)",
              border: t.highlighted
                ? "2px solid var(--lb-accent)"
                : "1px solid var(--lb-border)",
              borderRadius: "var(--lb-radius-md)",
              padding: "var(--lb-sp-6)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--lb-sp-4)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "var(--lb-fs-sm)",
                  color: "var(--lb-muted-fg)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "var(--lb-sp-1)",
                }}
              >
                {t.name}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--lb-sp-1)",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--lb-fs-3xl, 32px)",
                    fontWeight: "var(--lb-fw-semibold)",
                  }}
                >
                  {t.price}
                </span>
                <span
                  style={{
                    color: "var(--lb-muted-fg)",
                    fontSize: "var(--lb-fs-sm)",
                  }}
                >
                  {t.priceSuffix}
                </span>
              </div>
              <p
                style={{
                  color: "var(--lb-muted-fg)",
                  fontSize: "var(--lb-fs-sm)",
                  margin: "var(--lb-sp-2) 0 0",
                }}
              >
                {t.bullet}
              </p>
            </div>

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--lb-sp-2)",
                flex: 1,
              }}
            >
              {t.features.map((f) => (
                <li
                  key={f}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--lb-sp-2)",
                    fontSize: "var(--lb-fs-sm)",
                  }}
                >
                  <Check
                    width={16}
                    height={16}
                    aria-hidden
                    style={{
                      color: "var(--lb-accent)",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  />
                  {f}
                </li>
              ))}
            </ul>

            <a
              href={t.ctaHref}
              style={{
                display: "block",
                textAlign: "center",
                padding: "var(--lb-sp-2) var(--lb-sp-4)",
                borderRadius: "var(--lb-radius-md)",
                fontWeight: "var(--lb-fw-medium)",
                fontSize: "var(--lb-fs-sm)",
                textDecoration: "none",
                background: t.highlighted
                  ? "var(--lb-accent)"
                  : "transparent",
                color: t.highlighted
                  ? "var(--lb-accent-fg)"
                  : "var(--lb-fg)",
                border: t.highlighted
                  ? "none"
                  : "1px solid var(--lb-border)",
              }}
            >
              {t.cta}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Build the default tier list. Caller chooses currency by locale.
 * TRY pricing matches the architect-pass-phase-4.5 § Pricing block:
 * ₺179/ay Team, ₺549/ay Workspace (subject to FX revision).
 */
export function buildDefaultTiers(
  currency: "TRY" | "USD",
  botUrl: string,
): Tier[] {
  const teamPrice = currency === "TRY" ? "₺179" : "$5";
  const workspacePrice = currency === "TRY" ? "₺549" : "$15";
  const suffix = currency === "TRY" ? "/ay" : "/mo";

  return [
    {
      name: "Free",
      price: currency === "TRY" ? "₺0" : "$0",
      priceSuffix: suffix,
      bullet: "Tek kullanıcı, tek workspace.",
      features: [
        "Tüm AI özellikleri (BYOK)",
        "Sınırsız liste + madde",
        "Tek-listede paylaşım",
        "Tekrarlayan görevler",
        "30 gün audit log",
      ],
      cta: "Telegram'da aç",
      ctaHref: botUrl,
    },
    {
      name: "Team",
      price: teamPrice,
      priceSuffix: suffix,
      bullet: "5 üyeye kadar, 1 workspace.",
      features: [
        "Free planındaki her şey",
        "Workspace üyelikleri (5 üye)",
        "Viewer + guest rolleri",
        "Tüm liste + reminder paylaşımı",
        "90 gün audit log",
      ],
      cta: "Team ile başla",
      ctaHref: botUrl,
      highlighted: true,
    },
    {
      name: "Workspace",
      price: workspacePrice,
      priceSuffix: suffix,
      bullet: "15 üyeye kadar, 3 workspace.",
      features: [
        "Team planındaki her şey",
        "Workspace üyelikleri (15 üye)",
        "Admin + custom roller",
        "White-label bot",
        "Org-level OpenRouter key",
        "Sınırsız audit log + bulk restore",
      ],
      cta: "Workspace ile başla",
      ctaHref: botUrl,
    },
  ];
}
