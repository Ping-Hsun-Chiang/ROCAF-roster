/**
 * 情境模擬（Scenario-based simulation）與統計分析
 *
 * 每個情境連續排一個月（30 天），以多個 random seed 重複執行，做「月結算」並以統計檢定評估公平性。
 *
 *   npm run simulate                       完整報告（現行版本 vs 隨機對照組，30 seeds）→ docs/simulation-report.md
 *   npm run simulate -- --check            CI 驗證：門檻不通過即 exit 1（預設 10 seeds）
 *   npm run simulate -- --ablation         消融實驗：現行版本 vs 移除各項改進 → docs/experiments/results/ablation.md
 *   npm run simulate -- --seeds 50 S1 S8   指定 seed 數與情境
 *
 * 情境定義與模擬核心在 sim-core.ts；各實驗的原始數據由 experiments/*.ts 產生。
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  aggregate, f, progress, SCENARIOS, seedList, seedsArg, table,
  V_CURRENT, V_NO_GRAY, V_RANDOM, V_RATIO_JITTER, type Scenario,
} from "./sim-core.ts";
import { ci95, mannWhitney, mean } from "./stats.ts";

// ============================== 輸出格式 ==============================

const mci = (xs: number[], d = 2) => `${f(mean(xs), d)} ± ${f(ci95(xs), d)}`;
const pFmt = (p: number) => (p < 0.001 ? "< 0.001" : f(p, 3));

// ============================== 模式：完整報告 ==============================

function reportMode(scenarios: Scenario[], nSeeds: number, writeFile: boolean) {
  const seeds = seedList(nSeeds);
  const ruleRows: string[][] = [];
  const fairRows: string[][] = [];
  const grayRows: string[][] = [];
  const groupRows: string[][] = [];
  let violations = 0;

  for (const sc of scenarios) {
    const cur = aggregate(sc, V_CURRENT, seeds);
    progress(`${sc.id} current done`);
    const v = cur.runs.reduce((a, r) => a + r.violations.length, 0);
    violations += v;
    ruleRows.push([
      sc.id, sc.name, String(v), mci(cur.runs.map((r) => r.gaps), 1), f(mean(cur.runs.map((r) => r.skippedDays)), 1),
      String(Math.max(...cur.runs.map((r) => r.maxGray7))),
      `${f(mean(cur.runs.map((r) => r.totalMs / Math.max(r.days - r.skippedDays, 1))), 0)} / ${f(Math.max(...cur.runs.map((r) => r.maxMs)), 0)}`,
    ]);
    if (sc.structural) continue;

    const rnd = aggregate(sc, V_RANDOM, seeds);
    progress(`${sc.id} random done`);
    const chiPass = cur.sets.filter((s) => s.chi.pUpper >= 0.05).length / cur.sets.length;
    fairRows.push([
      sc.id, sc.name,
      mci(cur.sets.map((s) => s.sdDev)), mci(rnd.sets.map((s) => s.sdDev)),
      `${f(mean(cur.sets.map((s) => s.gini)), 3)} / ${f(mean(rnd.sets.map((s) => s.gini)), 3)}`,
      `${f(mean(cur.sets.map((s) => s.chi.dispersion)))} / ${f(mean(rnd.sets.map((s) => s.chi.dispersion)))}`,
      `${f(chiPass * 100, 0)}%`,
      pFmt(mannWhitney(cur.sets.map((s) => s.sdDev), rnd.sets.map((s) => s.sdDev)).p),
    ]);
    const cg = cur.sets.filter((s) => s.chiGray);
    const rg = rnd.sets.filter((s) => s.chiGray);
    grayRows.push([
      sc.id, sc.name,
      mci(cur.sets.map((s) => s.sdGray)), mci(rnd.sets.map((s) => s.sdGray)),
      `${f(mean(cur.sets.map((s) => s.giniGray)), 3)} / ${f(mean(rnd.sets.map((s) => s.giniGray)), 3)}`,
      `${f(mean(cg.map((s) => s.chiGray!.dispersion)))} / ${f(mean(rg.map((s) => s.chiGray!.dispersion)))}`,
      pFmt(mannWhitney(cur.sets.map((s) => s.sdGray), rnd.sets.map((s) => s.sdGray)).p),
    ]);
    const lr = cur.sets.flatMap((s) => s.leaderRates);
    const gr = cur.sets.flatMap((s) => s.guardRates);
    if (lr.length && gr.length) {
      groupRows.push([sc.id, sc.name, f(mean(lr), 3), f(mean(gr), 3), f(mean(lr) / mean(gr), 3), pFmt(mannWhitney(lr, gr).p)]);
    }
  }

  const md = `# 情境模擬報告

> 由 \`npm run simulate\` 自動產生，請勿手動編輯。每個情境排 30 天，以 **${nSeeds} 個 random seed** 重複執行。
> 「± 」為平均數的 95% confidence interval。實驗歷程與解讀見 [\`docs/experiments/\`](experiments/)。

## 情境

${SCENARIOS.map((s) => `- **${s.id} ${s.name}**：${s.desc}${s.structural ? "（結構性人力不足，只檢查規定與空缺）" : ""}`).join("\n")}

## 1. 硬性規定與人力

${table(["ID", "情境", "違規", "空缺／月", "跳過天數", "7 日內最多灰色天", "ms／天（平均／最大）"], ruleRows)}

- **違規**：獨立 checker（以小時計算，不使用排哨演算法的任何邏輯）找到的違規數，全部 seed 合計，必須為 0。
- **跳過天數**：可動用人力低於最低門檻、系統拒絕排哨的天數。

## 2. 公平性：現行版本 vs 對照組

對照組（control group）只遵守硬性規定、候選人完全隨機，用來回答「公平是演算法的功勞，還是規定本身就會造成的？」

${table(["ID", "情境", "偏差 RMS（現行）", "偏差 RMS（對照）", "Gini 現行／對照", "Dispersion 現行／對照", "χ² 未拒絕 H0", "Mann-Whitney p"], fairRows)}

## 3. 灰色時段公平性

${table(["ID", "情境", "灰色偏差 RMS（現行）", "灰色偏差 RMS（對照）", "Gini 現行／對照", "Dispersion 現行／對照", "Mann-Whitney p"], grayRows)}

## 4. Subgroup analysis：哨長 vs 僅槍兵

${table(["ID", "情境", "哨長 節／上班天", "僅槍兵 節／上班天", "比值", "Mann-Whitney p"], groupRows)}

## 指標說明

- **偏差 RMS**：月結算時每人「實際節數 − 應得節數」的 root mean square，單位為「節」。
  應得 = 上班天數 × 全單位平均（節／上班天）。
- **Gini coefficient**：每人「節數／上班天」的分配不均程度，0 為完全平均。
- **Chi-square goodness-of-fit test**：H0 為「節數依上班天數比例隨機分配（multinomial）」。
  - **Dispersion index** = χ² / df。純隨機抽籤約為 1；**遠小於 1 代表比隨機抽籤更平均**，這正是排班演算法的目標。
  - **χ² 未拒絕 H0**：上尾 p ≥ 0.05 的 run 比例。上尾 p 很小代表「有人系統性地被多排或少排」。
- **Mann-Whitney U test**：比較現行版本與對照組在各 seed 下的偏差 RMS，p < 0.05 代表差異在統計上顯著。
- **Subgroup analysis**：比較兩種資格每人每上班天的節數；比值接近 1、p ≥ 0.05 代表沒有系統性偏差。
`;
  console.log(md);
  if (writeFile) {
    writeFileSync(new URL("../docs/simulation-report.md", import.meta.url), md);
    progress("已寫入 docs/simulation-report.md");
  }
  return violations;
}

// ============================== 模式：CI 驗證 ==============================

function checkMode(scenarios: Scenario[], nSeeds: number): number {
  const seeds = seedList(nSeeds);
  const rows: string[][] = [];
  let failures = 0;
  for (const sc of scenarios) {
    const { runs, sets } = aggregate(sc, V_CURRENT, seeds);
    const e = sc.expect;
    const checks: Array<[string, number, number | undefined, "max" | "min"]> = [
      ["違規", runs.reduce((a, r) => a + r.violations.length, 0), 0, "max"],
      ["空缺／月", mean(runs.map((r) => r.gaps)), e.maxGaps, "max"],
      ["偏差 RMS", mean(sets.map((s) => s.sdDev)), sc.structural ? undefined : e.maxSdDev, "max"],
      ["灰色偏差 RMS", mean(sets.map((s) => s.sdGray)), sc.structural ? undefined : e.maxSdGray, "max"],
      ["χ² 未拒絕比例", sets.filter((s) => s.chi.pUpper >= 0.05).length / sets.length, sc.structural ? undefined : e.minChiPass, "min"],
    ];
    for (const [name, value, limit, dir] of checks) {
      if (limit === undefined) continue;
      const ok = dir === "max" ? value <= limit + 1e-9 : value >= limit - 1e-9;
      if (!ok) failures++;
      rows.push([sc.id, sc.name, name, f(value), `${dir === "max" ? "≤" : "≥"} ${limit}`, ok ? "✅" : "❌"]);
    }
    if (runs.some((r) => r.violations.length)) console.error(`[${sc.id}]`, runs.flatMap((r) => r.violations).slice(0, 5));
    progress(`${sc.id} checked`);
  }
  const md = `## 排哨演算法驗證（${nSeeds} seeds）\n\n${table(["ID", "情境", "指標", "結果", "門檻", ""], rows)}\n\n` +
    (failures ? `**❌ ${failures} 項未通過**\n` : "**✅ 全部通過**\n");
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  return failures;
}

// ============================== 模式：消融實驗 ==============================

function ablationMode(scenarios: Scenario[], nSeeds: number) {
  const seeds = seedList(nSeeds);
  const variants = [V_NO_GRAY, V_RATIO_JITTER];
  const rows: string[][] = [];
  for (const sc of scenarios.filter((s) => !s.structural)) {
    const cur = aggregate(sc, V_CURRENT, seeds);
    for (const v of variants) {
      const alt = aggregate(sc, v, seeds);
      rows.push([
        sc.id, v.name,
        `${mci(cur.sets.map((s) => s.sdDev))} vs ${mci(alt.sets.map((s) => s.sdDev))}`,
        pFmt(mannWhitney(cur.sets.map((s) => s.sdDev), alt.sets.map((s) => s.sdDev)).p),
        `${mci(cur.sets.map((s) => s.sdGray))} vs ${mci(alt.sets.map((s) => s.sdGray))}`,
        pFmt(mannWhitney(cur.sets.map((s) => s.sdGray), alt.sets.map((s) => s.sdGray)).p),
        `${f(mean(cur.runs.map((r) => r.gaps)), 1)} vs ${f(mean(alt.runs.map((r) => r.gaps)), 1)}`,
      ]);
    }
    progress(`${sc.id} ablation done`);
  }
  const md = `# 消融實驗（Ablation study）

> 由 \`npm run simulate -- --ablation\` 自動產生（${nSeeds} seeds）。每一列比較「現行版本 vs 移除某項改進」，
> 兩者使用完全相同的出勤資料。數值為平均 ± 95% CI；p 為 Mann-Whitney U test（雙尾）。

${table(["ID", "移除的改進", "偏差 RMS：現行 vs 移除", "p", "灰色偏差 RMS：現行 vs 移除", "p", "空缺／月：現行 vs 移除"], rows)}
`;
  console.log(md);
  mkdirSync(new URL("../docs/experiments/results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../docs/experiments/results/ablation.md", import.meta.url), md);
  progress("已寫入 docs/experiments/results/ablation.md");
}

// ============================== 進入點 ==============================

function main() {
  const args = process.argv.slice(2);
  const only = args.filter((a) => /^S\d+$/.test(a));
  const scenarios = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;

  if (args.includes("--check")) {
    if (checkMode(scenarios, seedsArg(args, 10))) process.exitCode = 1;
  } else if (args.includes("--ablation")) {
    ablationMode(scenarios, seedsArg(args, 30));
  } else {
    if (reportMode(scenarios, seedsArg(args, 30), !only.length)) process.exitCode = 1;
  }
}

main();
