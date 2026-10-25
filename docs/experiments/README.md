# 實驗紀錄（Experiment log）

這裡記錄排哨演算法的每一次驗證、測試與模擬，**不論結果好壞**。
失敗的實驗、被否決的方案與已知的限制同樣重要：它們說明了「為什麼現在的設計是這樣」。

## 索引

| 編號 | 標題 | 結果 | 對應 commit |
| --- | --- | --- | --- |
| [EXP-001](EXP-001-gray-fairness.md) | 灰色時段公平值 | ✅ 採用 | `2538f66` |
| [EXP-002](EXP-002-jitter-unit.md) | Jitter 單位修正 | ✅ 採用 | `86ef9cc` |
| [EXP-003](EXP-003-manpower-thresholds.md) | 建議人力門檻 | ✅ 採用（加入提醒） | `86ef9cc` |
| [EXP-004](EXP-004-statistical-validation.md) | 以統計檢定驗證公平性（對照組） | ✅ 驗證通過，🔍 哨長負擔略高 < 2% | `510d162` |

## 重現實驗（Reproducibility）

每份報告的數據都能用 repo 中的程式碼重新產生。所有亂數皆由 seed 決定，相同的程式碼在任何機器上都會得到相同的結果。

| 實驗 | 程式碼 | 指令 | 輸出 |
| --- | --- | --- | --- |
| EXP-001 | [`exp-001-gray-fairness.ts`](../../scripts/experiments/exp-001-gray-fairness.ts) | `npm run experiment -- scripts/experiments/exp-001-gray-fairness.ts` | [`results/EXP-001.md`](results/EXP-001.md) |
| EXP-002 | [`exp-002-jitter-unit.ts`](../../scripts/experiments/exp-002-jitter-unit.ts) | `npm run experiment -- scripts/experiments/exp-002-jitter-unit.ts` | [`results/EXP-002.md`](results/EXP-002.md) |
| EXP-003 | [`exp-003-manpower-thresholds.ts`](../../scripts/experiments/exp-003-manpower-thresholds.ts) | `npm run experiment -- scripts/experiments/exp-003-manpower-thresholds.ts` | [`results/EXP-003.md`](results/EXP-003.md) |
| EXP-004 | [`simulate.ts`](../../scripts/simulate.ts) | `npm run simulate`、`npm run simulate -- --ablation` | [`../simulation-report.md`](../simulation-report.md)、[`results/ablation.md`](results/ablation.md) |
| 原始數據 | [`export-data.ts`](../../scripts/export-data.ts) | `npm run export-data` | [`data/`](data/)（CSV） |
| 獨立分析 | [`analysis.ipynb`](analysis.ipynb) | 見 notebook 開頭 | 圖表、與 `scipy` 的交叉驗證 |

所有腳本都接受 `--seeds N`（預設 30）。共用的情境定義、模擬與獨立 checker 在 [`scripts/sim-core.ts`](../../scripts/sim-core.ts)，
統計函式在 [`scripts/stats.ts`](../../scripts/stats.ts)。

### 獨立分析 notebook

[`analysis.ipynb`](analysis.ipynb) 讀取 [`data/`](data/) 中每個 run、每個人的月結算原始數據，用 Python（`numpy`、`scipy`）
**重新計算所有統計量**，不使用專案自己實作的 `stats.ts`，並與 `stats.ts` 的結果逐一比對。GitHub 可以直接顯示已執行的 notebook 與圖表。

```bash
python -m venv .venv
.venv/Scripts/pip install -r docs/experiments/requirements.txt      # macOS/Linux：.venv/bin/pip
.venv/Scripts/jupyter nbconvert --to notebook --execute --inplace docs/experiments/analysis.ipynb
```

### CI 自動驗證

[GitHub Actions](../../.github/workflows/verify.yml) 每次 push 都會：

1. 以 `npm run export-data` 重新產生原始數據，**必須與 repo 中的 CSV 完全相同**，證明數據確實來自目前的程式碼、沒有被手動修改。
2. 執行 notebook。若 `stats.ts` 與 `scipy` 的結果不一致、或發現任何違規，notebook 中的 `assert` 會讓 CI 失敗。

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
