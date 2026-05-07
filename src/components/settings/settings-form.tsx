"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";

import { ApiKeyField } from "@/components/settings/api-key-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useTelegramMainButton } from "@/hooks/use-telegram-main-button";
import { ApiError, apiPatch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Curated locale + timezone + model lists. Settings validator is
 * server-owned; this list mirrors the documented preset set per Phase-2
 * Architect contract.
 */
const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 (default, fast)" },
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (smartest in family)" },
  { value: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7 (best)" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (cheapest)" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
];

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
export type SettingsInitial = {
  llmModel: string;
  timezone: string;
  locale: "tr" | "en";
  notificationsEnabled: boolean;
  hasApiKey: boolean;
  byokKeyPreview: string | null;
};

type SettingsFormValues = {
  llmModel: string;
  timezone: string;
  locale: "tr" | "en";
  notificationsEnabled: boolean;
  /** Empty = no change to stored key. */
  apiKey: string;
};

type PatchPayload = Partial<{
  llmModel: string;
  timezone: string;
  locale: "tr" | "en";
  notificationsEnabled: boolean;
  openrouterApiKey: string;
}>;

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
      llmModel: initial.llmModel,
      timezone: initial.timezone,
      locale: initial.locale,
      notificationsEnabled: initial.notificationsEnabled,
      apiKey: "",
    },
  });

  // useWatch's subscription model is React-Compiler-compatible (unlike
  // form.watch which returns a fresh closure each render).
  const apiKey = useWatch({ control, name: "apiKey" });
  const notificationsEnabled = useWatch({ control, name: "notificationsEnabled" });

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
        llmModel: data.llmModel,
        timezone: data.timezone,
        locale: data.locale,
        notificationsEnabled: data.notificationsEnabled,
        apiKey: "",
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
    if (values.llmModel !== initial.llmModel) patch.llmModel = values.llmModel;
    if (values.timezone !== initial.timezone) patch.timezone = values.timezone;
    if (values.locale !== initial.locale) patch.locale = values.locale;
    if (values.notificationsEnabled !== initial.notificationsEnabled) {
      patch.notificationsEnabled = values.notificationsEnabled;
    }
    if (values.apiKey.trim() !== "") {
      patch.openrouterApiKey = values.apiKey.trim();
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
      <Section title="OpenRouter API key" subtitle="BYOK — your key, your spend.">
        <ApiKeyField
          id="settings-api-key"
          label="API key"
          value={apiKey}
          onChange={(next) => setValue("apiKey", next, { shouldDirty: true })}
          hasStoredKey={initial.hasApiKey}
          storedKeyPreview={initial.byokKeyPreview}
        />
      </Section>

      <Section title="LLM model" subtitle="Used by the bot for AI responses.">
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-model">Model</Label>
          <select
            id="settings-model"
            {...register("llmModel")}
            className={cn(
              "h-11 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 text-base text-[var(--lb-fg)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
            )}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </Section>

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
