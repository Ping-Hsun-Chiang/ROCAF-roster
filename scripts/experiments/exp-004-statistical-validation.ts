/**
 * EXP-004 原始數據：以統計檢定驗證公平性（對照組、消融實驗）
 *
 *   npm run experiment -- scripts/experiments/exp-004-statistical-validation.ts [--seeds 30]
 *   → docs/experiments/data/exp-004/
 *
 * 12 個情境 × 4 個演算法版本（現行、隨機對照組、移除灰色公平值、舊 jitter 單位）× 30 seeds。
 * 結構性人力不足的 S4～S6 只跑現行版本，與 simulate.ts 報告一致。
 * 分析見 docs/experiments/EXP-004-statistical-validation.ipynb；文字報告由 `npm run simulate` 產生。
 *
 * 輸出：
 *   scenarios.csv  情境清單
 *   persons.csv    每個 run 每個人的月結算（tidy data，一列一人）
 *   runs.csv       每個 run 的空缺、違規數，以及 stats.ts 算出的統計量（供 notebook 交叉驗證）
 *   tests.csv      simulate.ts 報告中使用的 Mann-Whitney U test 結果（同上）
 */
import {
  aggregate, PERSON_COLUMNS, personRows, progress, SCENARIOS, seedList, seedsArg, V_CURRENT, VARIANTS, writeData,
  type Agg, type CsvRow,
} from "../sim-core.ts";
import { mannWhitney } from "../stats.ts";

function main() {
  const seeds = seedList(seedsArg(process.argv.slice(2), 30));
  const scenarioRows: CsvRow[] = SCENARIOS.map((s) => [
    s.id, s.name, s.desc, !!s.structural, s.people.length, s.people.filter((p) => p.qualification === "leader").length,
  ]);
  const persons: CsvRow[] = [];
  const runs: CsvRow[] = [];
  const tests: CsvRow[] = [];

  for (const sc of SCENARIOS) {
    const results = new Map<string, Agg>();
    for (const v of sc.structural ? [V_CURRENT] : VARIANTS) {
      const agg = aggregate(sc, v, seeds);
      results.set(v.id, agg);
      agg.runs.forEach((r, i) => {
        const s = agg.sets[i];
        persons.push(...personRows(r, [sc.id, v.id, seeds[i]]));
        runs.push([
          sc.id, v.id, seeds[i], r.days, r.skippedDays, r.gaps, r.violations.length, r.maxGray7,
          s.sdDev, s.sdGray, s.gini, s.chi.chi2, s.chi.df, s.chi.pUpper, s.chi.dispersion,
          s.chiGray?.chi2 ?? "", s.chiGray?.pUpper ?? "",
        ]);
      });
    }
    progress(`${sc.id} done`);
    if (sc.structural) continue;

    // 與 simulate.ts 報告相同的比較，記錄 stats.ts 的結果供 notebook 以 scipy 重算比對
    const cur = results.get(V_CURRENT.id)!;
    for (const v of VARIANTS.filter((x) => x.id !== V_CURRENT.id)) {
      const alt = results.get(v.id)!;
      for (const [metric, pick] of [["rms", (i: number, a: Agg) => a.sets[i].sdDev], ["rms_gray", (i: number, a: Agg) => a.sets[i].sdGray]] as const) {
        const t = mannWhitney(seeds.map((_, i) => pick(i, cur)), seeds.map((_, i) => pick(i, alt)));
        tests.push([sc.id, `current_vs_${v.id}`, metric, t.u, t.z, t.p]);
      }
    }
    const lr = cur.sets.flatMap((s) => s.leaderRates);
    const gr = cur.sets.flatMap((s) => s.guardRates);
    if (lr.length && gr.length) {
      const t = mannWhitney(lr, gr);
      tests.push([sc.id, "leader_vs_guard", "rate", t.u, t.z, t.p]);
    }
  }

  writeData("exp-004", {
    scenarios: [["scenario", "name", "desc", "structural", "n_people", "n_leaders"], scenarioRows],
    persons: [["scenario", "variant", "seed", ...PERSON_COLUMNS], persons],
    runs: [[
      "scenario", "variant", "seed", "days", "skipped_days", "gaps", "violations", "max_gray7",
      "ts_rms", "ts_rms_gray", "ts_gini", "ts_chi2", "ts_df", "ts_p_upper", "ts_dispersion", "ts_chi2_gray", "ts_p_upper_gray",
    ], runs],
    tests: [["scenario", "comparison", "metric", "ts_u", "ts_z", "ts_p"], tests],
  });
}

main();
