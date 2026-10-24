/**
 * 情境模擬（Scenario-based simulation）與統計分析
 *
 * 每個情境連續排一個月（30 天），以多個 random seed 重複執行，做「月結算」並以統計檢定評估公平性。
 *
 *   npm run simulate                       完整報告（現行版本 vs 隨機對照組，30 seeds）→ docs/simulation-report.md
 *   npm run simulate -- --check            CI 驗證：門檻不通過即 exit 1（預設 10 seeds）
 *   npm run simulate -- --ablation         消融實驗：現行版本 vs 移除各項改進 → docs/experiments/results/ablation.md
 *   npm run simulate -- --seeds 50 S1 S8   指定 seed 數與情境
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  addDays, checkMinimumManpower, generateRoster, GRAY_SHIFTS,
  type Candidate, type GenerateOptions, type HistoryAssignment, type Qualification,
} from "../lib/scheduler.ts";
import { chiSquareGOF, ci95, gini, mannWhitney, mean, type ChiSquareResult } from "./stats.ts";

// ============================== 情境定義 ==============================

interface Person {
  id: string;
  qualification: Qualification;
  /** 第幾天報到（含），預設 0 */
  joinDay?: number;
  /** 第幾天起離營（不含） */
  leaveDay?: number;
  /** 長假區間 [start, end) */
  vacation?: [number, number];
}

/** CI 門檻（--check）。未列出的指標不檢查；違規數一律必須為 0 */
interface Expect {
  maxGaps?: number;   // 每月平均空缺上限
  maxSdDev?: number;  // 月結算節數偏差 SD（seed 平均）上限
  maxSdGray?: number; // 灰色偏差 SD 上限
  minChiPass?: number; // χ² 上尾檢定 p ≥ 0.05 的 run 比例下限
}

interface Scenario {
  id: string;
  name: string;
  desc: string;
  people: Person[];
  available: (p: Person, idx: number, day: number, date: string, rand: () => number) => boolean;
  /** 若回傳數字，當天從在營人員中隨機抽出這麼多人可動用 */
  dailyHeadcount?: (day: number, rand: () => number, onBase: number) => number;
  /** 結構性不足的情境：公平性指標不具參考價值，只檢查違規與空缺 */
  structural?: boolean;
  expect: Expect;
}

function makePeople(leaders: number, guards: number, extra: (i: number) => Partial<Person> = () => ({})): Person[] {
  const quals: Qualification[] = [...Array(leaders).fill("leader"), ...Array(guards).fill("guard")];
  return quals.map((q, i) => ({ id: `p${String(i).padStart(2, "0")}`, qualification: q, ...extra(i) }));
}

const randomLeave = (prob: number) => (_p: Person, _i: number, _d: number, _date: string, rand: () => number) => rand() >= prob;
const weekday = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();

const NORMAL: Expect = { maxGaps: 0.5, maxSdDev: 0.6, maxSdGray: 0.8, minChiPass: 0.95 };

export const SCENARIOS: Scenario[] = [
  { id: "S1", name: "標準單位", desc: "30 人（哨長 18／僅槍兵 12），每天 20% 隨機休假",
    people: makePeople(18, 12), available: randomLeave(0.2), expect: NORMAL },
  { id: "S2", name: "小單位", desc: "12 人（7／5），每天 10% 隨機休假",
    people: makePeople(7, 5), available: randomLeave(0.1), expect: { maxGaps: 4, maxSdDev: 0.6, maxSdGray: 1.0, minChiPass: 0.95 } },
  { id: "S3", name: "大單位", desc: "50 人（27／23），每天 30% 隨機休假",
    people: makePeople(27, 23), available: randomLeave(0.3), expect: NORMAL },
  { id: "S4", name: "極限 8 人全勤", desc: "8 人（5／3），全月無休，正好是最低門檻",
    people: makePeople(5, 3), available: () => true, structural: true, expect: { maxGaps: 70 } },
  { id: "S5", name: "10 人全勤", desc: "10 人（6／4），全月無休",
    people: makePeople(6, 4), available: () => true, structural: true, expect: { maxGaps: 16 } },
  { id: "S6", name: "哨長稀缺", desc: "20 人但只有 4 位哨長（哨長全勤，僅槍兵 20% 休假）",
    people: makePeople(4, 16),
    available: (p, _i, _d, _date, rand) => p.qualification === "leader" || rand() >= 0.2,
    structural: true, expect: { maxGaps: 35 } },
  { id: "S7", name: "全員哨長", desc: "20 人全部具哨長資格，20% 休假（無資格限制）",
    people: makePeople(20, 0), available: randomLeave(0.2), expect: NORMAL },
  { id: "S8", name: "週末大休", desc: "30 人（18／12），平日 10% 休假、週末 60% 休假",
    people: makePeople(18, 12),
    available: (_p, _i, _d, date, rand) => rand() >= ([0, 6].includes(weekday(date)) ? 0.6 : 0.1),
    expect: { maxGaps: 0.5, maxSdDev: 0.9, maxSdGray: 0.6 } },
  { id: "S9", name: "長假", desc: "25 人（15／10），其中 7 人各休 10 天長假（時段錯開），其餘 10% 休假",
    people: makePeople(15, 10, (i) => (i % 4 === 0 ? { vacation: [(i * 3) % 20, (i * 3) % 20 + 10] as [number, number] } : {})),
    available: randomLeave(0.1), expect: NORMAL },
  { id: "S10", name: "中途報到／離營", desc: "25 人（15／10），5 人第 16 天才報到、3 人第 11 天起離營",
    people: makePeople(15, 10, (i) => (i >= 20 ? { joinDay: 15 } : i < 3 ? { leaveDay: 10 } : {})),
    available: randomLeave(0.1), expect: NORMAL },
  { id: "S11", name: "出勤劇烈波動", desc: "30 人（18／12），每天可動用人數在 8～30 之間隨機",
    people: makePeople(18, 12), available: () => true,
    dailyHeadcount: (_d, rand, onBase) => Math.min(onBase, 8 + Math.floor(rand() * 23)),
    expect: { maxGaps: 1, maxSdDev: 0.9, maxSdGray: 0.7 } },
  { id: "S12", name: "固定輪休（上 5 休 2）", desc: "21 人（13／8），每人每週固定連休 2 天、彼此錯開",
    people: makePeople(13, 8),
    available: (_p, i, d) => { const k = (d + i) % 7; return k !== 5 && k !== 6; }, expect: NORMAL },
];

// ============================== 演算法版本 ==============================

interface Variant { id: string; name: string; opts: GenerateOptions }

const V_CURRENT: Variant = { id: "current", name: "現行版本", opts: {} };
const V_RANDOM: Variant = { id: "random", name: "對照組（只守硬性規定、隨機排人）", opts: { randomOrder: true } };
const V_NO_GRAY: Variant = { id: "noGray", name: "移除灰色公平值（EXP-001 前）", opts: { grayWeight: 0, grayRecentPenalty: [0.5, 0] } };
const V_RATIO_JITTER: Variant = { id: "ratioJitter", name: "舊 jitter 單位（EXP-002 前）", opts: { jitterUnit: "ratio", jitter: 0.3 } };

// ============================== 模擬 ==============================

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PersonStat { person: Person; workDays: number; shifts: number; gray: number }

interface RunResult {
  days: number;
  skippedDays: number;
  gaps: number;
  violations: string[];
  people: PersonStat[];
  maxMs: number;
  totalMs: number;
  maxGray7: number;
}

function runScenario(sc: Scenario, seed: number, opts: GenerateOptions, days = 30, start = "2026-11-01"): RunResult {
  // 出勤由情境的 seed 決定，與演算法版本無關 → 不同版本比較的是「同一組出勤」
  const rand = rng(seed);
  const stats: PersonStat[] = sc.people.map((p) => ({ person: p, workDays: 0, shifts: 0, gray: 0 }));
  const history: HistoryAssignment[] = [];
  const r: RunResult = { days, skippedDays: 0, gaps: 0, violations: [], people: stats, maxMs: 0, totalMs: 0, maxGray7: 0 };

  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const onBase = stats.filter(({ person: p }) =>
      d >= (p.joinDay ?? 0) && d < (p.leaveDay ?? Infinity) && !(p.vacation && d >= p.vacation[0] && d < p.vacation[1]));
    const n = sc.dailyHeadcount?.(d, rand, onBase.length);
    const avail = n !== undefined
      ? [...onBase].sort(() => rand() - 0.5).slice(0, n)
      : onBase.filter((s) => sc.available(s.person, stats.indexOf(s), d, date, rand));
    if (!checkMinimumManpower(avail.map((s) => s.person)).ok) { r.skippedDays++; continue; }
    avail.forEach((s) => s.workDays++);

    const cands: Candidate[] = avail.map((s) => ({
      id: s.person.id, name: s.person.id, qualification: s.person.qualification,
      workDays: s.workDays, shiftCount: s.shifts, grayCount: s.gray,
    }));
    const recent = history.filter((h) => h.date >= addDays(date, -2)); // 與網站相同：只提供前兩天
    const t0 = performance.now();
    const res = generateRoster(date, cands, recent, { ...opts, seed: seed * 1000 + d });
    const ms = performance.now() - t0;
    r.maxMs = Math.max(r.maxMs, ms);
    r.totalMs += ms;
    r.gaps += res.unfilled.length;

    res.roster.forEach((row, s) => {
      for (const role of ["leader", "guard"] as const) {
        const id = row[role];
        if (!id) continue;
        const st = stats.find((x) => x.person.id === id)!;
        if (!avail.includes(st)) r.violations.push(`${date} 排到未出勤的 ${id}`);
        if (role === "leader" && st.person.qualification !== "leader") r.violations.push(`${date} ${id} 不具哨長資格`);
        st.shifts++;
        if (GRAY_SHIFTS.has(s)) st.gray++;
        history.push({ date, shiftIndex: s, memberId: id });
      }
    });
  }

  // ---- 獨立 checker：以「小時」為單位，不使用 scheduler 的任何邏輯 ----
  const hourOf = (h: HistoryAssignment) => Math.round((Date.parse(h.date) - Date.parse(start)) / 3_600_000) + h.shiftIndex * 2;
  for (const { person } of stats) {
    const mine = history.filter((h) => h.memberId === person.id).sort((a, b) => hourOf(a) - hourOf(b));
    for (let i = 1; i < mine.length; i++) {
      const rest = hourOf(mine[i]) - (hourOf(mine[i - 1]) + 2);
      if (rest < 6) r.violations.push(`${person.id} 只休 ${rest} 小時（${mine[i - 1].date} → ${mine[i].date}）`);
    }
    const grayDays = new Set(mine.filter((h) => GRAY_SHIFTS.has(h.shiftIndex)).map((h) => h.date));
    for (let d = 0; d < days; d++) {
      const dd = addDays(start, d);
      if (grayDays.has(dd) && grayDays.has(addDays(dd, 1)) && grayDays.has(addDays(dd, 2)))
        r.violations.push(`${person.id} 連續三天灰色（${dd} 起）`);
      let c = 0;
      for (let k = 0; k < 7; k++) if (grayDays.has(addDays(dd, k))) c++;
      r.maxGray7 = Math.max(r.maxGray7, c);
    }
  }
  return r;
}

// ============================== 月結算 ==============================

interface Settlement {
  sdDev: number;     // 每人「實際 − 應得」節數的 RMS
  maxDev: number;
  sdGray: number;
  maxGray: number;
  gini: number;      // 每人「節數 / 上班天」的 Gini
  giniGray: number;
  chi: ChiSquareResult;
  chiGray: ChiSquareResult | null;
  leaderRates: number[];
  guardRates: number[];
}

function settle(r: RunResult): Settlement {
  const ps = r.people.filter((p) => p.workDays > 0);
  const totalW = ps.reduce((a, p) => a + p.workDays, 0);
  const rate = ps.reduce((a, p) => a + p.shifts, 0) / totalW;
  const grayRate = ps.reduce((a, p) => a + p.gray, 0) / totalW;
  const dev = ps.map((p) => p.shifts - p.workDays * rate);
  const gdev = ps.map((p) => p.gray - p.workDays * grayRate);
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
  return {
    sdDev: rms(dev), maxDev: Math.max(...dev.map(Math.abs)),
    sdGray: rms(gdev), maxGray: Math.max(...gdev.map(Math.abs)),
    gini: gini(ps.map((p) => p.shifts / p.workDays)),
    giniGray: gini(ps.map((p) => p.gray / p.workDays)),
    chi: chiSquareGOF(ps.map((p) => p.shifts), ps.map((p) => p.workDays * rate)),
    chiGray: grayRate > 0 ? chiSquareGOF(ps.map((p) => p.gray), ps.map((p) => p.workDays * grayRate)) : null,
    leaderRates: ps.filter((p) => p.person.qualification === "leader").map((p) => p.shifts / p.workDays),
    guardRates: ps.filter((p) => p.person.qualification === "guard").map((p) => p.shifts / p.workDays),
  };
}

interface Agg { runs: RunResult[]; sets: Settlement[] }

function aggregate(sc: Scenario, variant: Variant, seeds: number[]): Agg {
  const runs = seeds.map((seed) => runScenario(sc, seed, variant.opts));
  return { runs, sets: runs.map(settle) };
}

// ============================== 輸出格式 ==============================

const f = (x: number, d = 2) => x.toFixed(d);
const mci = (xs: number[], d = 2) => `${f(mean(xs), d)} ± ${f(ci95(xs), d)}`;
const pFmt = (p: number) => (p < 0.001 ? "< 0.001" : f(p, 3));
const table = (header: string[], rows: string[][]) =>
  [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const seedList = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const progress = (msg: string) => process.stderr.write(msg + "\n");

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
  const seedsArg = args.indexOf("--seeds");
  const only = args.filter((a) => /^S\d+$/.test(a));
  const scenarios = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;

  if (args.includes("--check")) {
    const n = seedsArg >= 0 ? Number(args[seedsArg + 1]) : 10;
    if (checkMode(scenarios, n)) process.exitCode = 1;
  } else if (args.includes("--ablation")) {
    ablationMode(scenarios, seedsArg >= 0 ? Number(args[seedsArg + 1]) : 30);
  } else {
    const n = seedsArg >= 0 ? Number(args[seedsArg + 1]) : 30;
    if (reportMode(scenarios, n, !only.length)) process.exitCode = 1;
  }
}

main();
