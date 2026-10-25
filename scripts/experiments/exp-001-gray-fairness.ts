/**
 * EXP-001 重現腳本：灰色時段公平值
 *
 *   npm run experiment -- scripts/experiments/exp-001-gray-fairness.ts [--seeds 30]
 *   → docs/experiments/results/EXP-001.md
 *
 * 比較「移除灰色公平值」（EXP-001 之前的行為）與現行版本，情境與 EXP-001 原始方法相同：
 * 14 人（哨長 8）、20 人（哨長 10）各 20% 休假，50 人（哨長 27）30% 休假，以及人力吃緊的 10 人（哨長 6）10% 休假。
 *
 * 注意：EXP-001 原始的 1-seed 數據來自當時未保留的臨時腳本，且當時的 jitter 單位尚未修正（EXP-002），
 * 因此本腳本的數值不會與原始表格完全相同；本腳本兩組都使用目前的程式碼，只差在灰色公平值的開關。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  aggregate, f, makePeople, progress, randomLeave, seedList, seedsArg, table,
  V_CURRENT, V_NO_GRAY, type Agg, type Scenario,
} from "../sim-core.ts";
import { ci95, mannWhitney, mean } from "../stats.ts";

const CASES: Scenario[] = [
  { id: "A", name: "14 人（哨長 8）", desc: "20% 休假", people: makePeople(8, 6), available: randomLeave(0.2), expect: {} },
  { id: "B", name: "20 人（哨長 10）", desc: "20% 休假", people: makePeople(10, 10), available: randomLeave(0.2), expect: {} },
  { id: "C", name: "50 人（哨長 27）", desc: "30% 休假", people: makePeople(27, 23), available: randomLeave(0.3), expect: {} },
  { id: "D", name: "10 人（哨長 6）人力吃緊", desc: "10% 休假", people: makePeople(6, 4), available: randomLeave(0.1), expect: {} },
];

const mci = (xs: number[], d = 2) => `${f(mean(xs), d)} ± ${f(ci95(xs), d)}`;
const pFmt = (p: number) => (p < 0.001 ? "< 0.001" : f(p, 3));

/** 每個 run：灰色節數與「灰色 ÷ 上班天」的最小～最大值（只計上班 ≥ 1 天的人） */
function grayRange(a: Agg) {
  return a.runs.map((r) => {
    const ps = r.people.filter((p) => p.workDays > 0);
    const g = ps.map((p) => p.gray);
    const rate = ps.map((p) => p.gray / p.workDays);
    return { gMin: Math.min(...g), gMax: Math.max(...g), rMin: Math.min(...rate), rMax: Math.max(...rate) };
  });
}

function main() {
  const seeds = seedList(seedsArg(process.argv.slice(2), 30));
  const rows: string[][] = [];
  for (const sc of CASES) {
    const before = aggregate(sc, V_NO_GRAY, seeds);
    const after = aggregate(sc, V_CURRENT, seeds);
    const [gb, ga] = [grayRange(before), grayRange(after)];
    rows.push([
      sc.name,
      `${f(mean(gb.map((x) => x.gMin)), 1)}～${f(mean(gb.map((x) => x.gMax)), 1)} → **${f(mean(ga.map((x) => x.gMin)), 1)}～${f(mean(ga.map((x) => x.gMax)), 1)}**`,
      `${f(mean(gb.map((x) => x.rMin)))}～${f(mean(gb.map((x) => x.rMax)))} → **${f(mean(ga.map((x) => x.rMin)))}～${f(mean(ga.map((x) => x.rMax)))}**`,
      `${mci(before.sets.map((s) => s.sdGray))} → **${mci(after.sets.map((s) => s.sdGray))}**`,
      pFmt(mannWhitney(after.sets.map((s) => s.sdGray), before.sets.map((s) => s.sdGray)).p),
      `${f(mean(before.runs.map((r) => r.maxGray7)), 1)} → ${f(mean(after.runs.map((r) => r.maxGray7)), 1)}`,
      `${mci(before.sets.map((s) => s.sdDev))} → ${mci(after.sets.map((s) => s.sdDev))}`,
      `${mci(before.runs.map((r) => r.gaps), 1)} → ${mci(after.runs.map((r) => r.gaps), 1)}`,
    ]);
    progress(`${sc.id} done`);
  }

  const md = `# EXP-001 重現結果：灰色時段公平值

> 由 \`npm run experiment -- scripts/experiments/exp-001-gray-fairness.ts\` 自動產生（${seeds.length} seeds，每個 run 排 30 天）。
> 每格為「移除灰色公平值 → 現行版本」，兩者使用完全相同的出勤資料。數值為 ${seeds.length} 個 seed 的平均（± 為 95% CI）；
> p 為灰色偏差 RMS 的 Mann-Whitney U test（雙尾）。

${table(["情境", "灰色節數（最少～最多）", "灰色 ÷ 上班天", "灰色偏差 RMS", "p", "7 日內最多灰色天", "總節數偏差 RMS", "空缺／月"], rows)}
`;
  console.log(md);
  mkdirSync(new URL("../../docs/experiments/results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../../docs/experiments/results/EXP-001.md", import.meta.url), md);
  progress("已寫入 docs/experiments/results/EXP-001.md");
}

main();
