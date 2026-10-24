# 實驗紀錄（Experiment log）

這裡記錄排哨演算法的每一次驗證、測試與模擬，**不論結果好壞**。
失敗的實驗、被否決的方案與已知的限制同樣重要：它們說明了「為什麼現在的設計是這樣」。

## 索引

| 編號 | 標題 | 結果 | 對應 commit |
| --- | --- | --- | --- |
| [EXP-001](EXP-001-gray-fairness.md) | 灰色時段公平值 | ✅ 採用 | `2538f66` |
| [EXP-002](EXP-002-jitter-unit.md) | Jitter 單位修正 | ✅ 採用 | `86ef9cc` |
| [EXP-003](EXP-003-manpower-thresholds.md) | 建議人力門檻 | ✅ 採用（加入提醒） | `86ef9cc` |
| [EXP-004](EXP-004-statistical-validation.md) | 以統計檢定驗證公平性（對照組） | ✅ 驗證通過，🔍 哨長負擔略高 < 2% | 見 git log |

## 相關檔案

- [`../simulation-report.md`](../simulation-report.md)：最新的完整模擬報告（自動產生，每次執行會覆蓋）
- [`results/`](results/)：各實驗的原始輸出（自動產生）
- [`../../scripts/simulate.ts`](../../scripts/simulate.ts)：情境定義、獨立 checker、月結算
- [`../../scripts/stats.ts`](../../scripts/stats.ts)：統計函式

## 撰寫規則

1. 檔名為 `EXP-<三位數編號>-<英文短名>.md`，編號只增不減，**不刪除舊實驗**。
2. 結論被後續實驗推翻時，不修改原文，在檔案最上方加上「⚠️ 已被 EXP-xxx 取代」。
3. 數據一律來自可重現的指令，並寫明 seed 數與 commit。
4. 結果欄位：✅ 採用、❌ 否決、⚠️ 部分採用、🔍 僅觀察（記錄限制，未修改程式）。

## 範本

```markdown
# EXP-xxx：標題

- **日期：** YYYY-MM-DD
- **結果：** ✅ 採用 / ❌ 否決 / ⚠️ 部分採用 / 🔍 僅觀察
- **對應 commit：** `abcdef0`

## 動機
觀察到什麼現象，為什麼值得研究。

## 假設（Hypothesis）
可被數據證明或推翻的具體敘述。

## 方法（Method）
情境、seed 數、比較的版本、使用的指標與統計檢定。附上可重現的指令。

## 結果（Results）
數據表格。不只放支持假設的數據。

## 結論與後續
是否採用、取捨（trade-off）、仍未解決的問題。
```
