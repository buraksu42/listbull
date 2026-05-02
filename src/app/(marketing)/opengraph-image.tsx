import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "listbull — Telegram-native AI list assistant";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

/**
 * Open Graph image for the marketing landing.
 *
 * Light background + brand teal mark + wordmark + tagline. Rendered with
 * next/og at request time — no static asset to maintain. Anti-list
 * strict: no gradient bg, no glow.
 */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Brand mark — bull head (teal) + cobalt check-horns */}
        <svg
          width={220}
          height={220}
          viewBox="0 0 100 100"
          style={{ marginBottom: 40 }}
        >
          <path
            d="M50 34 C60 34 68 38 72 46 C74 52 74 58 72 64 C68 76 60 84 50 84 C40 84 32 76 28 64 C26 58 26 52 28 46 C32 38 40 34 50 34 Z"
            fill="#00D9C0"
          />
          <path
            d="M16 22 L26 32 L42 8"
            stroke="#3D7DFF"
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M84 22 L74 32 L58 8"
            stroke="#3D7DFF"
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx={44} cy={68} r={1.8} fill="#0A1419" opacity={0.55} />
          <circle cx={56} cy={68} r={1.8} fill="#0A1419" opacity={0.55} />
        </svg>

        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            color: "#0A1419",
            letterSpacing: "-0.035em",
            marginBottom: 16,
          }}
        >
          listbull
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 40,
            fontWeight: 500,
            color: "#0A1419",
            textAlign: "center",
          }}
        >
          Your todos, in Telegram.
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#707579",
            marginTop: 24,
          }}
        >
          Open source · BYOK · Self-hostable
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
