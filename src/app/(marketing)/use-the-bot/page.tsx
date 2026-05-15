import Link from "next/link";

export const metadata = {
  title: "Use the bot — listbull",
  description:
    "listbull is a Telegram-native to-do bot. Open the bot DM to start.",
};

export default function UseTheBotPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--lb-bg)",
        color: "var(--lb-fg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--lb-sp-6)",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(2rem, 5vw, 3.5rem)",
          fontWeight: 700,
          marginBottom: "var(--lb-sp-4)",
        }}
      >
        Open the bot in Telegram
      </h1>
      <p
        style={{
          fontSize: "var(--lb-fs-lg)",
          color: "var(--lb-muted-fg)",
          maxWidth: 560,
          lineHeight: 1.5,
          marginBottom: "var(--lb-sp-6)",
        }}
      >
        listbull is fully chat-driven. Open the bot DM, paste your
        OpenRouter API key (one-time setup), and start adding to-dos.
        For groups: add the bot to the group, the owner pastes the key,
        anyone in the group can mention the bot.
      </p>
      <div style={{ display: "flex", gap: "var(--lb-sp-3)" }}>
        <a
          href="https://t.me/listbull_test_bot"
          style={{
            padding: "var(--lb-sp-3) var(--lb-sp-6)",
            background: "var(--lb-accent)",
            color: "var(--lb-accent-fg)",
            borderRadius: "var(--lb-r-full)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Open @listbull_test_bot
        </a>
        <Link
          href="/"
          style={{
            padding: "var(--lb-sp-3) var(--lb-sp-6)",
            border: "1px solid var(--lb-border)",
            borderRadius: "var(--lb-r-full)",
            color: "var(--lb-fg)",
            textDecoration: "none",
          }}
        >
          Back
        </Link>
      </div>
    </main>
  );
}
