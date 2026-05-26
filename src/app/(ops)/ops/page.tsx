import { getOpsStats, type OpsStats } from "@/lib/db/queries/ops";

/**
 * Brand-owner ops dashboard. Server Component, no client JS.
 *
 * Access is gated by `src/middleware.ts` (HTTP basic-auth via
 * LISTBULL_OPS_USER + LISTBULL_OPS_PASSWORD). Data layer: a single
 * `getOpsStats()` call that's also exposed at `/api/ops/stats` —
 * keep both consumers using the same helper so they can't drift.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const numFmt = new Intl.NumberFormat("en-US");
function n(v: number): string {
  return numFmt.format(v);
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums text-zinc-900">
        {value}
      </div>
      <div className="text-xs text-zinc-500">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-zinc-400">{hint}</div>}
    </div>
  );
}

function KV({ rows }: { rows: Array<{ k: string; v: string | number }> }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="text-zinc-600">{r.k}</dt>
          <dd className="tabular-nums text-zinc-900">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sparkline({
  data,
}: {
  data: Array<{ date: string; count: number }>;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  const width = 280;
  const height = 60;
  const barWidth = width / data.length;
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        className="overflow-visible"
        role="img"
        aria-label="messages per day, last 14 days"
      >
        {data.map((d, i) => {
          const h = (d.count / max) * (height - 4);
          return (
            <rect
              key={d.date}
              x={i * barWidth + 1}
              y={height - h}
              width={barWidth - 2}
              height={h}
              rx={1}
              className="fill-zinc-700"
            >
              <title>{`${d.date}: ${d.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>{data[0]?.date}</span>
        <span>peak {n(max)}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function renderRecord(rec: Record<string, number>): string {
  const entries = Object.entries(rec);
  if (entries.length === 0) return "—";
  return entries.map(([k, v]) => `${k} ${n(v)}`).join(" · ");
}

export default async function OpsPage() {
  const stats: OpsStats = await getOpsStats();
  const generated = new Date(stats.generatedAt).toUTCString();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          listbull · ops
        </h1>
        <div className="text-xs text-zinc-500">generated {generated}</div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title="Users">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total" value={n(stats.users.total)} />
            <Stat label="Active 7d" value={n(stats.users.activeLast7d)} />
            <Stat label="Active 30d" value={n(stats.users.activeLast30d)} />
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-xs text-zinc-500">
              Locales: {renderRecord(stats.users.localeSplit)}
            </div>
            <div className="text-xs text-zinc-500">
              Top TZ:{" "}
              {stats.users.topTimezones
                .map((t) => `${t.timezone} ${n(t.count)}`)
                .join(" · ") || "—"}
            </div>
          </div>
        </Card>

        <Card title="Chats">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total" value={n(stats.chats.total)} />
            <Stat
              label="With own key"
              value={n(stats.chats.keyedCount)}
              hint={pct(stats.chats.keyedShare)}
            />
            <Stat
              label="DM / Group"
              value={`${n(stats.chats.byType.private ?? 0)} / ${n(
                (stats.chats.byType.group ?? 0) +
                  (stats.chats.byType.supergroup ?? 0),
              )}`}
            />
          </div>
          <div className="mt-4">
            <div className="mb-1 text-xs text-zinc-500">
              Top active (msgs/30d)
            </div>
            <KV
              rows={
                stats.chats.topActive.length > 0
                  ? stats.chats.topActive.map((c) => ({
                      k: `${c.title ?? `chat ${c.chatId}`} · ${c.type}`,
                      v: n(c.messageCount),
                    }))
                  : [{ k: "—", v: "" }]
              }
            />
          </div>
        </Card>

        <Card title="Items">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Open" value={n(stats.items.totalOpen)} />
            <Stat label="Done" value={n(stats.items.totalDone)} />
            <Stat label="Archived" value={n(stats.items.totalArchived)} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat
              label="Overdue"
              value={n(stats.items.overdue)}
              hint="open + past deadline"
            />
            <Stat label="Created 7d" value={n(stats.items.createdLast7d)} />
            <Stat label="Completed 7d" value={n(stats.items.completedLast7d)} />
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-xs text-zinc-500">
              Status: {renderRecord(stats.items.byStatus)}
            </div>
            <div className="text-xs text-zinc-500">
              Priority: {renderRecord(stats.items.byPriority)}
            </div>
            <div className="text-xs text-zinc-500">
              Kind: {renderRecord(stats.items.byKind)}
            </div>
          </div>
        </Card>

        <Card title="Throughput (14d)">
          <Sparkline data={stats.throughput.messagesLast14d} />
          <div className="mt-3 text-xs text-zinc-500">
            messages/day across all chats
          </div>
        </Card>

        <Card title="Activity (top 10, 7d)">
          <KV
            rows={
              stats.activity.topActionsLast7d.length > 0
                ? stats.activity.topActionsLast7d.map((a) => ({
                    k: a.action,
                    v: n(a.count),
                  }))
                : [{ k: "—", v: "" }]
            }
          />
        </Card>

        <Card title="Models (user preferences)">
          <KV
            rows={
              stats.models.topModels.length > 0
                ? stats.models.topModels.map((m) => ({
                    k: m.model,
                    v: n(m.count),
                  }))
                : [{ k: "—", v: "" }]
            }
          />
          <div className="mt-3 text-xs text-zinc-400">
            What users picked in /settings. Free tier ignores this and
            uses LISTBULL_FREE_MODEL.
          </div>
        </Card>

        <Card title="Reminders">
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Pending next 24h"
              value={n(stats.reminders.pendingNext24h)}
            />
            <Stat label="Fired last 7d" value={n(stats.reminders.firedLast7d)} />
          </div>
        </Card>
      </div>

      <footer className="mt-8 text-xs text-zinc-400">
        JSON:{" "}
        <a
          className="underline decoration-dotted hover:text-zinc-600"
          href="/api/ops/stats"
        >
          /api/ops/stats
        </a>{" "}
        — same data, machine-readable
      </footer>
    </main>
  );
}
