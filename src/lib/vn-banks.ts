/**
 * Danh sach ngan hang Viet Nam kem ma BIN, dung cho dropdown chon ngan hang
 * nhan tien o trang Cai dat va cho viec dung anh VietQR.
 *
 * Vi sao snapshot tinh thay vi goi API luc chay: danh sach nay gan nhu khong
 * doi, con app thi chay nhieu trong webview Zalo/Messenger. Phu thuoc mot API
 * ben ngoai de render noi cai dropdown la tu them mot diem chet. Nguon:
 * https://api.vietqr.io/v2/banks (API cong khai, khong can khoa), lay ve
 * 5/8/2026. Muon cap nhat thi fetch lai roi sinh lai file nay.
 *
 * `transferSupported` = ngan hang co nhan chuyen khoan qua VietQR. Ngan hang
 * khong ho tro van giu trong danh sach de tra ma BIN cu, nhung UI nen loc bo.
 */
export interface VnBank {
  /** Ma BIN 6 so, thu VietQR can de dung anh QR. */
  bin: string;
  /** Ma ngan theo chuan Napas, vi du VCB, ICB. */
  code: string;
  /** Ten thuong hieu, thu hien thi cho nguoi dung. */
  shortName: string;
  /** Ten phap ly day du. */
  name: string;
  transferSupported: boolean;
}

/** Sap theo ten thuong hieu de dropdown khoi phai sort lai luc chay. */
export const VN_BANKS: readonly VnBank[] = [
  {
    bin: "970425",
    code: "ABB",
    shortName: "ABBANK",
    name: "Ngân hàng TMCP An Bình",
    transferSupported: true,
  },
  {
    bin: "970416",
    code: "ACB",
    shortName: "ACB",
    name: "Ngân hàng TMCP Á Châu",
    transferSupported: true,
  },
  {
    bin: "970405",
    code: "VBA",
    shortName: "Agribank",
    name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam",
    transferSupported: true,
  },
  {
    bin: "970409",
    code: "BAB",
    shortName: "BacABank",
    name: "Ngân hàng TMCP Bắc Á",
    transferSupported: true,
  },
  {
    bin: "970438",
    code: "BVB",
    shortName: "BaoVietBank",
    name: "Ngân hàng TMCP Bảo Việt",
    transferSupported: true,
  },
  {
    bin: "970418",
    code: "BIDV",
    shortName: "BIDV",
    name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam",
    transferSupported: true,
  },
  {
    bin: "546034",
    code: "CAKE",
    shortName: "CAKE",
    name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số CAKE by VPBank",
    transferSupported: true,
  },
  {
    bin: "970444",
    code: "CBB",
    shortName: "CBBank",
    name: "Ngân hàng Thương mại TNHH MTV Xây dựng Việt Nam",
    transferSupported: false,
  },
  {
    bin: "422589",
    code: "CIMB",
    shortName: "CIMB",
    name: "Ngân hàng TNHH MTV CIMB Việt Nam",
    transferSupported: true,
  },
  {
    bin: "533948",
    code: "CITIBANK",
    shortName: "Citibank",
    name: "Ngân hàng Citibank, N.A. - Chi nhánh Hà Nội",
    transferSupported: false,
  },
  {
    bin: "970446",
    code: "COOPBANK",
    shortName: "COOPBANK",
    name: "Ngân hàng Hợp tác xã Việt Nam",
    transferSupported: true,
  },
  {
    bin: "796500",
    code: "DBS",
    shortName: "DBSBank",
    name: "DBS Bank Ltd - Chi nhánh Thành phố Hồ Chí Minh",
    transferSupported: false,
  },
  {
    bin: "970431",
    code: "EIB",
    shortName: "Eximbank",
    name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam",
    transferSupported: true,
  },
  {
    bin: "970408",
    code: "GPB",
    shortName: "GPBank",
    name: "Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu",
    transferSupported: false,
  },
  {
    bin: "970437",
    code: "HDB",
    shortName: "HDBank",
    name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh",
    transferSupported: true,
  },
  {
    bin: "970442",
    code: "HLBVN",
    shortName: "HongLeong",
    name: "Ngân hàng TNHH MTV Hong Leong Việt Nam",
    transferSupported: false,
  },
  {
    bin: "458761",
    code: "HSBC",
    shortName: "HSBC",
    name: "Ngân hàng TNHH MTV HSBC (Việt Nam)",
    transferSupported: false,
  },
  {
    bin: "970456",
    code: "IBK - HCM",
    shortName: "IBKHCM",
    name: "Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh TP. Hồ Chí Minh",
    transferSupported: false,
  },
  {
    bin: "970455",
    code: "IBK - HN",
    shortName: "IBKHN",
    name: "Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh Hà Nội",
    transferSupported: false,
  },
  {
    bin: "970434",
    code: "IVB",
    shortName: "IndovinaBank",
    name: "Ngân hàng TNHH Indovina",
    transferSupported: false,
  },
  {
    bin: "668888",
    code: "KBank",
    shortName: "KBank",
    name: "Ngân hàng Đại chúng TNHH Kasikornbank",
    transferSupported: true,
  },
  {
    bin: "970466",
    code: "KEBHANAHCM",
    shortName: "KEBHanaHCM",
    name: "Ngân hàng KEB Hana – Chi nhánh Thành phố Hồ Chí Minh",
    transferSupported: false,
  },
  {
    bin: "970467",
    code: "KEBHANAHN",
    shortName: "KEBHANAHN",
    name: "Ngân hàng KEB Hana – Chi nhánh Hà Nội",
    transferSupported: false,
  },
  {
    bin: "970452",
    code: "KLB",
    shortName: "KienLongBank",
    name: "Ngân hàng TMCP Kiên Long",
    transferSupported: true,
  },
  {
    bin: "970463",
    code: "KBHCM",
    shortName: "KookminHCM",
    name: "Ngân hàng Kookmin - Chi nhánh Thành phố Hồ Chí Minh",
    transferSupported: false,
  },
  {
    bin: "970462",
    code: "KBHN",
    shortName: "KookminHN",
    name: "Ngân hàng Kookmin - Chi nhánh Hà Nội",
    transferSupported: false,
  },
  {
    bin: "970449",
    code: "LPB",
    shortName: "LPBank",
    name: "Ngân hàng TMCP Lộc Phát Việt Nam",
    transferSupported: true,
  },
  {
    bin: "977777",
    code: "MAFC",
    shortName: "MAFC",
    name: "Công ty Tài chính TNHH MTV Mirae Asset (Việt Nam) ",
    transferSupported: false,
  },
  {
    bin: "970422",
    code: "MB",
    shortName: "MBBank",
    name: "Ngân hàng TMCP Quân đội",
    transferSupported: true,
  },
  {
    bin: "970414",
    code: "MBV",
    shortName: "MBV",
    name: "Ngân hàng TNHH MTV Việt Nam Hiện Đại",
    transferSupported: true,
  },
  {
    bin: "971025",
    code: "momo",
    shortName: "MoMo",
    name: "CTCP Dịch Vụ Di Động Trực Tuyến",
    transferSupported: true,
  },
  {
    bin: "970426",
    code: "MSB",
    shortName: "MSB",
    name: "Ngân hàng TMCP Hàng Hải Việt Nam",
    transferSupported: true,
  },
  {
    bin: "970428",
    code: "NAB",
    shortName: "NamABank",
    name: "Ngân hàng TMCP Nam Á",
    transferSupported: true,
  },
  {
    bin: "970419",
    code: "NCB",
    shortName: "NCB",
    name: "Ngân hàng TMCP Quốc Dân",
    transferSupported: true,
  },
  {
    bin: "801011",
    code: "NHB HN",
    shortName: "Nonghyup",
    name: "Ngân hàng Nonghyup - Chi nhánh Hà Nội",
    transferSupported: false,
  },
  {
    bin: "970448",
    code: "OCB",
    shortName: "OCB",
    name: "Ngân hàng TMCP Phương Đông",
    transferSupported: true,
  },
  {
    bin: "970430",
    code: "PGB",
    shortName: "PGBank",
    name: "Ngân hàng TMCP Thịnh vượng và Phát triển",
    transferSupported: true,
  },
  {
    bin: "970439",
    code: "PBVN",
    shortName: "PublicBank",
    name: "Ngân hàng TNHH MTV Public Việt Nam",
    transferSupported: false,
  },
  {
    bin: "970412",
    code: "PVCB",
    shortName: "PVcomBank",
    name: "Ngân hàng TMCP Đại Chúng Việt Nam",
    transferSupported: true,
  },
  {
    bin: "971133",
    code: "PVDB",
    shortName: "PVcomBank Pay",
    name: "Ngân hàng TMCP Đại Chúng Việt Nam Ngân hàng số",
    transferSupported: true,
  },
  {
    bin: "970403",
    code: "STB",
    shortName: "Sacombank",
    name: "Ngân hàng TMCP Sài Gòn Thương Tín",
    transferSupported: true,
  },
  {
    bin: "970400",
    code: "SGICB",
    shortName: "SaigonBank",
    name: "Ngân hàng TMCP Sài Gòn Công Thương",
    transferSupported: true,
  },
  {
    bin: "970429",
    code: "SCB",
    shortName: "SCB",
    name: "Ngân hàng TMCP Sài Gòn",
    transferSupported: true,
  },
  {
    bin: "970440",
    code: "SEAB",
    shortName: "SeABank",
    name: "Ngân hàng TMCP Đông Nam Á",
    transferSupported: true,
  },
  {
    bin: "970443",
    code: "SHB",
    shortName: "SHB",
    name: "Ngân hàng TMCP Sài Gòn - Hà Nội",
    transferSupported: true,
  },
  {
    bin: "970424",
    code: "SHBVN",
    shortName: "ShinhanBank",
    name: "Ngân hàng TNHH MTV Shinhan Việt Nam",
    transferSupported: true,
  },
  {
    bin: "970410",
    code: "SCVN",
    shortName: "StandardChartered",
    name: "Ngân hàng TNHH MTV Standard Chartered Bank Việt Nam",
    transferSupported: false,
  },
  {
    bin: "970407",
    code: "TCB",
    shortName: "Techcombank",
    name: "Ngân hàng TMCP Kỹ thương Việt Nam",
    transferSupported: true,
  },
  {
    bin: "963388",
    code: "TIMO",
    shortName: "Timo",
    name: "Ngân hàng số Timo by Ban Viet Bank (Timo by Ban Viet Bank)",
    transferSupported: true,
  },
  {
    bin: "970423",
    code: "TPB",
    shortName: "TPBank",
    name: "Ngân hàng TMCP Tiên Phong",
    transferSupported: true,
  },
  {
    bin: "546035",
    code: "Ubank",
    shortName: "Ubank",
    name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số Ubank by VPBank",
    transferSupported: true,
  },
  {
    bin: "970458",
    code: "UOB",
    shortName: "UnitedOverseas",
    name: "Ngân hàng United Overseas - Chi nhánh TP. Hồ Chí Minh",
    transferSupported: false,
  },
  {
    bin: "999888",
    code: "VBSP",
    shortName: "VBSP",
    name: "Ngân hàng Chính sách Xã hội",
    transferSupported: false,
  },
  {
    bin: "970441",
    code: "VIB",
    shortName: "VIB",
    name: "Ngân hàng TMCP Quốc tế Việt Nam",
    transferSupported: true,
  },
  {
    bin: "970427",
    code: "VAB",
    shortName: "VietABank",
    name: "Ngân hàng TMCP Việt Á",
    transferSupported: true,
  },
  {
    bin: "970433",
    code: "VIETBANK",
    shortName: "VietBank",
    name: "Ngân hàng TMCP Việt Nam Thương Tín",
    transferSupported: true,
  },
  {
    bin: "970454",
    code: "VCCB",
    shortName: "VietCapitalBank",
    name: "Ngân hàng TMCP Bản Việt",
    transferSupported: true,
  },
  {
    bin: "970436",
    code: "VCB",
    shortName: "Vietcombank",
    name: "Ngân hàng TMCP Ngoại Thương Việt Nam",
    transferSupported: true,
  },
  {
    bin: "970415",
    code: "ICB",
    shortName: "VietinBank",
    name: "Ngân hàng TMCP Công thương Việt Nam",
    transferSupported: true,
  },
  {
    bin: "971005",
    code: "VTLMONEY",
    shortName: "ViettelMoney",
    name: "Tổng Công ty Dịch vụ số Viettel - Chi nhánh tập đoàn công nghiệp viễn thông Quân Đội",
    transferSupported: false,
  },
  {
    bin: "970406",
    code: "Vikki",
    shortName: "Vikki",
    name: "Ngân hàng TNHH MTV Số Vikki",
    transferSupported: false,
  },
  {
    bin: "971011",
    code: "VNPTMONEY",
    shortName: "VNPTMoney",
    name: "VNPT Money",
    transferSupported: false,
  },
  {
    bin: "970432",
    code: "VPB",
    shortName: "VPBank",
    name: "Ngân hàng TMCP Việt Nam Thịnh Vượng",
    transferSupported: true,
  },
  {
    bin: "970421",
    code: "VRB",
    shortName: "VRB",
    name: "Ngân hàng Liên doanh Việt - Nga",
    transferSupported: false,
  },
  {
    bin: "970457",
    code: "WVN",
    shortName: "Woori",
    name: "Ngân hàng TNHH MTV Woori Việt Nam",
    transferSupported: true,
  },
] as const;

/** Tra ngan hang theo ma BIN. Tra undefined neu BIN khong co trong danh sach. */
export function findBankByBin(bin: string): VnBank | undefined {
  return VN_BANKS.find((b) => b.bin === bin);
}
