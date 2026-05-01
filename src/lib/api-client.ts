/**
 * Tiny client-side fetch wrapper for the Mini App's API surface. The shape
 * mirrors the Backend-agent's error envelope:
 *
 *   { ok: true, data } | { ok: false, error: { code, message } }
 *
 * Using a thin wrapper keeps the optimistic-mutation hooks readable and
 * gives us one place to add auth headers, retry, or a base URL prefix
 * later without touching every call-site.
 */
import type { ApiResult } from "@/lib/types";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(
      "invalid_response",
      "Server returned a non-JSON response.",
      res.status,
    );
  }

  const envelope = json as ApiResult<T>;
  if (envelope && typeof envelope === "object" && "ok" in envelope) {
    if (envelope.ok) return envelope.data;
    throw new ApiError(envelope.error.code, envelope.error.message, res.status);
  }

  if (!res.ok) {
    throw new ApiError("http_error", `HTTP ${res.status}`, res.status);
  }

  // Some routes may return raw JSON without an envelope (e.g. /api/health).
  return json as T;
}

export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  return parseResponse<T>(res);
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: "DELETE" });
}
