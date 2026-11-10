import { adminListExchanges, adminListReports } from "@/actions/exchange-admin";
import {
  AdminExchangeClient,
  type AdminExchangeTab,
} from "./admin-exchange-client";

const TABS: readonly AdminExchangeTab[] = [
  "events",
  "reports",
  "comments",
  "reputation",
];

export default async function AdminExchangePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ tab }, events, reports] = await Promise.all([
    searchParams,
    adminListExchanges("upcoming"),
    adminListReports("open"),
  ]);
  const initialTab =
    TABS.find((v) => v === (Array.isArray(tab) ? tab[0] : tab)) ?? "events";
  return (
    <AdminExchangeClient
      initialEvents={"data" in events ? events.data : []}
      initialReports={"data" in reports ? reports.data : []}
      initialTab={initialTab}
    />
  );
}
