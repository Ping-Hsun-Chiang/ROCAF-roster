/**
 * EXP-002 重現腳本：Jitter 單位修正
 *
 *   npm run experiment -- scripts/experiments/exp-002-jitter-unit.ts [--seeds 30]
 *   → docs/experiments/data/exp-002/（原始數據，分析見 EXP-002-jitter-unit.ipynb）
 *   → docs/experiments/results/EXP-002.md（摘要表格）
 *
 * 比較舊版（jitter 0.3，以公平值為單位）與以「節」為單位的 1.0／0.5（現行）／0.2，
 * 情境為 8 個非結構性情境（與 EXP-002 原始方法相同，S7 當時尚未加入）。
 *
 * 另外量化 EXP-002 結論中「尚未量化」的取捨：**同班次重複率**
 * = 連續兩天都有站哨的人中，隔天被排到相同班次的比例。jitter 越小，排序越固定，重複率可能越高。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  f, PERSON_COLUMNS, personRows, progress, runScenario, SCENARIOS, seedList, seedsArg, settle, table, writeData,
  type CsvRow, type Variant,
} from "../sim-core.ts";
import { addDays } from "../../lib/scheduler.ts";
import { ci95, mean } from "../stats.ts";

const VARIANTS: Variant[] = [
  { id: "ratio0.3", name: "舊版（公平值單位 0.3）", opts: { jitterUnit: "ratio", jitter: 0.3 } },
  { id: "shift1.0", name: "1.0 節", opts: { jitter: 1.0 } },
  { id: "shift0.5", name: "0.5 節（現行）", opts: { jitter: 0.5 } },
  { id: "shift0.2", name: "0.2 節", opts: { jitter: 0.2 } },
];
const IDS = ["S1", "S2", "S3", "S8", "S9", "S10", "S11", "S12"];

const mci = (xs: number[], d = 2) => `${f(mean(xs), d)} ± ${f(ci95(xs), d)}`;

/** 跑一個月，同時計算同班次重複率：今天與昨天都有排班的人，兩天班次有重疊的比例 */
function runWithRepeat(sc: (typeof SCENARIOS)[number], seed: number, v: Variant) {
  const byDay = new Map<string, Map<string, Set<number>>>();
  const run = runScenario(sc, seed, v.opts, 30, "2026-11-01", {
    onDay: (date, res) => {
      const m = new Map<string, Set<number>>();
      res.roster.forEach((row, s) => {
        for (const id of [row.leader, row.guard]) if (id) (m.get(id) ?? m.set(id, new Set()).get(id)!).add(s);
      });
      byDay.set(date, m);
    },
  });
  let both = 0;
  let same = 0;
  for (const [date, today] of byDay) {
    const prev = byDay.get(addDays(date, -1));
    if (!prev) continue;
    for (const [id, shifts] of today) {
      const p = prev.get(id);
      if (!p) continue;
      both++;
      if ([...shifts].some((s) => p.has(s))) same++;
    }
  }
  return { run, set: settle(run), both, same, repeat: both ? same / both : 0 };
}

function main() {
  const seeds = seedList(seedsArg(process.argv.slice(2), 30));
  const devRows: string[][] = [];
  const repRows: string[][] = [];
  const persons: CsvRow[] = [];
  const runs: CsvRow[] = [];
  for (const sc of SCENARIOS.filter((s) => IDS.includes(s.id))) {
    const dev: string[] = [sc.id, sc.name];
    const rep: string[] = [sc.id, sc.name];
    for (const v of VARIANTS) {
      const rs = seeds.map((seed) => runWithRepeat(sc, seed, v));
      rs.forEach((r, i) => {
        persons.push(...personRows(r.run, [sc.id, v.id, seeds[i]]));
        runs.push([sc.id, v.id, seeds[i], r.run.gaps, r.run.violations.length, r.both, r.same, r.set.sdDev, r.set.maxDev]);
      });
      dev.push(`${mci(rs.map((r) => r.set.sdDev))} / ${f(mean(rs.map((r) => r.set.maxDev)), 1)}`);
      rep.push(`${f(mean(rs.map((r) => r.repeat)) * 100, 1)}%`);
    }
    devRows.push(dev);
    repRows.push(rep);
    progress(`${sc.id} done`);
  }

  const header = ["ID", "情境", ...VARIANTS.map((v) => v.name)];
  const md = `# EXP-002 重現結果：Jitter 單位

> 由 \`npm run experiment -- scripts/experiments/exp-002-jitter-unit.ts\` 自動產生（${seeds.length} seeds，每個 run 排 30 天）。
> 所有版本使用完全相同的出勤資料。

## 月結算偏差

每格為「偏差 RMS（平均 ± 95% CI）／ 最大偏差（每個 run 最差一人，取平均）」，單位為節。

${table(header, devRows)}

## 同班次重複率（隨機輪替程度）

連續兩天都有站哨的人中，隔天被排到相同班次的比例（${seeds.length} seeds 平均）。越高代表輪替越少。

${table(header, repRows)}
`;
  console.log(md);
  writeData("exp-002", {
    variants: [["variant", "name", "jitter_unit", "jitter"],
      VARIANTS.map((v) => [v.id, v.name, v.opts.jitterUnit ?? "shift", v.opts.jitter ?? 0.5])],
    persons: [["scenario", "variant", "seed", ...PERSON_COLUMNS], persons],
    // repeat_pairs：連續兩天都有站哨的「人·天」數；repeat_same：其中隔天班次與前一天有重疊的數量
    runs: [["scenario", "variant", "seed", "gaps", "violations", "repeat_pairs", "repeat_same", "ts_rms", "ts_max_dev"], runs],
  });
  mkdirSync(new URL("../../docs/experiments/results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../../docs/experiments/results/EXP-002.md", import.meta.url), md);
  progress("已寫入 docs/experiments/results/EXP-002.md");
}

main();
