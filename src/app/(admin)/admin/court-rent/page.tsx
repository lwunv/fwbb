import { db } from "@/db";
import { courts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCourtRentReport, getCourtRentYears } from "@/actions/court-rent";
import { CourtRentClient } from "./court-rent-client";

export default async function AdminCourtRentPage() {
  const currentYear = new Date().getFullYear();
  const [report, years, courtRows] = await Promise.all([
    getCourtRentReport(currentYear),
    getCourtRentYears(),
    db.query.courts.findMany({
      where: eq(courts.isActive, true),
      columns: { id: true, name: true },
    }),
  ]);

  return (
    <CourtRentClient
      initialYear={currentYear}
      initialReport={report}
      availableYears={years.length > 0 ? years : [currentYear]}
      courts={courtRows}
    />
  );
}
