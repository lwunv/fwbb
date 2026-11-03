/**
 * Phần lõi của bản sao lưu để ở máy: chuẩn hoá, so chênh, niêm phong.
 *
 * Tách riêng khỏi script chạy tay để test được bằng vitest. Một script vận
 * hành sai chỉ lộ ra đúng lúc đang cần nó nhất, nên phần quyết định phải có
 * bài kiểm riêng (xem `backup-local-core.test.mjs`).
 *
 * Ba thứ cần giữ đúng:
 *
 * 1. **Dựng lại phải ra đúng dữ liệu cũ.** Một cột rụng lúc khôi phục thì
 *    không ai biết cho tới khi quá muộn, nên mọi thứ đi qua một dạng chuẩn
 *    hoá có ghi kèm KIỂU dữ liệu, để `null`, chuỗi rỗng, số 0 và `false`
 *    không lẫn vào nhau sau một vòng JSON.
 * 2. **Patch phải ghi được cả dòng bị XOÁ.** Chỗ này dễ sai nhất: patch chỉ
 *    ghi phần chênh, nên nếu chỉ ghi dòng thêm mới thì dữ liệu đã xoá sẽ sống
 *    lại sau khi khôi phục. Dùng phép so hai túi (có đếm số lần lặp) nên hai
 *    dòng trùng nhau y hệt vẫn được giữ đủ.
 * 3. **File niêm phải phát hiện được hỏng.** Dùng AES-256-GCM: sai mật khẩu
 *    hay sửa một byte đều ném lỗi, không bao giờ trả về dữ liệu nửa vời.
 *
 * ⚠️ Nội dung sao lưu là PII thật (tên, email, số điện thoại, số tài khoản,
 * hash mật khẩu). Không bao giờ ghi bản chưa niêm xuống đĩa, không in ra log.
 */

import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const MAGIC = Buffer.from("FWBB1");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Một dòng thành chuỗi chuẩn, có ghi kèm kiểu.
 *
 * Ghi kiểu là cố ý: nếu chỉ ghi giá trị thì `null`, `""` và `0` dễ lẫn vào
 * nhau sau một vòng JSON, mà lẫn ở bảng tiền là sai số dư thật.
 */
function lineOf(row) {
  const keys = Object.keys(row).sort();
  return JSON.stringify(
    keys.map((k) => {
      const v = row[k];
      if (typeof v === "bigint") return [k, "bigint", v.toString()];
      if (v instanceof Uint8Array) return [k, "blob", Buffer.from(v).toString("hex")];
      return [k, typeof v, v];
    }),
  );
}

/** Ngược của `lineOf`. */
function rowOf(line) {
  const out = {};
  for (const [k, t, v] of JSON.parse(line)) {
    if (t === "bigint") out[k] = Number(v);
    else if (t === "blob") out[k] = Uint8Array.from(Buffer.from(v, "hex"));
    else out[k] = v;
  }
  return out;
}

/** `{bảng: [dòng]}` thành `{bảng: [chuỗi chuẩn đã sắp xếp]}`. */
export function canonicalTables(tables) {
  const out = {};
  for (const [name, rows] of Object.entries(tables)) {
    out[name] = rows.map(lineOf).sort();
  }
  return out;
}

/** Ngược của `canonicalTables`. */
export function restoreTables(canon) {
  const out = {};
  for (const [name, lines] of Object.entries(canon)) {
    out[name] = lines.map(rowOf);
  }
  return out;
}

/**
 * Vân tay nội dung của một bản chụp.
 *
 * CỐ Ý bỏ qua `meta`: hai lần chụp cùng một dữ liệu ở hai thời điểm khác nhau
 * phải ra cùng một vân tay, nếu không thì ngày nào cũng ghi một bản đầy đủ
 * mới dù chẳng có gì đổi.
 */
export function snapshotHash(snapshot) {
  const canon = canonicalTables(snapshot.tables);
  const h = createHash("sha256");
  for (const name of Object.keys(canon).sort()) {
    h.update(name).update("\u0000");
    for (const line of canon[name]) h.update(line).update("\u0001");
    h.update("\u0002");
  }
  return h.digest("hex");
}

/** Đếm số lần xuất hiện của từng chuỗi, để so hai túi chứ không phải hai tập. */
function counts(lines) {
  const m = new Map();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

/**
 * Phần chênh giữa hai bản chụp.
 *
 * Ghi CẢ dòng thêm lẫn dòng bớt. Thiếu phần bớt là dữ liệu đã xoá sống lại
 * sau khi khôi phục, và đó là kiểu hỏng không ai phát hiện ra sớm.
 */
export function diffSnapshots(base, next) {
  const a = canonicalTables(base.tables);
  const b = canonicalTables(next.tables);
  const tables = {};
  let changedTables = 0;

  for (const name of Object.keys(b)) {
    const ca = counts(a[name] ?? []);
    const cb = counts(b[name]);
    const add = [];
    const del = [];
    for (const [line, n] of cb) {
      const d = n - (ca.get(line) ?? 0);
      if (d > 0) add.push([line, d]);
    }
    for (const [line, n] of ca) {
      const d = n - (cb.get(line) ?? 0);
      if (d > 0) del.push([line, d]);
    }
    // Bảng MỚI phải ghi vào patch kể cả khi còn rỗng: không có dòng nào thêm
    // hay bớt, nhưng sự tồn tại của bảng chính là thay đổi. Bỏ qua thì bản
    // dựng lại thiếu hẳn một bảng, và bảng rỗng hôm nay là bảng có dữ liệu
    // ngày mai. Dính thật trên prod ngày 03/11/2026, bảng `venues`.
    const laBangMoi = !(name in a);
    if (add.length || del.length || laBangMoi) {
      tables[name] = { add, del };
      changedTables += 1;
    }
  }

  const dropped = Object.keys(a).filter((n) => !(n in b));
  changedTables += dropped.length;

  return {
    kind: "patch",
    baseHash: snapshotHash(base),
    hash: snapshotHash(next),
    meta: next.meta,
    tables,
    dropped,
    changedTables,
  };
}

/** Áp một phần chênh lên bản gốc của nó. */
export function applyPatch(base, patch) {
  const got = snapshotHash(base);
  if (got !== patch.baseHash) {
    throw new Error(
      `Patch này bám vào bản gốc khác (patch chờ ${patch.baseHash.slice(0, 12)}, đang có ${got.slice(0, 12)}). Dừng để khỏi dựng ra dữ liệu lai.`,
    );
  }

  const canon = canonicalTables(base.tables);
  for (const name of patch.dropped) delete canon[name];

  for (const [name, { add, del }] of Object.entries(patch.tables)) {
    const c = counts(canon[name] ?? []);
    for (const [line, n] of del) {
      const left = (c.get(line) ?? 0) - n;
      if (left > 0) c.set(line, left);
      else c.delete(line);
    }
    for (const [line, n] of add) c.set(line, (c.get(line) ?? 0) + n);
    const lines = [];
    for (const [line, n] of c) for (let i = 0; i < n; i++) lines.push(line);
    canon[name] = lines.sort();
  }

  const out = { meta: patch.meta, tables: restoreTables(canon) };
  const after = snapshotHash(out);
  if (after !== patch.hash) {
    throw new Error(
      `Dựng lại xong mà vân tay không khớp (chờ ${patch.hash.slice(0, 12)}, ra ${after.slice(0, 12)}). Bản sao lưu này KHÔNG dùng được.`,
    );
  }
  return out;
}

/**
 * Nén rồi niêm phong bằng AES-256-GCM.
 *
 * Mỗi lần niêm dùng muối và IV mới, nên cùng dữ liệu vẫn ra file khác nhau.
 * Đó là chủ ý: hai file giống hệt nhau sẽ để lộ "hôm nay không có gì đổi".
 */
export function seal(obj, passphrase) {
  if (!passphrase) throw new Error("Thiếu mật khẩu để niêm bản sao lưu.");
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(obj), "utf8"))), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}

/** Mở niêm. Sai mật khẩu hoặc file bị sửa đều ném lỗi. */
export function unseal(buf, passphrase) {
  if (!passphrase) throw new Error("Thiếu mật khẩu để mở bản sao lưu.");
  if (buf.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Không phải file sao lưu của FWBB, hoặc đã hỏng.");
  }
  let p = MAGIC.length;
  const salt = buf.subarray(p, (p += SALT_LEN));
  const iv = buf.subarray(p, (p += IV_LEN));
  const tag = buf.subarray(p, (p += TAG_LEN));
  const d = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(buf.subarray(p)), d.final()]);
  return JSON.parse(gunzipSync(plain).toString("utf8"));
}

/**
 * Chọn bản đầy đủ gần nhất rồi nối các patch theo thứ tự để dựng lại.
 *
 * Thà ném lỗi còn hơn dựng thiếu: một bản khôi phục thiếu vài ngày mà không
 * báo gì là thứ chỉ phát hiện ra khi đã dùng nó để ghi đè dữ liệu thật.
 */
export function pickBaseAndChain(files, upto = null) {
  const inRange = files
    .filter((f) => !upto || f.takenAt <= upto)
    .sort((x, y) => (x.takenAt < y.takenAt ? -1 : x.takenAt > y.takenAt ? 1 : 0));

  let baseIdx = -1;
  for (let i = inRange.length - 1; i >= 0; i--) {
    if (inRange[i].kind === "full") {
      baseIdx = i;
      break;
    }
  }
  if (baseIdx === -1) throw new Error("Không tìm thấy bản sao lưu đầy đủ nào để làm gốc.");

  const chain = [inRange[baseIdx]];
  let want = inRange[baseIdx].hash;
  for (let i = baseIdx + 1; i < inRange.length; i++) {
    const f = inRange[i];
    if (f.kind !== "patch") continue;
    if (f.baseHash !== want) {
      throw new Error(
        `Chuỗi sao lưu bị đứt ở ${f.name}: nó bám vào ${String(f.baseHash).slice(0, 12)} nhưng bản trước là ${String(want).slice(0, 12)}. Thiếu mất một bản ở giữa.`,
      );
    }
    chain.push(f);
    want = f.hash;
  }
  return chain;
}

/**
 * Những file cần chép sang chỗ thứ hai (ổ ngoài, thư mục đồng bộ đám mây).
 *
 * Hai điều cố ý:
 *
 * 1. **So cả KÍCH THƯỚC, không chỉ tên.** Một file chép dở dang trông y hệt
 *    file đủ nếu chỉ nhìn tên, và nó sẽ ngồi đó im lặng tới đúng hôm cần.
 * 2. **Không bao giờ trả về lệnh xoá.** Nguồn dọn bản cũ đi thì chỗ thứ hai
 *    vẫn giữ. Chỗ thứ hai tồn tại cho tình huống nguồn đã mất, nên để nó cắt
 *    theo nguồn là bỏ đi phần lớn giá trị của nó.
 */
export function planMirror(indexFiles, atMirror = {}) {
  return [...indexFiles]
    .sort((x, y) => (x.takenAt < y.takenAt ? -1 : x.takenAt > y.takenAt ? 1 : 0))
    .filter((f) => atMirror[f.name] !== f.bytes)
    .map((f) => f.name);
}
