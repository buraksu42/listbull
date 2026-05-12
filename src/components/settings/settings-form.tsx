"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useTelegramMainButton } from "@/hooks/use-telegram-main-button";
import { ApiError, apiPatch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Curated locale + timezone lists. Settings validator is server-owned;
 * this list mirrors the documented preset set per Phase-2 Architect
 * contract.
 *
 * LLM model moved to workspace-level (workspaces.llm_model) in 0020 —
 * owner-only picker now lives on /workspace/settings.
 */

const TIMEZONE_OPTIONS: string[] = [
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
];

const LOCALE_OPTIONS: Array<{ value: "tr" | "en"; label: string }> = [
  { value: "tr", label: "Türkçe" },
  { value: "en", label: "English" },
];

/**
 * Server-supplied initial settings. Plaintext API key is never returned —
 * `byokKeyPreview` is the last 4 characters (or null if unset).
 */
type DateFormat = "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
type TimeFormat = "24h" | "12h";

export type SettingsInitial = {
  timezone: string;
  locale: "tr" | "en";
  notificationsEnabled: boolean;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
};

type SettingsFormValues = {
  timezone: string;
  locale: "tr" | "en";
  notificationsEnabled: boolean;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
};

type PatchPayload = Partial<{
  timezone: string;
  locale: "tr" | "en";
  notificationsEnabled: boolean;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
}>;

const DATE_FORMAT_OPTIONS: Array<{ value: DateFormat; label: string }> = [
  { value: "DD.MM.YYYY", label: "GG.AA.YYYY (Avrupa)" },
  { value: "MM/DD/YYYY", label: "AA/GG/YYYY (ABD)" },
  { value: "YYYY-MM-DD", label: "YYYY-AA-GG (ISO)" },
];

const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string }> = [
  { value: "24h", label: "24 saat (14:30)" },
  { value: "12h", label: "12 saat (2:30 PM)" },
];

function previewDate(fmt: DateFormat): string {
  const now = new Date();
  const yy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  switch (fmt) {
    case "DD.MM.YYYY":
      return `${dd}.${mm}.${yy}`;
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yy}`;
    case "YYYY-MM-DD":
      return `${yy}-${mm}-${dd}`;
  }
}

function previewTime(fmt: TimeFormat): string {
  const now = new Date();
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: fmt === "12h",
  }).format(now);
}

export function SettingsForm({ initial }: { initial: SettingsInitial }) {
  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { isDirty, isSubmitting },
  } = useForm<SettingsFormValues>({
    defaultValues: {
      timezone: initial.timezone,
      locale: initial.locale,
      notificationsEnabled: initial.notificationsEnabled,
      dateFormat: initial.dateFormat,
      timeFormat: initial.timeFormat,
    },
  });

  // useWatch's subscription model is React-Compiler-compatible (unlike
  // form.watch which returns a fresh closure each render).
  const notificationsEnabled = useWatch({ control, name: "notificationsEnabled" });
  const watchedDateFormat = useWatch({ control, name: "dateFormat" });
  const watchedTimeFormat = useWatch({ control, name: "timeFormat" });

  const mutation = useMutation<
    SettingsInitial,
    ApiError,
    PatchPayload
  >({
    mutationFn: async (patch) => {
      return apiPatch<SettingsInitial>("/api/settings", patch);
    },
    onSuccess: (data) => {
      toast.success("Settings saved.");
      // Reset form so isDirty tracks subsequent edits, and the API key
      // field collapses back to the configured view.
      const localeChanged = data.locale !== initial.locale;
      reset({
        timezone: data.timezone,
        locale: data.locale,
        notificationsEnabled: data.notificationsEnabled,
        dateFormat: data.dateFormat,
        timeFormat: data.timeFormat,
      });
      // E1: when the user switches language, reload the route so the
      // next-intl request handler picks up the new `users.locale` and
      // re-renders all server-side strings. The cookie hint helps any
      // pre-session paths (setup wizard) align until the DB read lands.
      if (localeChanged && typeof document !== "undefined") {
        document.cookie = `NEXT_LOCALE=${data.locale}; path=/; max-age=31536000; samesite=lax`;
        if (typeof window !== "undefined") {
          window.setTimeout(() => window.location.reload(), 200);
        }
      }
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't save settings — try again.");
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const patch: PatchPayload = {};
    if (values.timezone !== initial.timezone) patch.timezone = values.timezone;
    if (values.locale !== initial.locale) patch.locale = values.locale;
    if (values.notificationsEnabled !== initial.notificationsEnabled) {
      patch.notificationsEnabled = values.notificationsEnabled;
    }
    if (values.dateFormat !== initial.dateFormat) {
      patch.dateFormat = values.dateFormat;
    }
    if (values.timeFormat !== initial.timeFormat) {
      patch.timeFormat = values.timeFormat;
    }
    if (Object.keys(patch).length === 0) {
      toast.message("Nothing to save.");
      return;
    }
    await mutation.mutateAsync(patch);
  });

  const submitFromMainButton = React.useCallback(() => {
    void onSubmit();
  }, [onSubmit]);

  // MainButton appears only when there are unsaved changes; mirrors a
  // disabled in-page Save button. Telegram users get the native bottom
  // affordance instead of scrolling down to a footer.
  useTelegramMainButton({
    visible: isDirty,
    text: "Save",
    onClick: submitFromMainButton,
    disabled: isSubmitting,
    loading: isSubmitting,
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 p-4" noValidate>
      <Section title="Locale & timezone">
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-locale">Language</Label>
          <select
            id="settings-locale"
            {...register("locale")}
            className={cn(
              "h-11 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 text-base text-[var(--lb-fg)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
            )}
          >
            {LOCALE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-timezone">Timezone</Label>
          <input
            id="settings-timezone"
            list="settings-timezone-options"
            {...register("timezone")}
            className={cn(
              "h-11 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 text-base text-[var(--lb-fg)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
            )}
            placeholder="e.g. Europe/Istanbul"
          />
          <datalist id="settings-timezone-options">
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
          <p className="text-xs text-[var(--lb-muted-fg)]">
            IANA name (e.g. Europe/Istanbul, America/New_York).
          </p>
        </div>
      </Section>

      <Section title="Notifications">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="settings-notifications">Reminder DMs</Label>
            <p className="text-xs text-[var(--lb-muted-fg)]">
              Receive a Telegram DM when an item is due.
            </p>
          </div>
          <Switch
            id="settings-notifications"
            checked={notificationsEnabled}
            onCheckedChange={(next) =>
              setValue("notificationsEnabled", next, { shouldDirty: true })
            }
            ariaLabel="Toggle notifications"
          />
        </div>
      </Section>

      <Section
        title="Tarih & Saat Formatı"
        subtitle="Mini App'te ve hatırlatma DM'lerinde görüntü için kullanılır."
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-date-format">Tarih formatı</Label>
          <select
            id="settings-date-format"
            {...register("dateFormat")}
            className={cn(
              "h-11 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 text-base text-[var(--lb-fg)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
            )}
          >
            {DATE_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--lb-muted-fg)]">
            Önizleme: {previewDate(watchedDateFormat ?? initial.dateFormat)}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-time-format">Saat formatı</Label>
          <select
            id="settings-time-format"
            {...register("timeFormat")}
            className={cn(
              "h-11 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 text-base text-[var(--lb-fg)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
            )}
          >
            {TIME_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--lb-muted-fg)]">
            Önizleme: {previewTime(watchedTimeFormat ?? initial.timeFormat)}
          </p>
        </div>
      </Section>

      {/* Inline save button is the fallback for non-Telegram surfaces (local
          dev in Chrome). On Mini App, MainButton replaces it visually. */}
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[var(--lb-fg)]">{title}</h2>
        {subtitle && (
          <p className="text-xs text-[var(--lb-muted-fg)]">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
