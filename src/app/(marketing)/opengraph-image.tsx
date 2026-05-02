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
        {/* Brand mark */}
        <svg
          width={220}
          height={220}
          viewBox="0 0 100 100"
          style={{ marginBottom: 40 }}
        >
          <path
            d="M28 14 L72 14 C82 14 90 22 90 32 L90 60 C90 70 82 78 72 78 L40 78 L26 90 L28 76 C20 73 14 66 14 58 L14 32 C14 22 22 14 28 14 Z"
            fill="#00D9C0"
          />
          <path
            d="M34 46 L44 56 L64 34"
            stroke="#0A1419"
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>

        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            color: "#0A1419",
            letterSpacing: "-0.02em",
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
