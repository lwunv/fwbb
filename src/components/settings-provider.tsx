"use client";

import { createContext, useContext } from "react";
import { defaultSettings, type AppSettings } from "@/lib/settings-registry";

/**
 * Resolved settings được server đọc từ DB (getSettings) và bơm xuống client
 * tree một lần ở root. Mọi component client cần ngưỡng cấu hình (getFundStatus,
 * isLowStock, maxPlayersOptions, …) đọc qua useSettings() thay vì import hằng
 * số hardcode. Default registry làm giá trị fallback: nếu một subtree nào đó
 * chưa nằm dưới provider thì vẫn ra đúng hành vi mặc định, không vỡ.
 */
const SettingsContext = createContext<AppSettings>(defaultSettings());

export function SettingsProvider({
  settings,
  children,
}: {
  settings: AppSettings;
  children: React.ReactNode;
}) {
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): AppSettings {
  return useContext(SettingsContext);
}
