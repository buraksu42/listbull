/**
 * The 12 slash commands, mirroring `setMyCommands` in
 * src/lib/server/bot/index.ts. Source of truth — if you change one,
 * update the other.
 */
const COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "/items", desc: "Open to-dos." },
  { cmd: "/done", desc: "Completed items (reopen or archive)." },
  { cmd: "/memory", desc: "Memory keepsakes — never auto-deleted." },
  { cmd: "/tag <name>", desc: "Items filtered by tag, e.g. /tag michael." },
  { cmd: "/today", desc: "Today's items." },
  { cmd: "/thisweek", desc: "Items due this week." },
  { cmd: "/reminders", desc: "Pending reminders." },
  { cmd: "/password", desc: "Store / reveal passwords (DM-only save)." },
  {
    cmd: "/settings",
    desc: "Language, notifications, date formats, OpenRouter key.",
  },
  { cmd: "/onboarding", desc: "Interactive 8-step walkthrough." },
  { cmd: "/help", desc: "Command reference." },
  { cmd: "/reset", desc: "Clear conversation history." },
];

export function CommandList() {
  return (
    <div className="commands">
      {COMMANDS.map((c) => (
        <div key={c.cmd} className="cmd-row">
          <div className="cmd">{c.cmd}</div>
          <div className="cmd-purpose">{c.desc}</div>
        </div>
      ))}
    </div>
  );
}
