/**
 * LLM spend section for the workspace admin dashboard (Phase 7 +
 * Phase 8). Server component — reads getWorkspaceLlmSpend +
 * getWorkspaceLlmDailySeries in parallel. 30-day window.
 *
 * Phase 8 additions:
 *  - cost extraction via MODEL_PRICING (no more 0 placeholders for
 *    common models)
 *  - sparkline visualization of daily token totals over the window
 */
import {
  getWorkspaceLlmDailySeries,
  getWorkspaceLlmSpend,
} from "@/lib/db/queries/llm-usage";
import { SpendSparkline } from "@/components/workspace/spend-sparkline";

type Props = {
  workspaceId: string;
};

export async function SpendSection({ workspaceId }: Props) {
  const [spend, series] = await Promise.all([
    getWorkspaceLlmSpend(workspaceId, 30),
    getWorkspaceLlmDailySeries(workspaceId, 30),
  ]);

  const totalTokens = spend.totalPromptTokens + spend.totalCompletionTokens;
  const usdTotal = spend.totalCostUsdMicro / 1_000_000;

  return (
    <section>
      <div
        style={{
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "var(--lb-sp-2)",
        }}
      >
        LLM spend (30 day window)
      </div>
      <div
        style={{
          background: "var(--lb-card)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          padding: "var(--lb-sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-3)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "var(--lb-sp-4)",
            flexWrap: "wrap",
          }}
        >
          <Stat label="Prompt tokens" value={spend.totalPromptTokens} />
          <Stat
            label="Completion tokens"
            value={spend.totalCompletionTokens}
          />
          <Stat label="Total tokens" value={totalTokens} />
          {usdTotal > 0 && (
            <Stat
              label="USD"
              value={`$${usdTotal.toFixed(4)}`}
              isString
            />
          )}
        </div>

        {totalTokens > 0 && (
          <div
            style={{
              borderTop: "1px solid var(--lb-border)",
              paddingTop: "var(--lb-sp-3)",
            }}
          >
            <div
              style={{
                fontSize: "var(--lb-fs-xs)",
                color: "var(--lb-muted-fg)",
                marginBottom: "var(--lb-sp-2)",
              }}
            >
              Daily tokens (30 day trend)
            </div>
            <SpendSparkline series={series} metric="tokens" />
          </div>
        )}

        {spend.byModel.length > 0 && (
          <div
            style={{
              borderTop: "1px solid var(--lb-border)",
              paddingTop: "var(--lb-sp-3)",
            }}
          >
            <div
              style={{
                fontSize: "var(--lb-fs-xs)",
                color: "var(--lb-muted-fg)",
                marginBottom: "var(--lb-sp-2)",
              }}
            >
              By model
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--lb-sp-1)",
              }}
            >
              {spend.byModel.map((m) => (
                <li
                  key={m.model}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "var(--lb-fs-sm)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--lb-font-mono, monospace)",
                      color: "var(--lb-fg)",
                    }}
                  >
                    {m.model}
                  </span>
                  <span style={{ color: "var(--lb-muted-fg)" }}>
                    {m.callCount} call{m.callCount === 1 ? "" : "s"} ·{" "}
                    {(
                      m.promptTokens + m.completionTokens
                    ).toLocaleString()}{" "}
                    tokens
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {spend.byMember.length > 0 && (
          <div
            style={{
              borderTop: "1px solid var(--lb-border)",
              paddingTop: "var(--lb-sp-3)",
            }}
          >
            <div
              style={{
                fontSize: "var(--lb-fs-xs)",
                color: "var(--lb-muted-fg)",
                marginBottom: "var(--lb-sp-2)",
              }}
            >
              By member
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--lb-sp-1)",
              }}
            >
              {spend.byMember.map((m) => (
                <li
                  key={m.userId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "var(--lb-fs-sm)",
                  }}
                >
                  <span style={{ color: "var(--lb-fg)" }}>
                    {m.telegramFirstName}
                    {m.telegramUsername && (
                      <span
                        style={{
                          marginLeft: "var(--lb-sp-1)",
                          color: "var(--lb-muted-fg)",
                          fontSize: "var(--lb-fs-xs)",
                        }}
                      >
                        @{m.telegramUsername}
                      </span>
                    )}
                  </span>
                  <span style={{ color: "var(--lb-muted-fg)" }}>
                    {m.callCount} call{m.callCount === 1 ? "" : "s"} ·{" "}
                    {(
                      m.promptTokens + m.completionTokens
                    ).toLocaleString()}{" "}
                    tokens
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {spend.byModel.length === 0 && (
          <p
            style={{
              color: "var(--lb-muted-fg)",
              fontSize: "var(--lb-fs-sm)",
              margin: 0,
            }}
          >
            Henüz LLM kullanımı kayıtlı değil.
          </p>
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  isString = false,
}: {
  label: string;
  value: number | string;
  isString?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "var(--lb-fs-xl)",
          fontWeight: "var(--lb-fw-semibold)",
        }}
      >
        {isString ? value : Number(value).toLocaleString()}
      </div>
    </div>
  );
}
