# 營區站哨排班系統

Next.js 15 + Tailwind CSS 4 + Supabase（全部免費方案）。

## 架設步驟

1. **建立 Supabase 專案**（free tier）
   - SQL Editor → 貼上 `supabase/schema.sql` 全文執行
   - Authentication → Users → *Add user*，建立值星／排哨人員的登入帳號
     （Authentication → Sign In / Providers 可關閉 *Allow new users to sign up*，避免外人自行註冊）
2. **本機開發**
   ```bash
   cp .env.local.example .env.local   # 填入 Project URL 與 anon key
   npm install
   npm run dev                         # http://localhost:3000
   ```
3. **部署 Vercel**：匯入此 repo，在 Environment Variables 設定
   `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 即可。

## 目錄

| 路徑 | 說明 |
| --- | --- |
| `supabase/schema.sql` | 資料表、RPC、RLS |
| `lib/scheduler.ts` | **排哨演算法**（純函式：產生、驗證、最低人力檢核） |
| `lib/db.ts` | Supabase 存取 |
| `components/MemberManager.tsx` | 人員名冊 CRUD |
| `components/ScheduleWizard.tsx` | 排哨精靈 Step 1–5、最低人力防呆 |
| `components/RosterEditor.tsx` | 哨表微調、即時違規檢查、公平性檢視 |
| `scripts/test-scheduler.ts` | 30 天模擬測試：`npm run test:scheduler` |

## 資料設計重點

- 「當月上班天數」= `attendance` 該月筆數；「當月站哨節數」= `duty_assignments` 該月筆數。
  不使用 `+1` 計數欄位，所以重複按「生成哨表」或重新儲存都不會重複累加。
- 出勤以「勤務日期」登錄：排 11/2 的哨表時勾選的人，記為 11/2 上班。
- 儲存哨表是單一交易（先刪當天再寫入），可以反覆修改。

## 演算法摘要

- 班次換算成「絕對索引」`天數差 × 12 + 班次`，任兩班差距需 ≥ 4（2 小時哨 + 6 小時休），
  昨天的班次是負數，因此跨日歇哨不需要特例。
- 灰色時段（00–06、12–14）：檢查所有包含當天的三日窗口，任一窗口三天皆灰色即禁止。
- 回溯搜尋 + MRV（候選最少的格子先填），候選人依「排入後的公平值」+ 隨機擾動排序；
  無完整解時改跑多輪貪婪，保留空缺最少的版本並標示原因。

> **注意：8 人只是「必要」門檻，不是「充分」條件。** 剛好 8 人時每人必須每天固定站 3 班
> （0/4/8、1/5/9、2/6/10、3/7/11 四種組合），其中三種含灰色時段，連續多天必然違反
> 「不可連續三天灰色」，所以會出現空缺需人工處理。模擬 30 天的結果：每日約 11 人可動用時一個月僅 1–2 格空缺；約 9 人時約 17 格；8 人全勤約 60 格。
