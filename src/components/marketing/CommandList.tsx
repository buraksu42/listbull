/**
 * The 12 slash commands, mirroring `setMyCommands` in
 * src/lib/server/bot/index.ts. Source of truth; if you change either
 * one update the other.
 */
const COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "/items", desc: "Open to-dos" },
  { cmd: "/done", desc: "Completed items (reopen / archive)" },
  { cmd: "/memory", desc: "Memory keepsakes — never auto-deleted" },
  { cmd: "/tag <name>", desc: "Items filtered by tag (e.g. /tag burak)" },
  { cmd: "/today", desc: "Today's items" },
  { cmd: "/thisweek", desc: "Items due this week" },
  { cmd: "/reminders", desc: "Pending reminders" },
  { cmd: "/password", desc: "Store / reveal passwords (DM-only save)" },
  { cmd: "/settings", desc: "Language, notifications, formats, OpenRouter key" },
  { cmd: "/onboarding", desc: "Interactive 8-step walkthrough" },
  { cmd: "/help", desc: "Command reference" },
  { cmd: "/reset", desc: "Clear conversation history" },
];

export function CommandList() {
  return (
    <section
      aria-labelledby="lb-commands-title"
      className="mx-auto w-full max-w-4xl px-6 py-16"
    >
      <h2
        id="lb-commands-title"
        className="mb-2 text-center text-2xl font-semibold sm:text-3xl"
        style={{ letterSpacing: "var(--lb-tracking-title)" }}
      >
        12 slash commands
      </h2>
      <p
        className="mx-auto mb-10 max-w-2xl text-center text-base"
        style={{ color: "var(--lb-muted-fg)" }}
      >
        Plus natural-language. Type anything; the bot figures out
        whether it&rsquo;s a to-do, a reminder, a question, or a chat.
      </p>
      <div
        className="overflow-hidden rounded-2xl border"
        style={{ borderColor: "var(--lb-border)" }}
      >
        <table className="w-full text-left text-sm">
          <thead
            className="text-xs uppercase tracking-wide"
            style={{
              background: "var(--lb-card)",
              color: "var(--lb-muted-fg)",
            }}
          >
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">
                Command
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Purpose
              </th>
            </tr>
          </thead>
          <tbody>
            {COMMANDS.map((c, idx) => (
              <tr
                key={c.cmd}
                className="border-t"
                style={{ borderColor: "var(--lb-border)" }}
              >
                <td
                  className="whitespace-nowrap px-5 py-3 font-mono text-sm"
                  style={{
                    background:
                      idx % 2 === 0 ? "var(--lb-subtle)" : "transparent",
                  }}
                >
                  {c.cmd}
                </td>
                <td
                  className="px-5 py-3"
                  style={{
                    color: "var(--lb-muted-fg)",
                    background:
                      idx % 2 === 0 ? "var(--lb-subtle)" : "transparent",
                  }}
                >
                  {c.desc}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
