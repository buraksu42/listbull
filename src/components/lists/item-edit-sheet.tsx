"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import type { LucideIcon } from "lucide-react";

import {
  PRIORITY_META,
  STATUS_META,
} from "@/components/lists/item-attributes-meta";
import type { MemberRow } from "@/components/lists/member-list";
import { RemindersSection } from "@/components/lists/reminders-section";
import type {
  ItemPriority,
  ItemStatus,
} from "@/components/lists/item-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTelegramMainButton } from "@/hooks/use-telegram-main-button";
import {
  attachmentBytesUrl,
  useForwardAttachment,
  useAttachments,
  useDeleteAttachment,
} from "@/hooks/use-attachments";
import type { AttachmentKind, AttachmentSnapshot, Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  FileText as FileIcon,
  Mic,
  Paperclip,
  Send,
  Trash2,
  Video,
} from "lucide-react";

/**
 * Local form schema. Backend's authoritative validator (zod, server-side)
 * is the safety net; this is shape-aligned for client-side react-hook-form.
 */
const itemEditFormSchema = z.object({
  text: z.string().trim().min(1, "Required").max(2000, "≤2000 chars"),
  /** Phase 14a: optional long-form body, max 5000 chars. */
  description: z.string().max(5000, "≤5000 chars").optional(),
  // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm" without timezone.
  // We coerce to ISO at submit time; empty string ↔ null.
  deadlineAtLocal: z.string().optional(),
  status: z.enum(["open", "in_progress", "blocked", "done"]),
  priority: z.enum(["low", "normal", "high"]),
  /** Comma-separated freeform tags; trimmed/dedup'd before submit. */
  tagsRaw: z.string().optional(),
  /**
   * Task-recurrence preset selector. "none" = clear; "custom" =
   * read from `taskRecurrenceCustom`. Other values map to RRULE
   * shortcuts (daily / weekday / weekly-mon / monthly-1).
   */
  taskRecurrenceMode: z.enum([
    "none",
    "daily",
    "weekday",
    "weekly_mon",
    "weekly_tue",
    "weekly_wed",
    "weekly_thu",
    "weekly_fri",
    "weekly_sat",
    "weekly_sun",
    "monthly_1",
    "custom",
  ]),
  taskRecurrenceCustom: z.string().optional(),
  /** "" = unassigned; otherwise a user UUID. */
  assigneeId: z.string().optional(),
});

type ItemEditFormValues = z.infer<typeof itemEditFormSchema>;

export type ItemEditPatch = {
  text?: string;
  description?: string | null;
  deadlineAt?: string | null;
  status?: ItemStatus;
  priority?: ItemPriority;
  tags?: string[];
  pinned?: boolean;
  taskRecurrenceRule?: string | null;
  assigneeId?: string | null;
};

const RECURRENCE_PRESETS: Record<
  Exclude<ItemEditFormValues["taskRecurrenceMode"], "none" | "custom">,
  string
> = {
  daily: "FREQ=DAILY",
  weekday: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly_mon: "FREQ=WEEKLY;BYDAY=MO",
  weekly_tue: "FREQ=WEEKLY;BYDAY=TU",
  weekly_wed: "FREQ=WEEKLY;BYDAY=WE",
  weekly_thu: "FREQ=WEEKLY;BYDAY=TH",
  weekly_fri: "FREQ=WEEKLY;BYDAY=FR",
  weekly_sat: "FREQ=WEEKLY;BYDAY=SA",
  weekly_sun: "FREQ=WEEKLY;BYDAY=SU",
  monthly_1: "FREQ=MONTHLY;BYMONTHDAY=1",
};

function ruleToMode(
  rule: string | null,
): {
  mode: ItemEditFormValues["taskRecurrenceMode"];
  custom: string;
} {
  if (!rule) return { mode: "none", custom: "" };
  for (const [k, v] of Object.entries(RECURRENCE_PRESETS)) {
    if (v === rule) {
      return {
        mode: k as ItemEditFormValues["taskRecurrenceMode"],
        custom: "",
      };
    }
  }
  return { mode: "custom", custom: rule };
}

function modeToRule(
  mode: ItemEditFormValues["taskRecurrenceMode"],
  custom: string,
): string | null {
  if (mode === "none") return null;
  if (mode === "custom") {
    const t = custom.trim();
    return t.length > 0 ? t : null;
  }
  return RECURRENCE_PRESETS[mode] ?? null;
}

export function ItemEditSheet({
  item,
  open,
  onOpenChange,
  onSave,
  members = [],
}: {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: ItemEditPatch) => Promise<void>;
  /** List members (Phase 3 query) — feeds the assignee picker. */
  members?: MemberRow[];
}) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ItemEditFormValues>({
    resolver: zodResolver(itemEditFormSchema),
    defaultValues: {
      text: item?.text ?? "",
      description: item?.description ?? "",
      deadlineAtLocal: dateToLocalInput(item?.deadlineAt ?? null),
      status: (item?.status as ItemStatus) ?? "open",
      priority: (item?.priority as ItemPriority) ?? "normal",
      tagsRaw: (item?.tags ?? []).join(", "),
      ...ruleToMode(item?.taskRecurrenceRule ?? null),
      // Spread above gives `mode` + `custom` keys; rename to form fields.
      taskRecurrenceMode: ruleToMode(item?.taskRecurrenceRule ?? null).mode,
      taskRecurrenceCustom: ruleToMode(item?.taskRecurrenceRule ?? null).custom,
      assigneeId: item?.assigneeId ?? "",
    },
  });

  // Reset the form whenever a different item is opened.
  React.useEffect(() => {
    if (!item) return;
    const rec = ruleToMode(item.taskRecurrenceRule ?? null);
    reset({
      text: item.text,
      description: item.description ?? "",
      deadlineAtLocal: dateToLocalInput(item.deadlineAt),
      status: (item.status as ItemStatus) ?? "open",
      priority: (item.priority as ItemPriority) ?? "normal",
      tagsRaw: (item.tags ?? []).join(", "),
      taskRecurrenceMode: rec.mode,
      taskRecurrenceCustom: rec.custom,
      assigneeId: item.assigneeId ?? "",
    });
  }, [item, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (!item) return;
    const patch = diffPatch(item, values);
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    await onSave(patch);
    onOpenChange(false);
  });

  const submitFromMainButton = React.useCallback(() => {
    void onSubmit();
  }, [onSubmit]);

  // Telegram MainButton becomes the Save affordance when the sheet is
  // open and the form is dirty. Keeps Mini App native feel.
  useTelegramMainButton({
    visible: open && isDirty,
    text: "Save",
    onClick: submitFromMainButton,
    disabled: isSubmitting,
    loading: isSubmitting,
  });

  if (!item) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent ariaLabel="Edit item">
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col flex-1 min-h-0"
        >
          <SheetHeader>
            <SheetTitle>Edit item</SheetTitle>
            <SheetDescription>
              Update text, status, priority, due date, and tags.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-text">Başlık</Label>
              <Input
                id="item-edit-text"
                autoFocus
                {...register("text")}
                aria-invalid={Boolean(errors.text)}
                aria-describedby={errors.text ? "item-edit-text-error" : undefined}
              />
              {errors.text && (
                <p
                  id="item-edit-text-error"
                  className="text-sm text-[var(--lb-destructive)]"
                >
                  {errors.text.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-description">Açıklama (opsiyonel)</Label>
              <Textarea
                id="item-edit-description"
                rows={4}
                placeholder="Daha uzun bağlam, notlar veya bağlantılar (≤5000 karakter, düz metin)"
                {...register("description")}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={
                  errors.description ? "item-edit-description-error" : undefined
                }
              />
              {errors.description && (
                <p
                  id="item-edit-description-error"
                  className="text-sm text-[var(--lb-destructive)]"
                >
                  {errors.description.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Durum</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <PickerRow
                    options={STATUS_META.map((m) => ({
                      value: m.value,
                      label: m.label,
                      Icon: m.Icon,
                      color: m.color,
                    }))}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Öncelik</Label>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <PickerRow
                    options={PRIORITY_META.map((m) => ({
                      value: m.value,
                      label: m.label,
                      Icon: m.Icon,
                      color: m.color,
                    }))}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-deadline">Son tarih (opsiyonel)</Label>
              <Input
                id="item-edit-deadline"
                type="datetime-local"
                {...register("deadlineAtLocal")}
              />
              <p className="text-xs text-[var(--lb-muted-fg)]">
                Boş bırakırsan son tarih ve süreye-bağlı hatırlatmalar
                temizlenir.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-tags">Etiketler</Label>
              <Input
                id="item-edit-tags"
                placeholder="iş, acil, fatura"
                {...register("tagsRaw")}
              />
              <p className="text-xs text-[var(--lb-muted-fg)]">
                Virgülle ayır. Workspace içinde en fazla 20 farklı etiket.
              </p>
            </div>

            {members.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-edit-assignee">Atanan kişi</Label>
                <Controller
                  control={control}
                  name="assigneeId"
                  render={({ field }) => (
                    <select
                      id="item-edit-assignee"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value)}
                      className="rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] bg-[var(--lb-bg)] p-2 text-sm"
                    >
                      <option value="">— Atanmamış —</option>
                      {members.map((m) => {
                        const u = m.user;
                        const label =
                          u.telegramFirstName ??
                          u.telegramUsername ??
                          m.userId.slice(0, 8);
                        return (
                          <option key={m.userId} value={m.userId}>
                            {label}
                            {u.telegramUsername ? ` (@${u.telegramUsername})` : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                />
                <p className="text-xs text-[var(--lb-muted-fg)]">
                  Liste üyeleri arasından seç. Atanan kişi bot DM&apos;leriyle
                  hatırlatılır.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-recurrence">Tekrar (otomatik yenile)</Label>
              <Controller
                control={control}
                name="taskRecurrenceMode"
                render={({ field }) => (
                  <select
                    id="item-edit-recurrence"
                    value={field.value}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value as ItemEditFormValues["taskRecurrenceMode"],
                      )
                    }
                    className="rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] bg-[var(--lb-bg)] p-2 text-sm"
                  >
                    <option value="none">Tekrarlama yok</option>
                    <option value="daily">Her gün</option>
                    <option value="weekday">Hafta içi her gün</option>
                    <option value="weekly_mon">Her pazartesi</option>
                    <option value="weekly_tue">Her salı</option>
                    <option value="weekly_wed">Her çarşamba</option>
                    <option value="weekly_thu">Her perşembe</option>
                    <option value="weekly_fri">Her cuma</option>
                    <option value="weekly_sat">Her cumartesi</option>
                    <option value="weekly_sun">Her pazar</option>
                    <option value="monthly_1">Her ayın 1&apos;i</option>
                    <option value="custom">Özel (RRULE)</option>
                  </select>
                )}
              />
              {/* Custom RRULE input visible only when mode === "custom" */}
              <Controller
                control={control}
                name="taskRecurrenceMode"
                render={({ field: modeField }) =>
                  modeField.value === "custom" ? (
                    <Input
                      placeholder="FREQ=WEEKLY;BYDAY=TH"
                      {...register("taskRecurrenceCustom")}
                    />
                  ) : (
                    <></>
                  )
                }
              />
              <p className="text-xs text-[var(--lb-muted-fg)]">
                Tamamlandığında otomatik yenilenir; bir sonraki son tarihe atılır.
              </p>
            </div>

            <RemindersSection itemId={item.id} />

            <AttachmentsSection itemId={item.id} />
          </SheetBody>

          <SheetFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function PickerRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{
    value: T;
    label: string;
    Icon: LucideIcon;
    color?: string;
  }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: "999px",
              fontSize: "var(--lb-fs-sm)",
              cursor: "pointer",
              background: active ? o.color ?? "var(--lb-accent)" : "var(--lb-card)",
              color: active ? "white" : o.color ?? "var(--lb-fg)",
              border: `1px solid ${active ? o.color ?? "var(--lb-accent)" : "var(--lb-border)"}`,
            }}
          >
            <o.Icon size={14} aria-hidden="true" />
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function dateToLocalInput(iso: Date | string | null): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    ),
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function diffPatch(item: Item, values: ItemEditFormValues): ItemEditPatch {
  const patch: ItemEditPatch = {};
  if (values.text.trim() !== item.text) {
    patch.text = values.text.trim();
  }
  // Description: empty/whitespace string ↔ null. Compare normalized
  // values so the form doesn't dirty-flag a no-op edit.
  const nextDescriptionRaw = (values.description ?? "").trim();
  const nextDescription = nextDescriptionRaw.length > 0 ? nextDescriptionRaw : null;
  const currentDescription = item.description ?? null;
  if (nextDescription !== currentDescription) {
    patch.description = nextDescription;
  }
  const nextDue = localInputToIso(values.deadlineAtLocal ?? "");
  const currentDue = item.deadlineAt ? new Date(item.deadlineAt).toISOString() : null;
  if (nextDue !== currentDue) {
    patch.deadlineAt = nextDue;
  }
  const currentStatus = (item.status as ItemStatus) ?? "open";
  if (values.status !== currentStatus) {
    patch.status = values.status;
  }
  const currentPriority = (item.priority as ItemPriority) ?? "normal";
  if (values.priority !== currentPriority) {
    patch.priority = values.priority;
  }
  const nextTags = parseTags(values.tagsRaw ?? "");
  const currentTags = (item.tags ?? []).map((t) => t.toLowerCase());
  if (!arraysEqual(nextTags, currentTags)) {
    patch.tags = nextTags;
  }
  const nextRule = modeToRule(
    values.taskRecurrenceMode,
    values.taskRecurrenceCustom ?? "",
  );
  const currentRule = item.taskRecurrenceRule ?? null;
  if (nextRule !== currentRule) {
    patch.taskRecurrenceRule = nextRule;
  }
  const nextAssignee =
    values.assigneeId && values.assigneeId.length > 0
      ? values.assigneeId
      : null;
  const currentAssignee = item.assigneeId ?? null;
  if (nextAssignee !== currentAssignee) {
    patch.assigneeId = nextAssignee;
  }
  return patch;
}

/**
 * Phase 14b: per-item attachments section. Renders a thumbnail grid;
 * photos use the proxy URL as <img src>, other kinds get a typed icon
 * + filename + size. Lightbox: clicking a photo opens it full-screen
 * over the sheet (Escape / backdrop closes). Delete is per-row.
 *
 * Read-only render when the user lacks write access — `useDeleteAttachment`
 * returns 403 from the API, which surfaces as a toast.
 */
function AttachmentsSection({ itemId }: { itemId: string }) {
  const { data: attachments, isLoading, isError } = useAttachments(itemId);
  const deleteMutation = useDeleteAttachment(itemId);
  const forwardMutation = useForwardAttachment(itemId);
  const [lightboxId, setLightboxId] = React.useState<string | null>(null);
  const [forwardStatus, setForwardStatus] = React.useState<{
    id: string;
    state: "pending" | "ok" | "error";
    message?: string;
  } | null>(null);

  const onForward = (attachmentId: string) => {
    setForwardStatus({ id: attachmentId, state: "pending" });
    forwardMutation.mutate(attachmentId, {
      onSuccess: () => {
        setForwardStatus({ id: attachmentId, state: "ok" });
        window.setTimeout(
          () =>
            setForwardStatus((cur) =>
              cur?.id === attachmentId ? null : cur,
            ),
          3000,
        );
      },
      onError: (err) => {
        const msg =
          err instanceof Error ? err.message : "Telegram'a yollanamadı";
        setForwardStatus({ id: attachmentId, state: "error", message: msg });
      },
    });
  };

  const lightboxAttachment =
    lightboxId !== null
      ? (attachments ?? []).find((a) => a.id === lightboxId) ?? null
      : null;

  return (
    <div className="flex flex-col gap-2">
      <Label>
        <span className="inline-flex items-center gap-1.5">
          <Paperclip size={14} aria-hidden="true" />
          Ekler
        </span>
      </Label>
      {isLoading && (
        <p className="text-xs text-[var(--lb-muted-fg)]">Yükleniyor…</p>
      )}
      {isError && (
        <p className="text-xs text-[var(--lb-destructive)]">
          Ekler getirilemedi.
        </p>
      )}
      {!isLoading && (attachments?.length ?? 0) === 0 && (
        <p className="text-xs text-[var(--lb-muted-fg)]">
          Henüz ek yok. Bot&apos;a dosya gönderip &ldquo;bu maddeye ekle&rdquo;
          dersen iliştirir.
        </p>
      )}
      {(attachments?.length ?? 0) > 0 && (
        <ul
          className="grid grid-cols-3 gap-2"
          aria-label={`${attachments?.length ?? 0} ek`}
        >
          {(attachments ?? []).map((att) => (
            <AttachmentTile
              key={att.id}
              itemId={itemId}
              attachment={att}
              onOpen={() => setLightboxId(att.id)}
              onDelete={() =>
                deleteMutation.mutate(att.id, {
                  onError: (err) => {
                    console.warn("[attachments] delete failed", err);
                  },
                })
              }
              onForward={() => onForward(att.id)}
              forwardState={
                forwardStatus?.id === att.id ? forwardStatus.state : null
              }
              deleting={
                deleteMutation.isPending && deleteMutation.variables === att.id
              }
            />
          ))}
        </ul>
      )}
      {forwardStatus?.state === "error" && (
        <p className="text-xs text-[var(--lb-destructive)]">
          {forwardStatus.message ?? "Telegram'a yollanamadı."}
        </p>
      )}
      {lightboxAttachment && (
        <Lightbox
          itemId={itemId}
          attachment={lightboxAttachment}
          onClose={() => setLightboxId(null)}
          onForward={() => onForward(lightboxAttachment.id)}
          forwardState={
            forwardStatus?.id === lightboxAttachment.id
              ? forwardStatus.state
              : null
          }
        />
      )}
    </div>
  );
}

function AttachmentTile({
  itemId,
  attachment,
  onOpen,
  onDelete,
  onForward,
  forwardState,
  deleting,
}: {
  itemId: string;
  attachment: AttachmentSnapshot;
  onOpen: () => void;
  onDelete: () => void;
  onForward: () => void;
  forwardState: "pending" | "ok" | "error" | null;
  deleting: boolean;
}) {
  const isPhoto = attachment.kind === "photo";
  const url = attachmentBytesUrl(itemId, attachment.id);
  const [imageBroken, setImageBroken] = React.useState(false);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex h-24 w-full items-center justify-center overflow-hidden rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-card)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
        )}
        aria-label={
          attachment.originalFilename ?? `${attachment.kind} ${attachment.id}`
        }
      >
        {isPhoto && !imageBroken ? (
          // eslint-disable-next-line @next/next/no-img-element -- Telegram CDN through our proxy; <Image> would require domain config.
          <img
            src={url}
            alt={attachment.originalFilename ?? "Fotoğraf"}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImageBroken(true)}
          />
        ) : (
          <KindIcon kind={attachment.kind} />
        )}
      </button>
      <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
        <span
          className="truncate text-[var(--lb-muted-fg)]"
          title={attachment.originalFilename ?? attachment.kind}
        >
          {attachment.originalFilename ?? attachment.kind}
        </span>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={onForward}
            disabled={forwardState === "pending"}
            className="text-[var(--lb-muted-fg)] hover:text-[var(--lb-accent)] disabled:opacity-40"
            aria-label="Telegram'a yolla"
            title={
              forwardState === "ok"
                ? "Telegram'a yollandı"
                : "Telegram'a yolla"
            }
          >
            {forwardState === "ok" ? (
              <span className="text-[10px]" aria-hidden>
                ✓
              </span>
            ) : (
              <Send size={12} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="text-[var(--lb-destructive)] hover:opacity-80 disabled:opacity-40"
            aria-label="Eki sil"
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </span>
      </div>
      {!attachment.hasBackup && (
        <span
          className="absolute right-1 top-1 rounded-full bg-[var(--lb-bg)]/80 px-1 text-[9px] text-[var(--lb-muted-fg)]"
          title="Henüz yedeklenmedi"
        >
          ⏳
        </span>
      )}
    </li>
  );
}

function KindIcon({ kind }: { kind: AttachmentKind }) {
  const iconColor = "var(--lb-muted-fg)";
  const size = 28;
  switch (kind) {
    case "video":
    case "video_note":
      return <Video size={size} color={iconColor} aria-hidden="true" />;
    case "audio":
    case "voice":
      return <Mic size={size} color={iconColor} aria-hidden="true" />;
    case "document":
    case "photo":
    default:
      return <FileIcon size={size} color={iconColor} aria-hidden="true" />;
  }
}

function Lightbox({
  itemId,
  attachment,
  onClose,
  onForward,
  forwardState,
}: {
  itemId: string;
  attachment: AttachmentSnapshot;
  onClose: () => void;
  onForward: () => void;
  forwardState: "pending" | "ok" | "error" | null;
}) {
  const [imageBroken, setImageBroken] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = attachmentBytesUrl(itemId, attachment.id);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ek önizleme"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white"
        aria-label="Kapat"
      >
        ✕
      </button>
      <div
        className="absolute bottom-4 left-1/2 z-[61] flex flex-col items-center gap-1 -translate-x-1/2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onForward}
          disabled={forwardState === "pending"}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lb-accent)] px-4 py-2 text-sm font-medium text-[var(--lb-accent-fg,white)] disabled:opacity-60"
        >
          <Send size={14} aria-hidden />
          {forwardState === "pending"
            ? "Yollanıyor…"
            : forwardState === "ok"
              ? "Telegram'a yollandı ✓"
              : "Telegram'a yolla"}
        </button>
        {forwardState === "ok" && (
          <span className="text-[11px] text-white/70">
            Bot sohbetinden indir / kaydet
          </span>
        )}
      </div>
      {attachment.kind === "photo" && !imageBroken ? (
        // eslint-disable-next-line @next/next/no-img-element -- proxied bytes
        <img
          src={url}
          alt={attachment.originalFilename ?? "Ek"}
          className="max-h-[80vh] max-w-[90vw] object-contain"
          onClick={(e) => e.stopPropagation()}
          onError={() => setImageBroken(true)}
        />
      ) : (
        <div
          className="flex flex-col items-center gap-3 rounded-md bg-[var(--lb-card)] px-6 py-5 text-[var(--lb-fg)]"
          onClick={(e) => e.stopPropagation()}
        >
          <KindIcon kind={attachment.kind} />
          <span className="text-sm">
            {attachment.originalFilename ?? attachment.kind}
          </span>
          {imageBroken && (
            <span className="text-xs text-[var(--lb-muted-fg)]">
              Önizleme yüklenemedi — Telegram&apos;da aç ya da indir.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
