/**
 * 匯出模擬的原始數據（raw data），供 docs/experiments/analysis.ipynb 獨立分析。
 *
 *   npm run export-data                  12 個情境 × 4 個演算法版本 × 30 seeds → docs/experiments/data/
 *                                        （結構性人力不足的 S4～S6 只跑現行版本，與 simulate.ts 報告一致）
 *   npm run export-data -- --seeds 10    指定 seed 數
 *
 * 輸出（皆為 UTF-8 CSV，不含執行時間等與機器有關的欄位，因此相同程式碼必定產生相同檔案，CI 會比對）：
 *   scenarios.csv  情境清單
 *   persons.csv    每個 run 每個人的月結算：上班天數、節數、灰色節數（tidy data，一列一人）
 *   runs.csv       每個 run 的空缺、違規數，以及 stats.ts 算出的統計量（供 notebook 交叉驗證）
 *   tests.csv      simulate.ts 報告中使用的 Mann-Whitney U test 結果（同上）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { aggregate, progress, SCENARIOS, seedList, seedsArg, V_CURRENT, VARIANTS, type Agg } from "./sim-core.ts";
import { mannWhitney } from "./stats.ts";

const num = (x: number) => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(12))));
const cell = (v: string | number | boolean) =>
  typeof v === "number" ? num(v) : typeof v === "boolean" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const csv = (header: string[], rows: Array<Array<string | number | boolean>>) =>
  [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";

function main() {
  const seeds = seedList(seedsArg(process.argv.slice(2), 30));
  const dir = new URL("../docs/experiments/data/", import.meta.url);
  mkdirSync(dir, { recursive: true });

  const scenarioRows = SCENARIOS.map((s) => [
    s.id, s.name, s.desc, !!s.structural, s.people.length, s.people.filter((p) => p.qualification === "leader").length,
  ]);
  const personRows: Array<Array<string | number | boolean>> = [];
  const runRows: Array<Array<string | number | boolean>> = [];
  const testRows: Array<Array<string | number | boolean>> = [];

  for (const sc of SCENARIOS) {
    const results = new Map<string, Agg>();
    for (const v of sc.structural ? [V_CURRENT] : VARIANTS) {
      const agg = aggregate(sc, v, seeds);
      results.set(v.id, agg);
      agg.runs.forEach((r, i) => {
        const s = agg.sets[i];
        for (const p of r.people) {
          personRows.push([sc.id, v.id, seeds[i], p.person.id, p.person.qualification, p.workDays, p.shifts, p.gray]);
        }
        runRows.push([
          sc.id, v.id, seeds[i], r.days, r.skippedDays, r.gaps, r.violations.length, r.maxGray7,
          s.sdDev, s.sdGray, s.gini, s.chi.chi2, s.chi.df, s.chi.pUpper, s.chi.dispersion,
          s.chiGray?.chi2 ?? "", s.chiGray?.pUpper ?? "",
        ]);
      });
    }
    progress(`${sc.id} exported`);
    if (sc.structural) continue;

    // 與 simulate.ts 報告相同的比較，記錄 stats.ts 的結果供 notebook 以 scipy 重算比對
    const cur = results.get(V_CURRENT.id)!;
    for (const v of VARIANTS.filter((x) => x.id !== V_CURRENT.id)) {
      const alt = results.get(v.id)!;
      for (const [metric, pick] of [["rms", (i: number, a: Agg) => a.sets[i].sdDev], ["rms_gray", (i: number, a: Agg) => a.sets[i].sdGray]] as const) {
        const t = mannWhitney(seeds.map((_, i) => pick(i, cur)), seeds.map((_, i) => pick(i, alt)));
        testRows.push([sc.id, `current_vs_${v.id}`, metric, t.u, t.z, t.p]);
      }
    }
    const lr = cur.sets.flatMap((s) => s.leaderRates);
    const gr = cur.sets.flatMap((s) => s.guardRates);
    if (lr.length && gr.length) {
      const t = mannWhitney(lr, gr);
      testRows.push([sc.id, "leader_vs_guard", "rate", t.u, t.z, t.p]);
    }
  }

  writeFileSync(new URL("scenarios.csv", dir), csv(["scenario", "name", "desc", "structural", "n_people", "n_leaders"], scenarioRows));
  writeFileSync(new URL("persons.csv", dir), csv(["scenario", "variant", "seed", "person", "qualification", "work_days", "shifts", "gray"], personRows));
  writeFileSync(new URL("runs.csv", dir), csv([
    "scenario", "variant", "seed", "days", "skipped_days", "gaps", "violations", "max_gray7",
    "ts_rms", "ts_rms_gray", "ts_gini", "ts_chi2", "ts_df", "ts_p_upper", "ts_dispersion", "ts_chi2_gray", "ts_p_upper_gray",
  ], runRows));
  writeFileSync(new URL("tests.csv", dir), csv(["scenario", "comparison", "metric", "ts_u", "ts_z", "ts_p"], testRows));
  progress(`已寫入 docs/experiments/data/（${seeds.length} seeds，${personRows.length} 列 persons）`);
}

main();
