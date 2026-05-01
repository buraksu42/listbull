"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * TanStack QueryClient configured for Mini App polling — 5s refetch interval
 * across the board, 1s staleTime so explicit refetches still hit the network.
 *
 * The interval is dynamic: when the tab is hidden (Page Visibility API),
 * `refetchInterval` returns `false` to pause polling. This avoids burning
 * the user's data + Telegram WebApp keep-alive when the app is backgrounded.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    return new QueryClient({
      defaultOptions: {
        queries: {
          // refetchInterval can be a function — receives the query, returns
          // the next interval in ms or false to skip. We read document.hidden
          // at evaluation time, so pause works even though we never restart
          // the timer manually.
          refetchInterval: () => {
            if (typeof document === "undefined") return 5000;
            return document.hidden ? false : 5000;
          },
          refetchIntervalInBackground: false,
          refetchOnWindowFocus: false,
          staleTime: 1000,
          retry: 1,
        },
      },
    });
  });

  // When the tab becomes visible again, kick a re-evaluation by invalidating
  // queries — this nudges TanStack to immediately reconsider its interval.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) {
        client.invalidateQueries();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
