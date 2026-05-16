/**
 * Sub-items drill-in view (Phase 17c — checklist UX).
 *
 * Renders the children of a top-level todo. Reached from the
 * 📂 Alt-itemlar button rendered in /items when a parent has at
 * least one live child. Mirrors /items' Row-A toggle + Row-B
 * 5-action layout so children inherit the full action vocabulary.
 *
 * Callback prefixes used here:
 *   item:toggle:<childId>       (reused — children are still items)
 *   item:edit:<childId>
 *   item:deadline:<childId>
 *   item:reminder:<childId>
 *   item:attach:<childId>
 *   item:delete:<childId>
 *   item:children_page:<parentId>:<offset>
 *   item:add_child:<parentId>   (force-reply for a new sub-item)
 *   item:children_back          (back to /items page 0)
 */
import { InlineKeyboard } from "grammy";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemAttachments, itemReminders, items } from "@/lib/db/schema";

const PAGE_SIZE = 5;

export type SubItemsView = {
  text: string;
  keyboard: InlineKeyboard;
  /** null when the parent itself was archived/missing. */
  found: boolean;
};

/**
 * Build the body + keyboard for a parent's sub-item drill-in.
 * Returns `found=false` when the parent doesn't exist, was archived,
 * or doesn't belong to this chat — callers should surface a friendly
 * "bu liste artık yok" answer.
 */
export async function buildSubItemsView(
  parentId: string,
  chatId: number,
  locale: "tr" | "en",
  offset: number,
): Promise<SubItemsView> {
  const [parent] = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.id, parentId),
        eq(items.chatId, chatId),
        isNull(items.archivedAt),
      ),
    )
    .limit(1);

  if (!parent) {
    return {
      text:
        locale === "tr"
          ? "📂 Bu liste artık yok."
          : "📂 This list is gone.",
      keyboard: new InlineKeyboard().text(
        locale === "tr" ? "← Geri" : "← Back",
        "item:children_back",
      ),
      found: false,
    };
  }

  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.parentItemId, parentId),
        isNull(items.archivedAt),
      ),
    )
    .orderBy(asc(items.position), asc(items.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasNext = rows.length > PAGE_SIZE;
  const visible = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  const totalRows = await db
    .select({ id: items.id, isDone: items.isDone })
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.parentItemId, parentId),
        isNull(items.archivedAt),
      ),
    );
  const total = totalRows.length;
  const open = totalRows.filter((r) => !r.isDone).length;

  const visibleIds = visible.map((r) => r.id);
  const attachmentCounts = new Map<string, number>();
  const reminderCounts = new Map<string, number>();
  if (visibleIds.length > 0) {
    const aCounts = await db
      .select({
        itemId: itemAttachments.itemId,
        count: sql<number>`count(*)::int`,
      })
      .from(itemAttachments)
      .where(inArray(itemAttachments.itemId, visibleIds))
      .groupBy(itemAttachments.itemId);
    for (const r of aCounts) attachmentCounts.set(r.itemId, r.count);

    const rCounts = await db
      .select({
        itemId: itemReminders.itemId,
        count: sql<number>`count(*)::int`,
      })
      .from(itemReminders)
      .where(
        and(
          inArray(itemReminders.itemId, visibleIds),
          eq(itemReminders.sent, false),
        ),
      )
      .groupBy(itemReminders.itemId);
    for (const r of rCounts) reminderCounts.set(r.itemId, r.count);
  }

  const parentText =
    parent.text.length > 60 ? `${parent.text.slice(0, 60)}…` : parent.text;
  const header =
    locale === "tr"
      ? `📂 ${parentText}\nAlt-itemlar (${open}/${total})`
      : `📂 ${parentText}\nSub-items (${open}/${total})`;

  const keyboard = new InlineKeyboard();

  if (visible.length === 0) {
    const empty =
      locale === "tr"
        ? "Henüz alt-item yok. Aşağıdan ekle."
        : "No sub-items yet. Add one below.";
    keyboard
      .text(
        locale === "tr" ? "+ Alt-item ekle" : "+ Add sub-item",
        `item:add_child:${parentId}`,
      )
      .row()
      .text(locale === "tr" ? "← Geri" : "← Back", "item:children_back");
    return { text: `${header}\n\n${empty}`, keyboard, found: true };
  }

  const lines: string[] = [header, ""];
  const nowMs = Date.now();
  for (let i = 0; i < visible.length; i++) {
    const it = visible[i]!;
    const num = offset + i + 1;
    const checkbox = it.isDone ? "✅" : "☐";
    const priorityIcon =
      it.priority === "high" ? "🔥 " : it.priority === "low" ? "💤 " : "";
    const statusIcon =
      it.status === "in_progress" && !it.isDone
        ? "📌 "
        : it.status === "blocked"
          ? "⏸️ "
          : "";
    const tags = (it.tags ?? []).slice(0, 3).map((t) => `#${t}`).join(" ");
    const tagSuffix = tags ? ` ${tags}` : "";
    let deadlineSuffix = "";
    if (it.deadlineAt) {
      const due = it.deadlineAt.getTime();
      const diffMs = due - nowMs;
      const oneDay = 24 * 60 * 60 * 1000;
      if (diffMs < 0) deadlineSuffix = " ⚠️";
      else if (diffMs < oneDay) deadlineSuffix = " ⏳";
      else deadlineSuffix = " 📅";
    }
    const text =
      it.text.length > 50 ? `${it.text.slice(0, 50)}…` : it.text;
    const attachCount = attachmentCounts.get(it.id) ?? 0;
    const attachSuffix = attachCount > 0 ? ` 📎${attachCount}` : "";
    const reminderCount = reminderCounts.get(it.id) ?? 0;
    const reminderSuffix = reminderCount > 0 ? " 🔔" : "";
    lines.push(
      `${num}. ${checkbox} ${priorityIcon}${statusIcon}${text}${deadlineSuffix}${reminderSuffix}${attachSuffix}${tagSuffix}`,
    );
    const labelText =
      it.text.length > 26 ? `${it.text.slice(0, 26)}…` : it.text;
    keyboard
      .text(`${num}. ${checkbox} ${labelText}`, `item:toggle:${it.id}`)
      .row();
    const attachLabel = attachCount > 0 ? `📎${attachCount}` : "📎";
    keyboard
      .text("✏️", `item:edit:${it.id}`)
      .text("📅", `item:deadline:${it.id}`)
      .text("⏰", `item:reminder:${it.id}`)
      .text(attachLabel, `item:attach:${it.id}`)
      .text("🗑️", `item:delete:${it.id}`)
      .row();
  }

  if (offset > 0) {
    keyboard.text(
      locale === "tr" ? "← Önceki" : "← Prev",
      `item:children_page:${parentId}:${Math.max(0, offset - PAGE_SIZE)}`,
    );
  }
  keyboard.text(
    locale === "tr" ? "+ Alt-item ekle" : "+ Add sub-item",
    `item:add_child:${parentId}`,
  );
  if (hasNext) {
    keyboard.text(
      locale === "tr" ? "Sonraki →" : "Next →",
      `item:children_page:${parentId}:${offset + PAGE_SIZE}`,
    );
  }
  keyboard.row();
  keyboard.text(
    locale === "tr" ? "← Geri" : "← Back",
    "item:children_back",
  );

  return { text: lines.join("\n"), keyboard, found: true };
}
