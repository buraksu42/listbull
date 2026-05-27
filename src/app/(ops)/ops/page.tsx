import {
  getOpsStats,
  parseOpsWindow,
  type OpsStats,
  type OpsWindow,
} from "@/lib/db/queries/ops";

/**
 * Brand-owner ops dashboard. Server Component, no client JS.
 *
 * Access is gated by `src/middleware.ts` (HTTP basic-auth via
 * LISTBULL_OPS_USER + LISTBULL_OPS_PASSWORD). Data layer: a single
 * `getOpsStats(window)` call that's also exposed at `/api/ops/stats` —
 * keep both consumers using the same helper so they can't drift.
 *
 * Window switcher is a plain `<form method="get">` so a vanilla
 * `<select>` triggers a server re-render with `?window=...` — zero
 * client JS, plays nicely with `force-dynamic`.
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
function ratio(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
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
  windowDays,
}: {
  data: Array<{ date: string; count: number }>;
  windowDays: OpsWindow;
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
        aria-label={`messages per day, last ${windowDays} days`}
      >
        {data.map((d, i) => {
          const h = (d.count / max) * (height - 4);
          // 90-day window squeezes bars to ~3px — leave a 1px gap up
          // to 30d, none at 90d so anything stays visible.
          const gap = windowDays >= 90 ? 0 : 1;
          return (
            <rect
              key={d.date}
              x={i * barWidth + gap / 2}
              y={height - h}
              width={Math.max(0.5, barWidth - gap)}
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

function CohortHeatmap({
  rows,
  maxCount,
}: {
  rows: Array<{ cohort: string; size: number; weeks: number[] }>;
  maxCount: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-zinc-500">No signup cohorts yet.</div>
    );
  }
  // Each cell: zinc-200 (0) → zinc-900 (maxCount). Tailwind doesn't
  // give us dynamic class names, so resolve to a discrete 5-step bucket.
  const cellBucket = (v: number): string => {
    if (v === 0 || maxCount === 0) return "fill-zinc-100";
    const ratio = v / maxCount;
    if (ratio < 0.2) return "fill-zinc-200";
    if (ratio < 0.4) return "fill-zinc-400";
    if (ratio < 0.6) return "fill-zinc-600";
    if (ratio < 0.8) return "fill-zinc-700";
    return "fill-zinc-900";
  };
  const cellW = 16;
  const cellH = 14;
  const gap = 2;
  const labelW = 70;
  const sizeW = 28;
  const cols = 12;
  const width = labelW + sizeW + cols * (cellW + gap);
  const height = rows.length * (cellH + gap);
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height + 16}`}
        width="100%"
        className="overflow-visible"
        role="img"
        aria-label="signup-week × active-week retention heatmap"
      >
        {/* column header: week offsets */}
        {Array.from({ length: cols }, (_, i) => (
          <text
            key={`h-${i}`}
            x={labelW + sizeW + i * (cellW + gap) + cellW / 2}
            y={10}
            textAnchor="middle"
            className="fill-zinc-400 text-[9px]"
          >
            W{i}
          </text>
        ))}
        {rows.map((row, ri) => (
          <g key={row.cohort} transform={`translate(0, ${16 + ri * (cellH + gap)})`}>
            <text
              x={0}
              y={cellH - 3}
              className="fill-zinc-600 text-[10px] tabular-nums"
            >
              {row.cohort}
            </text>
            <text
              x={labelW + sizeW - 4}
              y={cellH - 3}
              textAnchor="end"
              className="fill-zinc-500 text-[10px] tabular-nums"
            >
              {n(row.size)}
            </text>
            {row.weeks.map((v, ci) => (
              <rect
                key={ci}
                x={labelW + sizeW + ci * (cellW + gap)}
                y={0}
                width={cellW}
                height={cellH}
                rx={2}
                className={cellBucket(v)}
              >
                <title>{`${row.cohort} → W${ci}: ${v} active`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
        <span>less</span>
        <span className="inline-block h-2 w-3 rounded-sm bg-zinc-100" />
        <span className="inline-block h-2 w-3 rounded-sm bg-zinc-200" />
        <span className="inline-block h-2 w-3 rounded-sm bg-zinc-400" />
        <span className="inline-block h-2 w-3 rounded-sm bg-zinc-600" />
        <span className="inline-block h-2 w-3 rounded-sm bg-zinc-700" />
        <span className="inline-block h-2 w-3 rounded-sm bg-zinc-900" />
        <span>more</span>
        <span className="ml-auto">peak {n(maxCount)}</span>
      </div>
    </div>
  );
}

function DowBars({ data }: { data: Array<{ dow: number; count: number }> }) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const max = Math.max(1, ...data.map((d) => d.count));
  const width = 280;
  const height = 60;
  const barWidth = width / data.length;
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height + 14}`}
        width="100%"
        className="overflow-visible"
        role="img"
        aria-label="messages by day of week"
      >
        {data.map((d, i) => {
          const h = (d.count / max) * (height - 4);
          return (
            <g key={d.dow}>
              <rect
                x={i * barWidth + 2}
                y={height - h}
                width={barWidth - 4}
                height={h}
                rx={1}
                className="fill-zinc-700"
              >
                <title>{`${names[d.dow - 1]}: ${d.count}`}</title>
              </rect>
              <text
                x={i * barWidth + barWidth / 2}
                y={height + 10}
                textAnchor="middle"
                className="fill-zinc-400 text-[9px]"
              >
                {names[d.dow - 1]}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 text-[10px] text-zinc-400">
        peak {n(max)}
      </div>
    </div>
  );
}

function WindowSwitcher({ current }: { current: OpsWindow }) {
  // Plain GET form: <select> change reloads the page via JS via
  // `onChange` would need a client component; instead the operator
  // picks + clicks "Apply". Snappier than I expected on a fast LAN.
  // (If this ever feels slow, lift to a tiny client component that
  // calls router.push on change.)
  return (
    <form
      method="get"
      action="/ops"
      className="flex items-center gap-2 text-xs text-zinc-500"
    >
      <label htmlFor="window" className="text-zinc-600">
        Window
      </label>
      <select
        id="window"
        name="window"
        defaultValue={String(current)}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-800"
      >
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
      </select>
      <button
        type="submit"
        className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-zinc-700 hover:bg-zinc-100"
      >
        Apply
      </button>
    </form>
  );
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OpsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const window = parseOpsWindow(sp.window);
  const stats: OpsStats = await getOpsStats(window);
  const generated = new Date(stats.generatedAt).toUTCString();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          listbull · ops
        </h1>
        <div className="flex items-center gap-4">
          <WindowSwitcher current={stats.window} />
          <div className="text-xs text-zinc-500">generated {generated}</div>
        </div>
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

        <Card title={`Throughput (${stats.window}d)`}>
          <Sparkline
            data={stats.throughput.messagesByDay}
            windowDays={stats.window}
          />
          <div className="mt-3 text-xs text-zinc-500">
            messages/day across all chats
          </div>
        </Card>

        <Card title={`Velocity (${stats.window}d)`}>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Created"
              value={n(stats.velocity.createdInWindow)}
            />
            <Stat
              label="Completed"
              value={n(stats.velocity.completedInWindow)}
            />
            <Stat
              label="Close rate"
              value={ratio(
                stats.velocity.completedInWindow,
                stats.velocity.createdInWindow,
              )}
              hint={
                stats.velocity.completedInWindow >
                stats.velocity.createdInWindow
                  ? "burning down"
                  : stats.velocity.completedInWindow <
                      stats.velocity.createdInWindow
                    ? "backlog growing"
                    : "steady"
              }
            />
          </div>
        </Card>

        <Card title={`Tags (${stats.window}d, top 10)`}>
          <KV
            rows={
              stats.tags.topTags.length > 0
                ? stats.tags.topTags.map((t) => ({
                    k: `#${t.tag}`,
                    v: n(t.count),
                  }))
                : [{ k: "—", v: "" }]
            }
          />
          <div className="mt-3 text-[10px] text-zinc-400">
            live items only (archived excluded)
          </div>
        </Card>

        <Card title={`Retention (${stats.window}d)`}>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Signups"
              value={n(stats.retention.signedUpInWindow)}
            />
            <Stat
              label="Active users"
              value={n(stats.retention.activeInWindow)}
            />
            <Stat
              label="Active share"
              value={ratio(
                stats.retention.activeInWindow,
                stats.retention.totalUsers,
              )}
              hint={`/ ${n(stats.retention.totalUsers)} total`}
            />
          </div>
        </Card>

        <Card title="Items per chat">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="p50" value={n(stats.itemsPerChat.p50)} />
            <Stat label="p95" value={n(stats.itemsPerChat.p95)} />
            <Stat label="max" value={n(stats.itemsPerChat.max)} />
            <Stat
              label="avg"
              value={stats.itemsPerChat.avg.toFixed(1)}
            />
          </div>
          <div className="mt-3 text-[10px] text-zinc-400">
            live items per chat (archived excluded). p95-vs-max gap
            flags power-user outliers.
          </div>
        </Card>

        <Card title="Attachments">
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Total"
              value={n(stats.attachments.totalCount)}
            />
            <Stat
              label="Storage"
              value={formatBytes(stats.attachments.totalBytes)}
              hint="Telegram CDN proxy"
            />
            <Stat
              label={`Added ${stats.window}d`}
              value={n(stats.attachments.addedInWindow)}
            />
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            By kind: {renderRecord(stats.attachments.byKind)}
          </div>
        </Card>

        <Card title={`Group engagement (${stats.window}d)`}>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Groups"
              value={n(stats.groupEngagement.groupChats)}
              hint="archived excluded"
            />
            <Stat
              label="Total members"
              value={n(stats.groupEngagement.totalMembers)}
              hint={`avg ${n(stats.groupEngagement.avgMembersPerGroup)}/group`}
            />
            <Stat
              label="Active share"
              value={pct(stats.groupEngagement.activeRatio)}
              hint={`${n(stats.groupEngagement.activeMembersInWindow)} active`}
            />
          </div>
          <div className="mt-3 text-[10px] text-zinc-400">
            active = posted ≥1 message in window. DMs excluded.
          </div>
        </Card>

        <Card title="Cohort retention (12-week)">
          <CohortHeatmap
            rows={stats.cohortRetention.rows}
            maxCount={stats.cohortRetention.maxCount}
          />
          <div className="mt-3 text-[10px] text-zinc-400">
            row = signup ISO-week · column = weeks since signup (W0–W11)
          </div>
        </Card>

        <Card title={`Day-of-week seasonality (${stats.window}d)`}>
          <DowBars data={stats.dowSeasonality.byDow} />
          <div className="mt-2 text-xs text-zinc-500">
            messages per ISO weekday across all chats
          </div>
        </Card>

        <Card title="Chat lifespan">
          <div className="grid grid-cols-4 gap-3">
            <Stat
              label="Archived"
              value={n(stats.chatLifespan.archivedCount)}
              hint={`${pct(stats.chatLifespan.archivedRate)} of ${n(stats.chatLifespan.totalChats)}`}
            />
            <Stat
              label="p50 days"
              value={n(stats.chatLifespan.p50Days)}
            />
            <Stat
              label="p95 days"
              value={n(stats.chatLifespan.p95Days)}
            />
            <Stat
              label="max days"
              value={n(stats.chatLifespan.maxDays)}
            />
          </div>
          <div className="mt-3 text-[10px] text-zinc-400">
            time between chat creation and archive. avg{" "}
            {stats.chatLifespan.avgDays.toFixed(1)} days.
          </div>
        </Card>

        <Card title={`Reminders efficacy (${stats.window}d)`}>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Fired"
              value={n(stats.remindersEfficacy.firedInWindow)}
            />
            <Stat
              label="Overdue"
              value={n(stats.remindersEfficacy.overdueInWindow)}
              hint="due in window, still unsent"
            />
            <Stat
              label="Efficacy"
              value={pct(stats.remindersEfficacy.efficacy)}
              hint={
                stats.remindersEfficacy.efficacy >= 0.99
                  ? "cron healthy"
                  : stats.remindersEfficacy.efficacy >= 0.9
                    ? "minor drift"
                    : "investigate cron"
              }
            />
          </div>
        </Card>

        <Card title={`Activity (${stats.window}d, top 10)`}>
          <KV
            rows={
              stats.activity.topActions.length > 0
                ? stats.activity.topActions.map((a) => ({
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
          href={`/api/ops/stats?window=${stats.window}`}
        >
          /api/ops/stats?window={stats.window}
        </a>{" "}
        — same data, machine-readable
      </footer>
    </main>
  );
}
