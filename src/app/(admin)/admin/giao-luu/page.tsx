import { adminListExchanges, adminListReports } from "@/actions/exchange-admin";
import { AdminExchangeClient } from "./admin-exchange-client";

export default async function AdminExchangePage() {
  const [events, reports] = await Promise.all([
    adminListExchanges("upcoming"),
    adminListReports("open"),
  ]);
  return (
    <AdminExchangeClient
      initialEvents={"data" in events ? events.data : []}
      initialReports={"data" in reports ? reports.data : []}
    />
  );
}
