import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

function roundTo1000(n: number): number {
  return Math.ceil(n / 1000) * 1000;
}

async function seed() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema });

  // ========== 0. RESET DATA (giữ lại member thật đã login bằng FB) ==========
  console.log("Resetting data (keeping real FB-authenticated members)...");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM inventory_purchases");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM courts");
  await client.execute("DELETE FROM shuttlecock_brands");
  await client.execute("DELETE FROM members WHERE facebook_id LIKE 'seed_%'");
  await client.execute("DELETE FROM admins");
  console.log("✓ Reset done (real members preserved)");

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
    {
      name: "Trường Tiểu học Tây Mỗ 3",
      address: "Gần S106",
      pricePerSession: 220000,
      mapLink: "https://maps.app.goo.gl/rS19wd9Ufy9FLgHs8",
    },
    {
      name: "Trường THCS Tây Mỗ 3",
      address: "Gần PZ3",
      pricePerSession: 220000,
      mapLink: "https://maps.app.goo.gl/Rnz2EKnH3xKxm9Fk8",
    },
    {
      name: "Atus",
      address: "",
      pricePerSession: 220000,
      mapLink: "https://maps.app.goo.gl/u94Uf9AnTeUamtrD6",
    },
    {
      name: "HP SPORT Coma5",
      address: "Coma5",
      pricePerSession: 220000,
      mapLink: "https://maps.app.goo.gl/LmcPnBBEzJK3Z4zE8",
    },
    {
      name: "TN Coma5",
      address: "Coma5",
      pricePerSession: 220000,
      mapLink: "https://maps.app.goo.gl/HTQjr5uwYgycKnpx9",
    },
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
  const session1Players = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đàm Hùng",
    "Duy Phương",
  ];
  const session1Diners = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đàm Hùng",
  ];
  const session1DiningBill = 850000;

  const [session1] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-03-16",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court1.id,
      courtPrice: court1.pricePerSession,
      status: "completed",
      diningBill: session1DiningBill,
      notes: "Buổi chơi 16/03",
    })
    .returning();
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
  const s1PlayCostPerHead = roundTo1000(
    (court1.pricePerSession + s1ShuttlecockCost) / session1Players.length,
  );
  const s1DineCostPerHead = roundTo1000(
    session1DiningBill / session1Diners.length,
  );
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
  const session2Players = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đinh Mạnh",
    "Đàm Hùng",
    "Xuân Trường",
    "Duy Phương",
    "Sơn Vĩ",
    "Kỳ Kỳ",
  ];
  const session2Diners = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đàm Hùng",
    "Xuân Trường",
    "Duy Phương",
    "Sơn Vĩ",
  ];
  const session2DiningBill = 1200000;

  const [session2] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-03-20",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court2.id,
      courtPrice: court2.pricePerSession,
      status: "completed",
      diningBill: session2DiningBill,
      notes: "Buổi chơi 20/03",
    })
    .returning();
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
  const s2PlayCostPerHead = roundTo1000(
    (court2.pricePerSession + s2ShuttlecockCost) / session2Players.length,
  );
  const s2DineCostPerHead = roundTo1000(
    session2DiningBill / session2Diners.length,
  );
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
  const session3Players = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đinh Mạnh",
    "Đàm Hùng",
    "Xuân Trường",
    "Duy Phương",
  ];
  const session3Diners = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đàm Hùng",
    "Xuân Trường",
    "Duy Phương",
  ];
  const session3DiningBill = 1080000;

  const [session3] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-03-23",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court3.id,
      courtPrice: court3.pricePerSession,
      status: "completed",
      diningBill: session3DiningBill,
      notes: "Buổi chơi 23/03",
    })
    .returning();
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
  const s3PlayCostPerHead = roundTo1000(
    (court3.pricePerSession + s3ShuttlecockCost) / session3Players.length,
  );
  const s3DineCostPerHead = roundTo1000(
    session3DiningBill / session3Diners.length,
  );
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

  // ========================================================================
  // ========== SESSION 4: 13/04/2026 (Monday) - COMPLETED + ALL PAID ==========
  // ========================================================================
  const court4 = courtMap.get("Atus")!;
  const session4Players = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đinh Mạnh",
    "Đàm Hùng",
    "Sơn Vĩ",
  ];
  const session4Diners = [
    "Tin Tin",
    "Tuấn Béo",
    "Hoàng Anh",
    "Đàm Hùng",
    "Sơn Vĩ",
  ];
  const session4DiningBill = 950000;

  const [session4] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-04-13",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court4.id,
      courtPrice: court4.pricePerSession,
      status: "completed",
      diningBill: session4DiningBill,
      notes: "Buổi chơi 13/04",
    })
    .returning();
  console.log(`\n✓ Session 4 seeded: 13/04/2026 (id=${session4.id})`);

  await db.insert(schema.sessionShuttlecocks).values({
    sessionId: session4.id,
    brandId: thanhCong.id,
    quantityUsed: 9,
    pricePerTube: thanhCong.pricePerTube,
  });

  for (const name of session4Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.votes).values({
      sessionId: session4.id,
      memberId: mid,
      willPlay: true,
      willDine: session4Diners.includes(name),
    });
    await db.insert(schema.sessionAttendees).values({
      sessionId: session4.id,
      memberId: mid,
      isGuest: false,
      attendsPlay: true,
      attendsDine: session4Diners.includes(name),
    });
  }

  const s4ShuttlecockCost = 9 * (thanhCong.pricePerTube / 12);
  const s4PlayCostPerHead = roundTo1000(
    (court4.pricePerSession + s4ShuttlecockCost) / session4Players.length,
  );
  const s4DineCostPerHead = roundTo1000(
    session4DiningBill / session4Diners.length,
  );

  for (const name of session4Players) {
    const mid = memberMap.get(name)!;
    const dines = session4Diners.includes(name);
    const total = s4PlayCostPerHead + (dines ? s4DineCostPerHead : 0);
    await db.insert(schema.sessionDebts).values({
      sessionId: session4.id,
      memberId: mid,
      playAmount: s4PlayCostPerHead,
      dineAmount: dines ? s4DineCostPerHead : 0,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: total,
      memberConfirmed: true,
      memberConfirmedAt: now,
      adminConfirmed: true,
      adminConfirmedAt: now,
    });
  }
  console.log(`✓ ${session4Players.length} debts seeded (ALL PAID)`);

  // ========================================================================
  // ========== SESSION 5: 20/04/2026 (Monday) - COMPLETED + MIXED PAYMENT ==
  // ========================================================================
  const court5 = courtMap.get("HP SPORT Coma5")!;
  const session5Players = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Đinh Mạnh",
    "Đàm Hùng",
    "Xuân Trường",
    "Sơn Vĩ",
    "Kỳ Kỳ",
  ];
  const session5Diners = [
    "Tin Tin",
    "Tuấn Béo",
    "Đàm Hùng",
    "Xuân Trường",
    "Sơn Vĩ",
  ];
  const session5DiningBill = 1100000;

  const [session5] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-04-20",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court5.id,
      courtPrice: court5.pricePerSession,
      status: "completed",
      diningBill: session5DiningBill,
      notes: "Buổi chơi 20/04",
    })
    .returning();
  console.log(`\n✓ Session 5 seeded: 20/04/2026 (id=${session5.id})`);

  await db.insert(schema.sessionShuttlecocks).values({
    sessionId: session5.id,
    brandId: bubadu.id,
    quantityUsed: 11,
    pricePerTube: bubadu.pricePerTube,
  });

  for (const name of session5Players) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.votes).values({
      sessionId: session5.id,
      memberId: mid,
      willPlay: true,
      willDine: session5Diners.includes(name),
    });
    await db.insert(schema.sessionAttendees).values({
      sessionId: session5.id,
      memberId: mid,
      isGuest: false,
      attendsPlay: true,
      attendsDine: session5Diners.includes(name),
    });
  }

  const s5ShuttlecockCost = 11 * (bubadu.pricePerTube / 12);
  const s5PlayCostPerHead = roundTo1000(
    (court5.pricePerSession + s5ShuttlecockCost) / session5Players.length,
  );
  const s5DineCostPerHead = roundTo1000(
    session5DiningBill / session5Diners.length,
  );

  // Mixed: nửa đầu đã trả, nửa sau chưa
  const session5PaidNames = new Set([
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Đàm Hùng",
  ]);
  for (const name of session5Players) {
    const mid = memberMap.get(name)!;
    const dines = session5Diners.includes(name);
    const total = s5PlayCostPerHead + (dines ? s5DineCostPerHead : 0);
    const paid = session5PaidNames.has(name);
    await db.insert(schema.sessionDebts).values({
      sessionId: session5.id,
      memberId: mid,
      playAmount: s5PlayCostPerHead,
      dineAmount: dines ? s5DineCostPerHead : 0,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: total,
      memberConfirmed: paid,
      memberConfirmedAt: paid ? now : null,
      adminConfirmed: paid,
      adminConfirmedAt: paid ? now : null,
    });
  }
  console.log(
    `✓ ${session5Players.length} debts seeded (${session5PaidNames.size} paid, ${session5Players.length - session5PaidNames.size} unpaid)`,
  );

  // ========================================================================
  // ========== SESSION 6: TODAY (Mon 27/04/2026) - VOTING ==========
  // ========================================================================
  const court6 = courtMap.get("Trường Tiểu học Tây Mỗ 3")!;
  const [session6] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-04-27",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court6.id,
      courtPrice: court6.pricePerSession,
      status: "voting",
      diningBill: 0,
      notes: "Buổi chơi hôm nay — đang vote",
    })
    .returning();
  console.log(
    `\n✓ Session 6 seeded: 27/04/2026 — TODAY VOTING (id=${session6.id})`,
  );

  // ========================================================================
  // ========== SESSION 7: Wed 29/04/2026 - VOTING (giữa tuần) ==========
  // ========================================================================
  const court7 = courtMap.get("Atus")!;
  const [session7] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-04-29",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court7.id,
      courtPrice: court7.pricePerSession,
      status: "voting",
      diningBill: 0,
      notes: "Buổi chơi giữa tuần (Thứ 4) — đang vote",
    })
    .returning();
  console.log(
    `✓ Session 7 seeded: 29/04/2026 (Wed) — VOTING (id=${session7.id})`,
  );

  // ========================================================================
  // ========== SESSION 8: Fri 01/05/2026 - VOTING (cuối tuần) ==========
  // ========================================================================
  const court8 = courtMap.get("Trường THCS Tây Mỗ 3")!;
  const [session8] = await db
    .insert(schema.sessions)
    .values({
      date: "2026-05-01",
      startTime: "20:30",
      endTime: "22:30",
      courtId: court8.id,
      courtPrice: court8.pricePerSession,
      status: "voting",
      diningBill: 0,
      notes: "Buổi chơi cuối tuần (Thứ 6) — đang vote",
    })
    .returning();
  console.log(
    `✓ Session 8 seeded: 01/05/2026 (Fri) — VOTING (id=${session8.id})`,
  );

  // Một số seed member đã vote sẵn để vote list không trống
  const session6PreVoted = [
    { name: "Tin Tin", play: true, dine: true },
    { name: "Nguyễn Lưu", play: true, dine: true },
    { name: "Tuấn Béo", play: true, dine: false },
    { name: "Đàm Hùng", play: true, dine: true },
    { name: "Sơn Vĩ", play: true, dine: false },
    { name: "Xuân Trường", play: false, dine: true },
    { name: "Kỳ Kỳ", play: true, dine: true },
  ];
  for (const v of session6PreVoted) {
    const mid = memberMap.get(v.name)!;
    await db.insert(schema.votes).values({
      sessionId: session6.id,
      memberId: mid,
      willPlay: v.play,
      willDine: v.dine,
      guestPlayCount: 0,
      guestDineCount: 0,
    });
  }
  // Thêm 1 vote có khách để test
  await db.insert(schema.votes).values({
    sessionId: session6.id,
    memberId: memberMap.get("Hoàng Anh")!,
    willPlay: true,
    willDine: true,
    guestPlayCount: 2,
    guestDineCount: 1,
  });
  console.log(
    `✓ ${session6PreVoted.length + 1} pre-votes seeded (1 có 2 khách cầu + 1 khách nhậu)`,
  );

  // ========================================================================
  // ========== FUND DATA (5 members tham gia quỹ) ==========
  // ========================================================================
  const fundMemberNames = [
    "Tin Tin",
    "Nguyễn Lưu",
    "Tuấn Béo",
    "Đàm Hùng",
    "Sơn Vĩ",
  ];
  for (const name of fundMemberNames) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.fundMembers).values({
      memberId: mid,
      isActive: true,
    });
  }
  console.log(`\n✓ ${fundMemberNames.length} fund members seeded`);

  // Fund contributions — mỗi người nạp 1-2tr
  const fundContributions: Array<[string, number]> = [
    ["Tin Tin", 2000000],
    ["Nguyễn Lưu", 1500000],
    ["Tuấn Béo", 2000000],
    ["Đàm Hùng", 1000000],
    ["Sơn Vĩ", 1500000],
  ];
  for (const [name, amount] of fundContributions) {
    const mid = memberMap.get(name)!;
    await db.insert(schema.financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount,
      memberId: mid,
      description: `Nạp quỹ ${name}`,
    });
  }
  console.log(
    `✓ ${fundContributions.length} fund contributions seeded (tổng ${fundContributions.reduce((s, [, a]) => s + a, 0).toLocaleString()}đ)`,
  );

  // Fund deductions: trích quỹ trả 1 phần buổi 4 (giả lập)
  await db.insert(schema.financialTransactions).values({
    type: "fund_deduction",
    direction: "out",
    amount: 200000,
    memberId: memberMap.get("Tin Tin")!,
    sessionId: session4.id,
    description: "Trừ quỹ — buổi 13/04",
  });
  await db.insert(schema.financialTransactions).values({
    type: "fund_deduction",
    direction: "out",
    amount: 150000,
    memberId: memberMap.get("Tuấn Béo")!,
    sessionId: session4.id,
    description: "Trừ quỹ — buổi 13/04",
  });
  console.log(`✓ 2 fund deductions seeded`);

  // ========================================================================
  // ========== REAL MEMBERS (FB login) — gắn nợ + quỹ để test ==========
  // ========================================================================
  const realMembers = await db.query.members.findMany();
  const realOnly = realMembers.filter((m) => !m.facebookId.startsWith("seed_"));
  console.log(`\nTìm thấy ${realOnly.length} member thật (FB login):`);
  for (const m of realOnly) console.log(`  - ${m.name} (id=${m.id})`);

  for (const real of realOnly) {
    // Gắn vào session 4 (đã trả) — để có lịch sử
    await db.insert(schema.votes).values({
      sessionId: session4.id,
      memberId: real.id,
      willPlay: true,
      willDine: true,
    });
    await db.insert(schema.sessionAttendees).values({
      sessionId: session4.id,
      memberId: real.id,
      isGuest: false,
      attendsPlay: true,
      attendsDine: true,
    });
    await db.insert(schema.sessionDebts).values({
      sessionId: session4.id,
      memberId: real.id,
      playAmount: s4PlayCostPerHead,
      dineAmount: s4DineCostPerHead,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: s4PlayCostPerHead + s4DineCostPerHead,
      memberConfirmed: true,
      memberConfirmedAt: now,
      adminConfirmed: true,
      adminConfirmedAt: now,
    });

    // Gắn vào session 5 (UNPAID) — để có nợ thực
    await db.insert(schema.votes).values({
      sessionId: session5.id,
      memberId: real.id,
      willPlay: true,
      willDine: false,
    });
    await db.insert(schema.sessionAttendees).values({
      sessionId: session5.id,
      memberId: real.id,
      isGuest: false,
      attendsPlay: true,
      attendsDine: false,
    });
    await db.insert(schema.sessionDebts).values({
      sessionId: session5.id,
      memberId: real.id,
      playAmount: s5PlayCostPerHead,
      dineAmount: 0,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: s5PlayCostPerHead,
      memberConfirmed: false,
      memberConfirmedAt: null,
      adminConfirmed: false,
      adminConfirmedAt: null,
    });

    // Gắn vào session 3 (UNPAID) — buổi cũ chưa trả
    await db.insert(schema.votes).values({
      sessionId: session3.id,
      memberId: real.id,
      willPlay: true,
      willDine: true,
    });
    await db.insert(schema.sessionAttendees).values({
      sessionId: session3.id,
      memberId: real.id,
      isGuest: false,
      attendsPlay: true,
      attendsDine: true,
    });
    await db.insert(schema.sessionDebts).values({
      sessionId: session3.id,
      memberId: real.id,
      playAmount: s3PlayCostPerHead,
      dineAmount: s3DineCostPerHead,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: s3PlayCostPerHead + s3DineCostPerHead,
      memberConfirmed: false,
      memberConfirmedAt: null,
      adminConfirmed: false,
      adminConfirmedAt: null,
    });

    // Cho vào quỹ + nạp 1.5tr
    await db.insert(schema.fundMembers).values({
      memberId: real.id,
      isActive: true,
    });
    await db.insert(schema.financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 1500000,
      memberId: real.id,
      description: `Nạp quỹ ${real.name}`,
    });
    await db.insert(schema.financialTransactions).values({
      type: "fund_deduction",
      direction: "out",
      amount: 100000,
      memberId: real.id,
      sessionId: session4.id,
      description: `Trừ quỹ — buổi 13/04`,
    });

    // Pre-vote vào session 6 (đang vote) cũng được
    await db.insert(schema.votes).values({
      sessionId: session6.id,
      memberId: real.id,
      willPlay: true,
      willDine: true,
      guestPlayCount: 0,
      guestDineCount: 0,
    });
  }
  if (realOnly.length > 0) {
    console.log(`✓ Seed nợ + quỹ cho ${realOnly.length} member thật`);
  }

  // ========== SUMMARY ==========
  console.log("\n=== SEED COMPLETE ===");
  console.log(`Admin: ${username} / ${password}`);
  console.log(`Members: ${memberData.length}`);
  console.log(`Courts: ${courtData.length}`);
  console.log(`Brands: ${brandData.length}`);
  console.log(`Sessions: 6 (3 cũ + 2 tháng này + 1 đang vote)`);
  console.log(`Fund: ${fundMemberNames.length} members`);
  console.log(
    `\nSession 1 (16/03): ${session1Players.length} players, ${session1Diners.length} diners - ALL PAID`,
  );
  console.log(
    `  Play: ${s1PlayCostPerHead.toLocaleString()}đ, Dine: ${s1DineCostPerHead.toLocaleString()}đ`,
  );
  console.log(
    `Session 2 (20/03): ${session2Players.length} players, ${session2Diners.length} diners - ALL PAID`,
  );
  console.log(
    `  Play: ${s2PlayCostPerHead.toLocaleString()}đ, Dine: ${s2DineCostPerHead.toLocaleString()}đ`,
  );
  console.log(
    `Session 3 (23/03): ${session3Players.length} players, ${session3Diners.length} diners - UNPAID`,
  );
  console.log(
    `  Play: ${s3PlayCostPerHead.toLocaleString()}đ, Dine: ${s3DineCostPerHead.toLocaleString()}đ`,
  );

  process.exit(0);
}

seed().catch(console.error);
