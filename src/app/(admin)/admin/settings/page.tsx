import { getTranslations } from "next-intl/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { courts, members, shuttlecockBrands } from "@/db/schema";
import { getSettings } from "@/actions/settings";
import { SettingsClient } from "./settings-client";

export default async function AdminSettingsPage() {
  const t = await getTranslations("adminSettings");
  const [settings, allCourts, allBrands, unsetGenderRows] = await Promise.all([
    getSettings(),
    db.query.courts.findMany({
      where: eq(courts.isActive, true),
      orderBy: (c, { asc }) => [asc(c.name)],
    }),
    db.query.shuttlecockBrands.findMany({
      where: eq(shuttlecockBrands.isActive, true),
      orderBy: (b, { asc }) => [asc(b.name)],
    }),
    // Đếm thành viên còn hoạt động mà CHƯA khai giới tính. Chỉ lấy CON SỐ:
    // danh sách tên là dữ liệu cá nhân, và để hiện một cảnh báo thì không cần.
    db
      .select({ n: sql<number>`count(*)` })
      .from(members)
      .where(and(eq(members.isActive, true), isNull(members.gender))),
  ]);
  const unsetGenderCount = Number(unsetGenderRows[0]?.n ?? 0);

  const settingsCourts = allCourts.map((c) => ({
    id: c.id,
    name: c.name,
    pricePerSession: c.pricePerSession,
  }));
  const settingsBrands = allBrands.map((b) => ({
    id: b.id,
    name: b.name,
    pricePerTube: b.pricePerTube,
  }));

  return (
    <div className="space-y-4 p-4 pb-24 lg:p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
      <SettingsClient
        settings={settings}
        courts={settingsCourts}
        brands={settingsBrands}
        unsetGenderCount={unsetGenderCount}
      />
    </div>
  );
}
