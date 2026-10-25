# 實驗紀錄（Experiment log）

這裡記錄排哨演算法的每一次驗證、測試與模擬，**不論結果好壞**。
失敗的實驗、被否決的方案與已知的限制同樣重要：它們說明了「為什麼現在的設計是這樣」。

## 索引

每個實驗都有四份材料：**紀錄**（動機、假設、結論）、**notebook**（分析過程與圖表）、**原始數據**、**產生數據的程式碼**。

| 編號 | 標題 | 結果 | 紀錄 | Notebook | 原始數據 | 程式碼 |
| --- | --- | --- | --- | --- | --- | --- |
| EXP-001 | 灰色時段公平值 | ✅ 採用 | [md](EXP-001-gray-fairness.md) | [ipynb](EXP-001-gray-fairness.ipynb) | [data](data/exp-001/) | [ts](../../scripts/experiments/exp-001-gray-fairness.ts) |
| EXP-002 | Jitter 單位修正 | ✅ 採用 | [md](EXP-002-jitter-unit.md) | [ipynb](EXP-002-jitter-unit.ipynb) | [data](data/exp-002/) | [ts](../../scripts/experiments/exp-002-jitter-unit.ts) |
| EXP-003 | 建議人力門檻 | ✅ 採用（加入提醒） | [md](EXP-003-manpower-thresholds.md) | [ipynb](EXP-003-manpower-thresholds.ipynb) | [data](data/exp-003/) | [ts](../../scripts/experiments/exp-003-manpower-thresholds.ts) |
| EXP-004 | 以統計檢定驗證公平性（對照組） | ✅ 驗證通過，🔍 哨長負擔略高 < 2% | [md](EXP-004-statistical-validation.md) | [ipynb](EXP-004-statistical-validation.ipynb) | [data](data/exp-004/) | [ts](../../scripts/experiments/exp-004-statistical-validation.ts) |

建議閱讀順序：先看 **notebook**（GitHub 可直接顯示圖表）；想知道為什麼做、最後怎麼決定，再看**紀錄**。

## 分工：為什麼模擬用 TypeScript、分析用 Python

| 步驟 | 工具 | 理由 |
| --- | --- | --- |
| 產生數據 | TypeScript 腳本（[`scripts/experiments/`](../../scripts/experiments/)） | 直接使用網站上的 [`lib/scheduler.ts`](../../lib/scheduler.ts)，測的是真正上線的程式碼，而不是另寫的副本 |
| 分析與圖表 | Python notebook（`numpy`、`scipy`、`matplotlib`） | 用另一套獨立的工具重算統計量，與 TypeScript 的結果交叉驗證 |
| 自動檢查 | GitHub Actions | 每次修改都確認數據可重現、notebook 能正常執行 |

這種「換一套工具重算」的做法曾經抓到 [`scripts/stats.ts`](../../scripts/stats.ts) 的一個 bug（見 EXP-004）。

## 重現實驗（Reproducibility）

所有亂數皆由 seed 決定，相同的程式碼在任何機器上都會產生位元組完全相同的原始數據。

```bash
# 1. 產生原始數據（以 EXP-001 為例；所有腳本都接受 --seeds N，預設 30）
npm ci
npm run experiment -- scripts/experiments/exp-001-gray-fairness.ts

# 2. 執行 notebook
python -m venv .venv
.venv/Scripts/pip install -r docs/experiments/requirements.txt      # macOS/Linux：.venv/bin/pip
.venv/Scripts/jupyter nbconvert --to notebook --execute --inplace docs/experiments/EXP-001-gray-fairness.ipynb
```

其他檔案：

- [`nbutils.py`](nbutils.py)：notebook 共用的統計函式與圖表樣式。
- [`results/`](results/)：各腳本輸出的摘要表格（Markdown），不需執行 notebook 即可快速查看。
- [`../simulation-report.md`](../simulation-report.md)、[`results/ablation.md`](results/ablation.md)：`npm run simulate` 產生的完整報告。
- [`scripts/sim-core.ts`](../../scripts/sim-core.ts)：共用的情境定義、單月模擬與獨立 checker。

### CI 自動驗證

[Reproduce experiments](../../.github/workflows/reproduce.yml) workflow 在演算法或實驗相關檔案變動時，平行重現四個實驗：

1. 重新執行腳本，輸出**必須與 repo 中的檔案完全相同**，證明數據確實來自目前的程式碼、沒有被手動修改。
2. 執行 notebook。若重算結果與 TypeScript 不一致、或發現任何違規，notebook 中的 `assert` 會讓 CI 失敗。

## 撰寫規則

1. 檔名為 `EXP-<三位數編號>-<英文短名>.md`，編號只增不減，**不刪除舊實驗**。
   同名的 `.ipynb`、`data/exp-<編號>/` 與 `scripts/experiments/exp-<編號>-<英文短名>.ts` 一起提交。
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
