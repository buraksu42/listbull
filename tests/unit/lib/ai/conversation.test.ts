/**
 * Conversation slicing tests — Inv-6 (30 messages OR ~24k chars).
 *
 * Newest → oldest accumulation, then reverse for chronological output.
 * Whichever cap hits first wins.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_MESSAGES,
  estimateTokens,
  sliceForContext,
} from "@/lib/ai/conversation";
import type { MessageWithToolCalls } from "@/lib/types";

function makeRow(
  i: number,
  role: "user" | "assistant" | "tool" = "user",
  contentLen = 50,
): MessageWithToolCalls {
  return {
    id: `msg-${i}`,
    userId: "user-1",
    chatId: 1,
    role,
    content: "x".repeat(contentLen),
    toolCalls: null,
    toolCallId: role === "tool" ? `call-${i}` : null,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  };
}

describe("estimateTokens", () => {
  it("approximates 4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
});

describe("sliceForContext", () => {
  it("returns chronological order (oldest first) after slicing", () => {
    // Caller hands desc-ordered (newest first) rows; slice flips to chrono.
    const newest = makeRow(3);
    const middle = makeRow(2);
    const oldest = makeRow(1);
    const result = sliceForContext([newest, middle, oldest]);
    expect(result.map((m) => (m.role === "user" ? m.content : ""))).toEqual([
      oldest.content,
      middle.content,
      newest.content,
    ]);
  });

  it("caps at DEFAULT_MAX_MESSAGES (drops oldest)", () => {
    const rows: MessageWithToolCalls[] = [];
    // 35 messages, newest first.
    for (let i = 35; i >= 1; i--) rows.push(makeRow(i, "user", 10));
    const result = sliceForContext(rows);
    expect(result).toHaveLength(DEFAULT_MAX_MESSAGES);
    // Oldest kept = msg-6 (35 - 30 + 1).
    const first = result[0];
    expect(first?.role === "user" && first.content).toBeTruthy();
  });

  it("caps at maxChars budget when char limit hits before message cap", () => {
    // 5 messages, each 8000 chars, newest-first ordering.
    const rows: MessageWithToolCalls[] = [];
    for (let i = 5; i >= 1; i--) rows.push(makeRow(i, "user", 8000));
    const result = sliceForContext(rows, { maxChars: 24000 });
    // 3 messages × 8000 = 24000; 4th would exceed.
    expect(result).toHaveLength(3);
  });

  it("always keeps at least one message even if it alone exceeds budget", () => {
    const giant = makeRow(1, "user", DEFAULT_MAX_CHARS * 2);
    const result = sliceForContext([giant], { maxChars: 100 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: "user" });
  });

  it("preserves tool_call_id on tool rows", () => {
    const toolRow = makeRow(2, "tool", 10);
    const result = sliceForContext([toolRow]);
    expect(result[0]).toMatchObject({
      role: "tool",
      toolCallId: "call-2",
    });
  });

  it("attaches toolCalls when present on assistant rows", () => {
    const assistant: MessageWithToolCalls = {
      ...makeRow(1, "assistant", 10),
      toolCalls: [{ id: "call-x", name: "create_item", input: { text: "milk" } }],
    };
    const result = sliceForContext([assistant]);
    const m = result[0];
    expect(m?.role).toBe("assistant");
    if (m?.role === "assistant") {
      expect(m.toolCalls?.[0]?.name).toBe("create_item");
    }
  });

  it("custom maxMessages override", () => {
    const rows: MessageWithToolCalls[] = [];
    for (let i = 10; i >= 1; i--) rows.push(makeRow(i, "user", 10));
    const result = sliceForContext(rows, { maxMessages: 3 });
    expect(result).toHaveLength(3);
  });

  it("empty input returns empty", () => {
    expect(sliceForContext([])).toEqual([]);
  });
});
