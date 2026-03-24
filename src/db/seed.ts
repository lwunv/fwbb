import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

async function seed() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema });

  // ========== 1. ADMIN ==========
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const hash = await bcrypt.hash(password, 12);

  await db.insert(schema.admins).values({
    username,
    passwordHash: hash,
  }).onConflictDoNothing();
  console.log(`✓ Admin seeded: ${username}`);

  // ========== 2. MEMBERS (19 người) ==========
  const memberData = [
    { name: "Susu", phone: "0900000001" },         // admin
    { name: "Tin Tin", phone: "0900000002" },
    { name: "Nguyễn Lưu", phone: "0900000003" },
    { name: "Tuấn Béo", phone: "0900000004" },
    { name: "Hoàng Anh", phone: "0900000005" },
    { name: "Đinh Mạnh", phone: "0900000006" },
    { name: "Đàm Hùng", phone: "0900000007" },
    { name: "Xuân Trường", phone: "0900000008" },
    { name: "Duy Phương", phone: "0900000009" },
    { name: "Kỳ Kỳ", phone: "0900000010" },
    { name: "Sơn Vĩ", phone: "0900000011" },
    { name: "Thanh Vân", phone: "0900000012" },
    { name: "Nguyễn Việt", phone: "0900000013" },
    { name: "Hồng Phong", phone: "0900000014" },
    { name: "Trần Tùng", phone: "0900000015" },
    { name: "Minh Hoàng", phone: "0900000016" },
    { name: "Hoàng Lân", phone: "0900000017" },
    { name: "Trương Quang", phone: "0900000018" },
    { name: "Xuân Hiệp", phone: "0900000019" },
  ];

  for (const m of memberData) {
    await db.insert(schema.members).values(m).onConflictDoNothing();
  }
  console.log(`✓ ${memberData.length} members seeded`);

  // Get inserted member IDs
  const allMembers = await db.query.members.findMany();
  const memberMap = new Map(allMembers.map((m) => [m.name, m.id]));

  // ========== 3. COURTS (4 sân, all 220k/2h) ==========
  const courtData = [
    { name: "Tiểu học Tây Mỗ", address: "Gần PZ3", pricePerSession: 220000 },
    { name: "Trung học Tây Mỗ", address: "Gần S106", pricePerSession: 220000 },
    { name: "HS - Coma5", address: "Coma5", pricePerSession: 220000 },
    { name: "HP - Coma5", address: "Coma5", pricePerSession: 220000 },
  ];

  for (const c of courtData) {
    await db.insert(schema.courts).values(c).onConflictDoNothing();
  }
  console.log(`✓ ${courtData.length} courts seeded`);

  const allCourts = await db.query.courts.findMany();
  const courtMap = new Map(allCourts.map((c) => [c.name, c]));

  // ========== 4. SHUTTLECOCK BRANDS (4 hãng) ==========
  const brandData = [
    { name: "Bubadu", pricePerTube: 310000 },
    { name: "Thành Công 77", pricePerTube: 325000 },
    { name: "Hải Yến S70", pricePerTube: 285000 },
    { name: "Prox", pricePerTube: 315000 },
  ];

  for (const b of brandData) {
    await db.insert(schema.shuttlecockBrands).values(b).onConflictDoNothing();
  }
  console.log(`✓ ${brandData.length} shuttlecock brands seeded`);

  const allBrands = await db.query.shuttlecockBrands.findMany();
  const brandMap = new Map(allBrands.map((b) => [b.name, b]));

  // ========== 5. INVENTORY (mua cầu ban đầu) ==========
  const bubadu = brandMap.get("Bubadu")!;
  await db.insert(schema.inventoryPurchases).values({
    brandId: bubadu.id,
    tubes: 5,
    pricePerTube: 310000,
    totalPrice: 1550000,
    purchasedAt: "2026-03-20",
    notes: "Mua lần đầu",
  });
  console.log("✓ Inventory purchase seeded (5 ống Bubadu)");

  // ========== 6. SESSION 23/03/2026 (Thứ Hai) ==========
  const court = courtMap.get("Tiểu học Tây Mỗ")!;

  const [session] = await db.insert(schema.sessions).values({
    date: "2026-03-23",
    startTime: "20:30",
    endTime: "22:30",
    courtId: court.id,
    courtPrice: court.pricePerSession,
    status: "completed",
    diningBill: 1080000,
    notes: "Buổi chơi đầu tiên trên app",
  }).returning();
  console.log(`✓ Session seeded: 23/03/2026 (id=${session.id})`);

  // ========== 7. SESSION SHUTTLECOCKS (10 quả Bubadu) ==========
  await db.insert(schema.sessionShuttlecocks).values({
    sessionId: session.id,
    brandId: bubadu.id,
    quantityUsed: 10,
    pricePerTube: bubadu.pricePerTube,
  });
  console.log("✓ Session shuttlecocks seeded (10 quả Bubadu)");

  // ========== 8. VOTES ==========
  const players = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đinh Mạnh", "Đàm Hùng", "Xuân Trường", "Duy Phương"];
  const diners = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đàm Hùng", "Xuân Trường", "Duy Phương"];

  for (const name of players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.votes).values({
      sessionId: session.id,
      memberId: mid,
      willPlay: true,
      willDine: diners.includes(name),
    }).onConflictDoNothing();
  }
  console.log(`✓ ${players.length} votes seeded`);

  // ========== 9. SESSION ATTENDEES ==========
  for (const name of players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.sessionAttendees).values({
      sessionId: session.id,
      memberId: mid,
      isGuest: false,
      attendsPlay: true,
      attendsDine: diners.includes(name),
    });
  }
  console.log(`✓ ${players.length} attendees seeded`);

  // ========== 10. COST CALCULATION + DEBTS ==========
  // Tiền cầu: 10 quả × (310000/12) = 258,333 VND
  const shuttlecockCost = 10 * (310000 / 12);
  // Tiền sân: 220,000 VND
  const courtCost = court.pricePerSession;
  // Tiền chơi/đầu: (220000 + 258333) / 8 = 59,792 → round to 60,000
  const playCostPerHead = Math.round((courtCost + shuttlecockCost) / players.length / 1000) * 1000;
  // Tiền ăn/đầu: 1,080,000 / 7 = 154,286 → round to 154,000
  const dineCostPerHead = Math.round(1080000 / diners.length / 1000) * 1000;

  console.log(`  Play cost/head: ${playCostPerHead.toLocaleString()}đ`);
  console.log(`  Dine cost/head: ${dineCostPerHead.toLocaleString()}đ`);

  for (const name of players) {
    const mid = memberMap.get(name)!;
    const plays = true;
    const dines = diners.includes(name);
    const playAmount = plays ? playCostPerHead : 0;
    const dineAmount = dines ? dineCostPerHead : 0;
    const total = playAmount + dineAmount;

    // Admin (Susu) auto-confirmed
    const isAdmin = name === "Susu";

    await db.insert(schema.sessionDebts).values({
      sessionId: session.id,
      memberId: mid,
      playAmount,
      dineAmount,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: total,
      memberConfirmed: isAdmin,
      memberConfirmedAt: isAdmin ? new Date().toISOString() : null,
      adminConfirmed: isAdmin,
      adminConfirmedAt: isAdmin ? new Date().toISOString() : null,
    });
  }

  console.log(`✓ ${players.length} debts seeded`);
  console.log("");
  console.log("=== SEED COMPLETE ===");
  console.log(`Players: ${players.join(", ")}`);
  console.log(`Diners: ${diners.join(", ")}`);
  console.log(`Đinh Mạnh: chơi nhưng không ăn → ${playCostPerHead.toLocaleString()}đ`);
  console.log(`Còn lại: chơi + ăn → ${(playCostPerHead + dineCostPerHead).toLocaleString()}đ`);

  process.exit(0);
}

seed().catch(console.error);
