import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

function roundTo1000(n: number): number {
  return Math.round(n / 1000) * 1000;
}

async function seed() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema });

  // ========== 0. DELETE ALL EXISTING DATA ==========
  console.log("Deleting all existing data...");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM inventory_purchases");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM courts");
  await client.execute("DELETE FROM shuttlecock_brands");
  await client.execute("DELETE FROM members");
  await client.execute("DELETE FROM admins");
  console.log("✓ All data deleted");

  // ========== 1. ADMIN ==========
  const username = "admin";
  const password = "admin123";
  const hash = await bcrypt.hash(password, 12);

  await db.insert(schema.admins).values({
    username,
    passwordHash: hash,
  });
  console.log(`✓ Admin seeded: ${username}`);

  // ========== 2. MEMBERS (19 người) ==========
  const memberData = [
    { name: "Susu", facebookId: "seed_001" },
    { name: "Tin Tin", facebookId: "seed_002" },
    { name: "Nguyễn Lưu", facebookId: "seed_003" },
    { name: "Tuấn Béo", facebookId: "seed_004" },
    { name: "Hoàng Anh", facebookId: "seed_005" },
    { name: "Đinh Mạnh", facebookId: "seed_006" },
    { name: "Đàm Hùng", facebookId: "seed_007" },
    { name: "Xuân Trường", facebookId: "seed_008" },
    { name: "Duy Phương", facebookId: "seed_009" },
    { name: "Kỳ Kỳ", facebookId: "seed_010" },
    { name: "Sơn Vĩ", facebookId: "seed_011" },
    { name: "Thanh Vân", facebookId: "seed_012" },
    { name: "Nguyễn Việt", facebookId: "seed_013" },
    { name: "Hồng Phong", facebookId: "seed_014" },
    { name: "Trần Tùng", facebookId: "seed_015" },
    { name: "Minh Hoàng", facebookId: "seed_016" },
    { name: "Hoàng Lân", facebookId: "seed_017" },
    { name: "Trương Quang", facebookId: "seed_018" },
    { name: "Xuân Hiệp", facebookId: "seed_019" },
  ];

  for (const m of memberData) {
    await db.insert(schema.members).values(m);
  }
  console.log(`✓ ${memberData.length} members seeded`);

  const allMembers = await db.query.members.findMany();
  const memberMap = new Map(allMembers.map((m) => [m.name, m.id]));

  // ========== 3. COURTS (5 sân, all 220k/2h) ==========
  const courtData = [
    { name: "Trường Tiểu học Tây Mỗ 3", address: "Gần S106", pricePerSession: 220000, mapLink: "https://maps.app.goo.gl/rS19wd9Ufy9FLgHs8" },
    { name: "Trường THCS Tây Mỗ 3", address: "Gần PZ3", pricePerSession: 220000, mapLink: "https://maps.app.goo.gl/Rnz2EKnH3xKxm9Fk8" },
    { name: "Atus", address: "", pricePerSession: 220000, mapLink: "https://maps.app.goo.gl/u94Uf9AnTeUamtrD6" },
    { name: "HP SPORT Coma5", address: "Coma5", pricePerSession: 220000, mapLink: "https://maps.app.goo.gl/LmcPnBBEzJK3Z4zE8" },
    { name: "TN Coma5", address: "Coma5", pricePerSession: 220000, mapLink: "https://maps.app.goo.gl/HTQjr5uwYgycKnpx9" },
  ];

  for (const c of courtData) {
    await db.insert(schema.courts).values(c);
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
    await db.insert(schema.shuttlecockBrands).values(b);
  }
  console.log(`✓ ${brandData.length} shuttlecock brands seeded`);

  const allBrands = await db.query.shuttlecockBrands.findMany();
  const brandMap = new Map(allBrands.map((b) => [b.name, b]));

  // ========== 5. INVENTORY (mua cầu ban đầu) ==========
  const bubadu = brandMap.get("Bubadu")!;
  const thanhCong = brandMap.get("Thành Công 77")!;

  await db.insert(schema.inventoryPurchases).values({
    brandId: bubadu.id,
    tubes: 5,
    pricePerTube: 310000,
    totalPrice: 5 * 310000,
    purchasedAt: "2026-03-14",
    notes: "Mua lần đầu - Bubadu",
  });

  await db.insert(schema.inventoryPurchases).values({
    brandId: thanhCong.id,
    tubes: 3,
    pricePerTube: 325000,
    totalPrice: 3 * 325000,
    purchasedAt: "2026-03-14",
    notes: "Mua lần đầu - Thành Công 77",
  });
  console.log("✓ Inventory seeded (5 ống Bubadu, 3 ống Thành Công 77)");

  // ========================================================================
  // ========== SESSION 1: 16/03/2026 (Monday) - COMPLETED + ALL PAID ==========
  // ========================================================================
  const court1 = courtMap.get("Trường Tiểu học Tây Mỗ 3")!;
  const session1Players = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đàm Hùng", "Duy Phương"];
  const session1Diners = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đàm Hùng"];
  const session1DiningBill = 850000;

  const [session1] = await db.insert(schema.sessions).values({
    date: "2026-03-16",
    startTime: "20:30",
    endTime: "22:30",
    courtId: court1.id,
    courtPrice: court1.pricePerSession,
    status: "completed",
    diningBill: session1DiningBill,
    notes: "Buổi chơi 16/03",
  }).returning();
  console.log(`\n✓ Session 1 seeded: 16/03/2026 (id=${session1.id})`);

  // Shuttlecocks: 8 quả Bubadu
  await db.insert(schema.sessionShuttlecocks).values({
    sessionId: session1.id,
    brandId: bubadu.id,
    quantityUsed: 8,
    pricePerTube: bubadu.pricePerTube,
  });

  // Votes
  for (const name of session1Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.votes).values({
      sessionId: session1.id,
      memberId: mid,
      willPlay: true,
      willDine: session1Diners.includes(name),
    });
  }

  // Attendees
  for (const name of session1Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.sessionAttendees).values({
      sessionId: session1.id,
      memberId: mid,
      isGuest: false,
      attendsPlay: true,
      attendsDine: session1Diners.includes(name),
    });
  }

  // Cost calculation
  // shuttlecock_cost = 8 * (310000 / 12) = 206666.67
  const s1ShuttlecockCost = 8 * (bubadu.pricePerTube / 12);
  const s1PlayCostPerHead = roundTo1000((court1.pricePerSession + s1ShuttlecockCost) / session1Players.length);
  const s1DineCostPerHead = roundTo1000(session1DiningBill / session1Diners.length);
  console.log(`  Play cost/head: ${s1PlayCostPerHead.toLocaleString()}đ`);
  console.log(`  Dine cost/head: ${s1DineCostPerHead.toLocaleString()}đ`);

  // Debts - ALL PAID
  const now = new Date().toISOString();
  for (const name of session1Players) {
    const mid = memberMap.get(name)!;
    const dines = session1Diners.includes(name);
    const playAmount = s1PlayCostPerHead;
    const dineAmount = dines ? s1DineCostPerHead : 0;
    const total = playAmount + dineAmount;

    await db.insert(schema.sessionDebts).values({
      sessionId: session1.id,
      memberId: mid,
      playAmount,
      dineAmount,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: total,
      memberConfirmed: true,
      memberConfirmedAt: now,
      adminConfirmed: true,
      adminConfirmedAt: now,
    });
  }
  console.log(`✓ ${session1Players.length} debts seeded (ALL PAID)`);

  // ========================================================================
  // ========== SESSION 2: 20/03/2026 (Friday) - COMPLETED + ALL PAID ==========
  // ========================================================================
  const court2 = courtMap.get("Trường THCS Tây Mỗ 3")!;
  const session2Players = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đinh Mạnh", "Đàm Hùng", "Xuân Trường", "Duy Phương", "Sơn Vĩ", "Kỳ Kỳ"];
  const session2Diners = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đàm Hùng", "Xuân Trường", "Duy Phương", "Sơn Vĩ"];
  const session2DiningBill = 1200000;

  const [session2] = await db.insert(schema.sessions).values({
    date: "2026-03-20",
    startTime: "20:30",
    endTime: "22:30",
    courtId: court2.id,
    courtPrice: court2.pricePerSession,
    status: "completed",
    diningBill: session2DiningBill,
    notes: "Buổi chơi 20/03",
  }).returning();
  console.log(`\n✓ Session 2 seeded: 20/03/2026 (id=${session2.id})`);

  // Shuttlecocks: 12 quả Thành Công 77
  await db.insert(schema.sessionShuttlecocks).values({
    sessionId: session2.id,
    brandId: thanhCong.id,
    quantityUsed: 12,
    pricePerTube: thanhCong.pricePerTube,
  });

  // Votes
  for (const name of session2Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.votes).values({
      sessionId: session2.id,
      memberId: mid,
      willPlay: true,
      willDine: session2Diners.includes(name),
    });
  }

  // Attendees
  for (const name of session2Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.sessionAttendees).values({
      sessionId: session2.id,
      memberId: mid,
      isGuest: false,
      attendsPlay: true,
      attendsDine: session2Diners.includes(name),
    });
  }

  // Cost calculation
  // shuttlecock_cost = 12 * (325000 / 12) = 325000
  const s2ShuttlecockCost = 12 * (thanhCong.pricePerTube / 12);
  const s2PlayCostPerHead = roundTo1000((court2.pricePerSession + s2ShuttlecockCost) / session2Players.length);
  const s2DineCostPerHead = roundTo1000(session2DiningBill / session2Diners.length);
  console.log(`  Play cost/head: ${s2PlayCostPerHead.toLocaleString()}đ`);
  console.log(`  Dine cost/head: ${s2DineCostPerHead.toLocaleString()}đ`);

  // Debts - ALL PAID
  for (const name of session2Players) {
    const mid = memberMap.get(name)!;
    const dines = session2Diners.includes(name);
    const playAmount = s2PlayCostPerHead;
    const dineAmount = dines ? s2DineCostPerHead : 0;
    const total = playAmount + dineAmount;

    await db.insert(schema.sessionDebts).values({
      sessionId: session2.id,
      memberId: mid,
      playAmount,
      dineAmount,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: total,
      memberConfirmed: true,
      memberConfirmedAt: now,
      adminConfirmed: true,
      adminConfirmedAt: now,
    });
  }
  console.log(`✓ ${session2Players.length} debts seeded (ALL PAID)`);

  // ========================================================================
  // ========== SESSION 3: 23/03/2026 (Monday) - COMPLETED + UNPAID ==========
  // ========================================================================
  const court3 = courtMap.get("Trường Tiểu học Tây Mỗ 3")!;
  const session3Players = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đinh Mạnh", "Đàm Hùng", "Xuân Trường", "Duy Phương"];
  const session3Diners = ["Tin Tin", "Nguyễn Lưu", "Tuấn Béo", "Hoàng Anh", "Đàm Hùng", "Xuân Trường", "Duy Phương"];
  const session3DiningBill = 1080000;

  const [session3] = await db.insert(schema.sessions).values({
    date: "2026-03-23",
    startTime: "20:30",
    endTime: "22:30",
    courtId: court3.id,
    courtPrice: court3.pricePerSession,
    status: "completed",
    diningBill: session3DiningBill,
    notes: "Buổi chơi 23/03",
  }).returning();
  console.log(`\n✓ Session 3 seeded: 23/03/2026 (id=${session3.id})`);

  // Shuttlecocks: 10 quả Bubadu
  await db.insert(schema.sessionShuttlecocks).values({
    sessionId: session3.id,
    brandId: bubadu.id,
    quantityUsed: 10,
    pricePerTube: bubadu.pricePerTube,
  });

  // Votes
  for (const name of session3Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.votes).values({
      sessionId: session3.id,
      memberId: mid,
      willPlay: true,
      willDine: session3Diners.includes(name),
    });
  }

  // Attendees
  for (const name of session3Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.sessionAttendees).values({
      sessionId: session3.id,
      memberId: mid,
      isGuest: false,
      attendsPlay: true,
      attendsDine: session3Diners.includes(name),
    });
  }

  // Cost calculation
  // shuttlecock_cost = 10 * (310000 / 12) = 258333.33
  const s3ShuttlecockCost = 10 * (bubadu.pricePerTube / 12);
  const s3PlayCostPerHead = roundTo1000((court3.pricePerSession + s3ShuttlecockCost) / session3Players.length);
  const s3DineCostPerHead = roundTo1000(session3DiningBill / session3Diners.length);
  console.log(`  Play cost/head: ${s3PlayCostPerHead.toLocaleString()}đ`);
  console.log(`  Dine cost/head: ${s3DineCostPerHead.toLocaleString()}đ`);

  // Debts - UNPAID
  for (const name of session3Players) {
    const mid = memberMap.get(name)!;
    const dines = session3Diners.includes(name);
    const playAmount = s3PlayCostPerHead;
    const dineAmount = dines ? s3DineCostPerHead : 0;
    const total = playAmount + dineAmount;

    await db.insert(schema.sessionDebts).values({
      sessionId: session3.id,
      memberId: mid,
      playAmount,
      dineAmount,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: total,
      memberConfirmed: false,
      memberConfirmedAt: null,
      adminConfirmed: false,
      adminConfirmedAt: null,
    });
  }
  console.log(`✓ ${session3Players.length} debts seeded (UNPAID)`);

  // ========== SUMMARY ==========
  console.log("\n=== SEED COMPLETE ===");
  console.log(`Admin: ${username} / ${password}`);
  console.log(`Members: ${memberData.length}`);
  console.log(`Courts: ${courtData.length}`);
  console.log(`Brands: ${brandData.length}`);
  console.log(`Sessions: 3`);
  console.log(`\nSession 1 (16/03): ${session1Players.length} players, ${session1Diners.length} diners - ALL PAID`);
  console.log(`  Play: ${s1PlayCostPerHead.toLocaleString()}đ, Dine: ${s1DineCostPerHead.toLocaleString()}đ`);
  console.log(`Session 2 (20/03): ${session2Players.length} players, ${session2Diners.length} diners - ALL PAID`);
  console.log(`  Play: ${s2PlayCostPerHead.toLocaleString()}đ, Dine: ${s2DineCostPerHead.toLocaleString()}đ`);
  console.log(`Session 3 (23/03): ${session3Players.length} players, ${session3Diners.length} diners - UNPAID`);
  console.log(`  Play: ${s3PlayCostPerHead.toLocaleString()}đ, Dine: ${s3DineCostPerHead.toLocaleString()}đ`);

  process.exit(0);
}

seed().catch(console.error);
