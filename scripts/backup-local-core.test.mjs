/**
 * Phần quyết định của bản sao lưu để ở máy.
 *
 * Nỗi lo ở đây không phải "có chạy không", mà là BÁO XANH NHẦM: một bản sao
 * lưu hỏng mà vẫn báo thành công còn tệ hơn không có bản nào, vì lúc cần đến
 * thì không ai kiểm lại nữa. Nên mấy bài dưới đây xoáy vào ba thứ:
 *
 * 1. Ghi ra rồi đọc lại phải ra ĐÚNG dữ liệu ban đầu, kể cả blob và giá trị
 *    rỗng. Mất một cột lúc khôi phục thì không ai biết cho tới khi quá muộn.
 * 2. Bản ghi theo patch phải dựng lại được y hệt bản đầy đủ. Patch là chỗ dễ
 *    sai nhất, vì nó chỉ ghi phần CHÊNH, nên một dòng bị xoá mà patch không
 *    ghi nhận là mất luôn.
 * 3. Sai mật khẩu hay file bị sửa một byte thì phải BÁO HỎNG, không được trả
 *    về dữ liệu nửa vời.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalTables,
  restoreTables,
  diffSnapshots,
  applyPatch,
  snapshotHash,
  seal,
  unseal,
  pickBaseAndChain,
  planMirror,
} from "./backup-local-core.mjs";

/** Một bản dump bé nhưng có đủ mấy kiểu dữ liệu hay làm vỡ round-trip. */
function snap(tables, takenAt = "2026-11-03T00:00:00.000Z") {
  return {
    meta: { database: "libsql://x", takenAt, tableCount: Object.keys(tables).length },
    tables,
  };
}

const BASE = snap({
  members: [
    { id: 1, name: "Liên", nickname: null, is_active: 1 },
    { id: 2, name: "Châu", nickname: "ch", is_active: 1 },
  ],
  app_settings: [{ key: "appName", value: "FWBB" }],
});

describe("chuẩn hoá rồi dựng lại", () => {
  it("dựng lại ra đúng dữ liệu ban đầu", () => {
    const canon = canonicalTables(BASE.tables);
    const back = restoreTables(canon);
    expect(canonicalTables(back)).toEqual(canon);
    expect(back.members).toHaveLength(2);
    expect(back.members.find((m) => m.id === 1).name).toBe("Liên");
  });

  it("giữ null, chuỗi rỗng và số 0 khác nhau", () => {
    const t = { t: [{ a: null, b: "", c: 0, d: false }] };
    const back = restoreTables(canonicalTables(t));
    expect(back.t[0]).toEqual({ a: null, b: "", c: 0, d: false });
  });

  it("giữ nguyên blob", () => {
    const t = { t: [{ id: 1, blob: new Uint8Array([0, 255, 16]) }] };
    const back = restoreTables(canonicalTables(t));
    expect(Buffer.from(back.t[0].blob)).toEqual(Buffer.from([0, 255, 16]));
  });

  it("hai dòng trùng nhau y hệt vẫn còn đủ hai", () => {
    const t = { t: [{ a: 1 }, { a: 1 }] };
    expect(restoreTables(canonicalTables(t)).t).toHaveLength(2);
  });
});

describe("patch", () => {
  it("thêm dòng: dựng lại khớp bản đầy đủ", () => {
    const next = snap({
      ...BASE.tables,
      members: [...BASE.tables.members, { id: 3, name: "Hà", nickname: null, is_active: 1 }],
    });
    const patch = diffSnapshots(BASE, next);
    expect(snapshotHash(applyPatch(BASE, patch))).toBe(snapshotHash(next));
  });

  it("XOÁ dòng cũng phải dựng lại đúng", () => {
    const next = snap({ ...BASE.tables, members: [BASE.tables.members[0]] });
    const patch = diffSnapshots(BASE, next);
    const got = applyPatch(BASE, patch);
    expect(got.tables.members).toHaveLength(1);
    expect(snapshotHash(got)).toBe(snapshotHash(next));
  });

  it("sửa một ô: dựng lại đúng giá trị mới", () => {
    const next = snap({
      ...BASE.tables,
      members: [{ ...BASE.tables.members[0], name: "Liên B" }, BASE.tables.members[1]],
    });
    const got = applyPatch(BASE, diffSnapshots(BASE, next));
    expect(got.tables.members.find((m) => m.id === 1).name).toBe("Liên B");
    expect(snapshotHash(got)).toBe(snapshotHash(next));
  });

  it("thêm hẳn một bảng mới", () => {
    const next = snap({ ...BASE.tables, courts: [{ id: 1, name: "Sân A" }] });
    const got = applyPatch(BASE, diffSnapshots(BASE, next));
    expect(got.tables.courts).toHaveLength(1);
    expect(snapshotHash(got)).toBe(snapshotHash(next));
  });

  // Bắt được trên dữ liệu thật ngày 03/11/2026: prod thêm bảng `venues` còn
  // rỗng, patch bỏ qua vì không có dòng nào thêm hay bớt, nên bản dựng lại
  // thiếu hẳn một bảng. Bảng rỗng hôm nay là bảng có dữ liệu ngày mai.
  it("thêm một bảng mới CÒN RỖNG thì bản dựng lại vẫn phải có bảng đó", () => {
    const next = snap({ ...BASE.tables, venues: [] });
    const patch = diffSnapshots(BASE, next);
    const got = applyPatch(BASE, patch);
    expect(got.tables.venues).toEqual([]);
    expect(snapshotHash(got)).toBe(snapshotHash(next));
  });

  it("bảng bị xoá hẳn thì bản dựng lại cũng không còn", () => {
    const next = snap({ members: BASE.tables.members });
    const got = applyPatch(BASE, diffSnapshots(BASE, next));
    expect(got.tables.app_settings).toBeUndefined();
    expect(snapshotHash(got)).toBe(snapshotHash(next));
  });

  it("không đổi gì thì patch rỗng, dựng lại vẫn khớp", () => {
    const patch = diffSnapshots(BASE, snap(BASE.tables, "2026-11-04T00:00:00.000Z"));
    expect(patch.changedTables).toBe(0);
    expect(snapshotHash(applyPatch(BASE, patch))).toBe(snapshotHash(snap(BASE.tables)));
  });

  it("patch ghi rõ nó bám vào bản nào, áp nhầm gốc thì BÁO LỖI", () => {
    const next = snap({ ...BASE.tables, courts: [{ id: 9, name: "X" }] });
    const patch = diffSnapshots(BASE, next);
    expect(patch.baseHash).toBe(snapshotHash(BASE));
    const khac = snap({ members: [] });
    expect(() => applyPatch(khac, patch)).toThrow(/gốc/i);
  });

  it("nối nhiều patch liên tiếp vẫn ra đúng", () => {
    const s1 = snap({ ...BASE.tables, members: [...BASE.tables.members, { id: 3, name: "C", nickname: null, is_active: 1 }] });
    const s2 = snap({ ...s1.tables, app_settings: [{ key: "appName", value: "DOI" }] });
    const p1 = diffSnapshots(BASE, s1);
    const p2 = diffSnapshots(s1, s2);
    expect(snapshotHash(applyPatch(applyPatch(BASE, p1), p2))).toBe(snapshotHash(s2));
  });
});

describe("mã hoá", () => {
  const PASS = "mat-khau-thu-khong-phai-that";

  it("niêm rồi mở ra đúng nội dung cũ", () => {
    const sealed = seal(BASE, PASS);
    expect(Buffer.isBuffer(sealed)).toBe(true);
    expect(snapshotHash(unseal(sealed, PASS))).toBe(snapshotHash(BASE));
  });

  it("file niêm KHÔNG được chứa dữ liệu đọc được", () => {
    const sealed = seal(BASE, PASS).toString("latin1");
    expect(sealed).not.toContain("Liên");
    expect(sealed).not.toContain("members");
  });

  it("sai mật khẩu thì báo lỗi, không trả dữ liệu nửa vời", () => {
    expect(() => unseal(seal(BASE, PASS), "sai-mat-khau")).toThrow();
  });

  it("sửa một byte trong file thì báo lỗi", () => {
    const b = seal(BASE, PASS);
    b[b.length - 5] ^= 0xff;
    expect(() => unseal(b, PASS)).toThrow();
  });

  it("hai lần niêm cùng dữ liệu ra hai file khác nhau", () => {
    expect(seal(BASE, PASS).equals(seal(BASE, PASS))).toBe(false);
  });
});

describe("chọn chuỗi để dựng lại", () => {
  const files = [
    { name: "a", kind: "full", takenAt: "2026-11-01T00:00:00Z", hash: "h1" },
    { name: "b", kind: "patch", takenAt: "2026-11-02T00:00:00Z", baseHash: "h1", hash: "h2" },
    { name: "c", kind: "patch", takenAt: "2026-11-03T00:00:00Z", baseHash: "h2", hash: "h3" },
  ];

  it("lấy bản đầy đủ gần nhất rồi nối patch theo đúng thứ tự", () => {
    const chain = pickBaseAndChain(files);
    expect(chain.map((f) => f.name)).toEqual(["a", "b", "c"]);
  });

  it("dựng lại tới một mốc cũ hơn thì cắt đúng chỗ", () => {
    const chain = pickBaseAndChain(files, "2026-11-02T00:00:00Z");
    expect(chain.map((f) => f.name)).toEqual(["a", "b"]);
  });

  it("đứt xích thì BÁO LỖI chứ không im lặng dựng thiếu", () => {
    const dut = [files[0], { ...files[2] }];
    expect(() => pickBaseAndChain(dut)).toThrow(/đứt|thiếu/i);
  });

  it("không có bản đầy đủ nào thì báo lỗi", () => {
    expect(() => pickBaseAndChain([files[1]])).toThrow(/đầy đủ/i);
  });
});

describe("chép sang chỗ thứ hai", () => {
  const files = [
    { name: "a.full.enc", kind: "full", takenAt: "2026-11-01T00:00:00Z", hash: "h1", bytes: 800 },
    { name: "b.patch.enc", kind: "patch", takenAt: "2026-11-02T00:00:00Z", baseHash: "h1", hash: "h2", bytes: 90 },
  ];

  it("chỗ thứ hai còn trống thì chép hết, theo thứ tự thời gian", () => {
    expect(planMirror(files, {})).toEqual(["a.full.enc", "b.patch.enc"]);
  });

  it("đã có đủ rồi thì không chép lại gì", () => {
    expect(planMirror(files, { "a.full.enc": 800, "b.patch.enc": 90 })).toEqual([]);
  });

  it("file bên kia chép dở (sai kích thước) thì chép lại", () => {
    expect(planMirror(files, { "a.full.enc": 512, "b.patch.enc": 90 })).toEqual(["a.full.enc"]);
  });

  it("KHÔNG đụng vào file lạ bên kia: nguồn dọn bản cũ không được kéo theo chỗ thứ hai", () => {
    const con = { "a.full.enc": 800, "b.patch.enc": 90, "cu-lam-roi.full.enc": 700 };
    expect(planMirror(files, con)).toEqual([]);
  });

  it("thứ tự thời gian, không phải thứ tự trong sổ", () => {
    const lonXon = [files[1], files[0]];
    expect(planMirror(lonXon, {})).toEqual(["a.full.enc", "b.patch.enc"]);
  });
});
