/**
 * EXP-003 重現腳本：建議人力門檻
 *
 *   npm run experiment -- scripts/experiments/exp-003-manpower-thresholds.ts [--seeds 30]
 *   → docs/experiments/data/exp-003/（原始數據，分析見 EXP-003-manpower-thresholds.ipynb）
 *   → docs/experiments/results/EXP-003.md（摘要表格）
 *
 * 1. 全勤 30 天，每日可動用 8～13 人（哨長占 60%，四捨五入），統計每月空缺。
 * 2. 20 人全勤、哨長 4～7 人，統計空缺落在哪個位置，以及「當天哨長位有空缺、卻有哨長被排在槍兵位」的次數
 *    （若為 0，代表空缺不是演算法把哨長浪費在槍兵位造成的）。
 *
 * 人力越少回溯搜尋越久，8～9 人的情境單月約需數秒。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  f, makePeople, progress, runScenario, seedList, seedsArg, table, V_CURRENT, writeData, type CsvRow, type Scenario,
} from "../sim-core.ts";
import { ci95, mean } from "../stats.ts";

const allPresent = () => true;
const mci = (xs: number[], d = 1) => `${f(mean(xs), d)} ± ${f(ci95(xs), d)}`;

function main() {
  const seeds = seedList(seedsArg(process.argv.slice(2), 30));

  // ---- 1. 每日可動用人數 ----
  const headRows: string[][] = [];
  const data: CsvRow[] = [];
  for (let n = 8; n <= 13; n++) {
    const leaders = Math.round(n * 0.6);
    const sc: Scenario = { id: `N${n}`, name: `${n} 人`, desc: "", people: makePeople(leaders, n - leaders), available: allPresent, expect: {} };
    const runs = seeds.map((seed) => runScenario(sc, seed, V_CURRENT.opts));
    runs.forEach((r, i) => data.push(["headcount", n, leaders, seeds[i], r.gaps, "", "", "", r.violations.length]));
    headRows.push([`${n}（哨長 ${leaders}）`, mci(runs.map((r) => r.gaps)), String(Math.max(...runs.map((r) => r.gaps))),
      String(runs.reduce((a, r) => a + r.violations.length, 0))]);
    progress(`N${n} done`);
  }

  // ---- 2. 哨長人數 ----
  const leaderRows: string[][] = [];
  for (let l = 4; l <= 7; l++) {
    const sc: Scenario = { id: `L${l}`, name: `哨長 ${l}`, desc: "", people: makePeople(l, 20 - l), available: allPresent, expect: {} };
    const leaderIds = new Set(sc.people.filter((p) => p.qualification === "leader").map((p) => p.id));
    const per = seeds.map((seed) => {
      let leaderGaps = 0;
      let guardGaps = 0;
      let wasted = 0;
      const r = runScenario(sc, seed, V_CURRENT.opts, 30, "2026-11-01", {
        onDay: (_date, res) => {
          const lg = res.unfilled.filter((u) => u.role === "leader").length;
          leaderGaps += lg;
          guardGaps += res.unfilled.length - lg;
          if (lg > 0) wasted += res.roster.filter((row) => row.guard && leaderIds.has(row.guard)).length;
        },
      });
      data.push(["leaders", 20, l, seed, r.gaps, leaderGaps, guardGaps, wasted, r.violations.length]);
      return { leaderGaps, guardGaps, wasted };
    });
    leaderRows.push([String(l), mci(per.map((x) => x.leaderGaps)), mci(per.map((x) => x.guardGaps)), String(per.reduce((a, x) => a + x.wasted, 0))]);
    progress(`L${l} done`);
  }

  const md = `# EXP-003 重現結果：建議人力門檻

> 由 \`npm run experiment -- scripts/experiments/exp-003-manpower-thresholds.ts\` 自動產生（${seeds.length} seeds，全勤、每個 run 排 30 天）。
> 數值為平均 ± 95% CI。

## 每日可動用人數 vs 每月空缺

${table(["每日可動用人數", "每月空缺（格）", "最差一個月", "違規"], headRows)}

## 哨長人數 vs 空缺位置（20 人全勤）

「哨長站槍兵位」= 當天哨長位有空缺，卻有哨長被排在槍兵位的格數（${seeds.length} seeds 合計）。

${table(["哨長人數", "哨長位空缺／月", "槍兵位空缺／月", "哨長站槍兵位"], leaderRows)}
`;
  console.log(md);
  writeData("exp-003", {
    // sweep = headcount：全勤、哨長占 60%，只記錄總空缺；sweep = leaders：20 人全勤，另記錄空缺位置
    runs: [["sweep", "n_people", "n_leaders", "seed", "gaps", "leader_gaps", "guard_gaps", "leader_on_guard_with_gap", "violations"], data],
  });
  mkdirSync(new URL("../../docs/experiments/results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../../docs/experiments/results/EXP-003.md", import.meta.url), md);
  progress("已寫入 docs/experiments/results/EXP-003.md");
}

main();
