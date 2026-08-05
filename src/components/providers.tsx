"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmProvider } from "@/components/shared/confirm-provider";
import { SettingsProvider } from "@/components/settings-provider";
import type { AppSettings } from "@/lib/settings-registry";

export function Providers({
  settings,
  children,
}: {
  settings: AppSettings;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider settings={settings}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
