# FWBB — API Security Checklist

> Tự sinh từ đợt audit per-endpoint (adversarial + skeptic-verify). **132 endpoint** (server actions + API routes + inline action).
> **Kết quả: 0 risk còn mở.** Mọi endpoint đổi-state đều có auth gate; money write có idempotencyKey + Zod + recompute server-side; public read whitelist cột (không lộ PII).

**Cột:** Gate = auth thực thi trước khi đọc/ghi · Valid = validate input (Zod/guard) · IDOR = chặn truy cập chéo (id từ cookie/owner-check) · RL = rate-limit · PII = trả PII ra client.
**Ký hiệu:** ✅ có · ❌ thiếu · ◑ một phần · — không áp dụng · ⚠️ có PII (đã gate admin).

## 🔐 Admin-only (requireAdmin) — 92

| Endpoint                             | Gate | Valid | IDOR | RL  | PII | Verdict |
| ------------------------------------ | :--: | :---: | :--: | :-: | :-: | :-----: |
| `selectCourt`                        |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `confirmSession`                     |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `cancelSession`                      |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `reopenSession`                      |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `unlockSession`                      |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `deleteSession`                      |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `createSessionManually`              |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `addSessionShuttlecocks`             |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `removeSessionShuttlecock`           |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `setSessionCourtPriceOverride`       |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `setSessionShuttlecockPriceOverride` |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `setAdminGuestCount`                 |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `setSessionUseMinDeduction`          |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `setMemberMinDeductionExempt`        |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `getSessionExemptions`               |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `setVoteDeadline`                    |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `extendVoteDeadline`                 |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `recordContribution`                 |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `recordRefund`                       |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `getFundMembers`                     |  ✅  |   —   |  —   |  —  | ⚠️  |  ✅ OK  |
| `getFundMembersWithBalances`         |  ✅  |   —   |  —   |  —  | ⚠️  |  ✅ OK  |
| `getAllFundTransactions`             |  ✅  |   —   |  —   |  —  | ⚠️  |  ✅ OK  |
| `getRecentFinancialTransactions`     |  ✅  |   —   |  —   |  —  | ⚠️  |  ✅ OK  |
| `reverseFinancialTransaction`        |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `getFundOverview`                    |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getFundYearlyReport`                |  ✅  |   ◑   |  —   |  —  | ⚠️  |  ✅ OK  |
| `getFundReportYears`                 |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getPendingFundClaims`               |  ✅  |   ◑   |  —   |  —  | ⚠️  |  ✅ OK  |
| `confirmFundClaim`                   |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `getSessionFinanceReport`            |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `updateMemberBankAccount`            |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `autoApplyFundToDebts`               |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `mergeLegacyDebtsIntoFund`           |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `reconcileFund`                      |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `finalizeSession`                    |  ✅  |  ✅   |  ✅  |  —  |  —  |  ✅ OK  |
| `finalizeSessionAuto`                |  ✅  |  ✅   |  ✅  |  —  |  —  |  ✅ OK  |
| `confirmPaymentByAdmin`              |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `undoPaymentByAdmin`                 |  ✅  |  ✅   |  ✅  | ❌  |  —  |  ✅ OK  |
| `getAllDebts`                        |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getMemberFinanceOverview`           |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getDebtSummary`                     |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getBankTransactions`                |  ✅  |   —   |  —   |  —  | ⚠️  |  ✅ OK  |
| `getSystemTransactions`              |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getCourtRentReport`                 |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `getCourtRentPayments`               |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `recordCourtRentPayment`             |  ✅  |  ✅   |  ✅  |  —  |  —  |  ✅ OK  |
| `deleteCourtRentPayment`             |  ✅  |   ◑   |  ✅  |  —  |  —  |  ✅ OK  |
| `getCourtRentYears`                  |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getMembers`                         |  ✅  |   —   |  —   |  —  | ⚠️  |  ✅ OK  |
| `createMember`                       |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `updateMember`                       |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `getCurrentAdminMemberId`            |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `linkAdminToMember`                  |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `toggleMemberActive`                 |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `deleteMember`                       |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `findDuplicateMembers`               |  ✅  |   —   |  —   |  —  | ⚠️  |  ✅ OK  |
| `mergeMember`                        |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `getNameMatches`                     |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `approveMember`                      |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `rejectMember`                       |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `approveAndMergeMember`              |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `mergeMember (re-export)`            |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `adminSetVote`                       |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `adminSetGuestCount`                 |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `adminRemoveVote`                    |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `setDefaultCourt`                    |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `setDefaultBrand`                    |  ✅  |   ◑   |  —   |  —  |  —  |  ✅ OK  |
| `setSessionDaysOfWeek`               |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `updateAppName`                      |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |
| `recordPurchase`                     |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `updatePurchaseTubes`                |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `setStockQua`                        |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `getStockByBrand`                    |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getPurchaseHistory`                 |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getUsageHistory`                    |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `checkLowStock`                      |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getBrands`                          |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getActiveBrands`                    |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `createBrand`                        |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `updateBrand`                        |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `toggleBrandActive`                  |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `deleteBrand`                        |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `getCourts`                          |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getActiveCourts`                    |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `createCourt`                        |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `updateCourt`                        |  ✅  |  ✅   |  —   | ❌  |  —  |  ✅ OK  |
| `toggleCourtActive`                  |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `deleteCourt`                        |  ✅  |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `getShuttlecockFinanceSummary`       |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getPurchaseHistory`                 |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getUsageHistory`                    |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `changePassword`                     |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |

## 👤 Member / owner-scoped (cookie) — 12

| Endpoint                       | Gate | Valid | IDOR | RL  | PII | Verdict |
| ------------------------------ | :--: | :---: | :--: | :-: | :-: | :-----: |
| `getFundTransactionsForMember` |  ✅  |   —   |  ✅  |  —  |  —  |  ✅ OK  |
| `claimFundContribution`        |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `confirmPaymentByMember`       |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `getDebtsForMember`            |  ✅  |   ◑   |  ✅  | ❌  |  —  |  ✅ OK  |
| `checkPaymentForMemo`          |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `checkPaymentForDebt`          |  ✅  |   ◑   |  ✅  | ✅  |  —  |  ✅ OK  |
| `updateMyAvatar`               |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `updateMyProfile`              |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `updatePendingProfile`         |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `submitVote`                   |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |
| `getMonthlyExpenses`           |  ◑   |   ◑   |  ✅  | ❌  |  —  |  ✅ OK  |
| `setPassword`                  |  ✅  |  ✅   |  ✅  | ✅  |  —  |  ✅ OK  |

## 🤖 Webhook / cron (shared secret) — 3

| Endpoint                          | Gate | Valid | IDOR | RL  | PII | Verdict |
| --------------------------------- | :--: | :---: | :--: | :-: | :-: | :-----: |
| `GET /api/cron/create-session`    |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `GET /api/cron/renew-gmail-watch` |  ✅  |   —   |  —   |  —  |  —  |  ✅ OK  |
| `POST /api/webhooks/gmail`        |  ✅  |  ✅   |  —   |  —  |  —  |  ✅ OK  |

## 🌐 Public-by-design (read / auth entry) — 25

| Endpoint                                   | Gate | Valid | IDOR | RL  | PII | Verdict |
| ------------------------------------------ | :--: | :---: | :--: | :-: | :-: | :-----: |
| `getSessions`                              |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getSession`                               |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getWeekBadmintonDays`                     |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getNextSession`                           |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getAdminUpcomingSession`                  |  ❌  |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getLatestCompletedSession`                |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `getActiveMembers`                         |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `pendingLogout`                            |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getSessionVotes`                          |  —   |   —   |  ✅  | ❌  |  —  |  ✅ OK  |
| `getAppName`                               |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getDefaultCourt`                          |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getDefaultBrand`                          |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getSessionDaysOfWeek`                     |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getActiveMembersStats`                    |  —   |   ◑   |  —   | ❌  |  —  |  ✅ OK  |
| `getAttendanceTrend`                       |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `getAvailableYears`                        |  —   |   —   |  —   | ❌  |  —  |  ✅ OK  |
| `login`                                    |  —   |  ✅   |  —   | ✅  |  —  |  ✅ OK  |
| `logout`                                   |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `signupWithPassword`                       |  —   |  ✅   |  —   | ✅  |  —  |  ✅ OK  |
| `loginWithPassword`                        |  —   |  ✅   |  —   | ✅  |  —  |  ✅ OK  |
| `facebookLogin`                            |  —   |  ✅   |  —   | ✅  |  —  |  ✅ OK  |
| `resetIdentity`                            |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `googleLogin`                              |  —   |  ✅   |  —   | ✅  |  —  |  ✅ OK  |
| `POST /api/reset-identity`                 |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |
| `(public)/layout.tsx inline logout action` |  —   |   —   |  —   |  —  |  —  |  ✅ OK  |

## ⚠️ Rủi ro còn lại (đã chấp nhận — không phải lỗ khai thác trong code)

- **DDoS thể tích (L3/4):** việc của hạ tầng — đặt **Cloudflare** trước domain (Vercel chỉ chống cơ bản). Code không tự chống được.
- **CSP** chưa bật — cần chạy Report-Only tune cho Google Identity + Facebook SDK rồi mới enforce.
- **Admin pages** dựa vào proxy gate (`src/proxy.ts`, đã verify fail-closed) thay vì requireAdmin từng page — thêm redirect ở layout sẽ loop /admin/login.
- **payment-status** dùng `LIKE '%memo%'` (bảng nhỏ; left-anchor rủi ro vỡ match memo ngân hàng).

_Sinh tự động — chạy lại: `node scripts/gen-security-checklist.mjs <audit.json>`._
