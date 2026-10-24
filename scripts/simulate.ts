/**
 * 情境模擬（Scenario-based simulation）
 *
 * 每個情境連續排一個月（30 天），以多個 random seed 重複執行，最後做「月結算」：
 *   - 硬性規定：以獨立實作、以小時計算的 checker 重新驗證
 *   - 公平性：每人「實際節數 − 應得節數」，應得 = 上班天數 × 全單位平均（節 / 上班天）
 *   - 灰色時段公平性：同上，只計灰色時段
 *   - 空缺、單日運算時間
 *
 *   npm run simulate                 # 全部情境，輸出表格並寫入 docs/simulation-report.md
 *   npm run simulate -- S4 S6        # 只跑指定情境
 */
import { writeFileSync } from "node:fs";
import {
  addDays, checkMinimumManpower, generateRoster, GRAY_SHIFTS, SHIFTS_PER_DAY,
  type Candidate, type HistoryAssignment, type Qualification,
} from "../lib/scheduler.ts";

// ============================== 情境定義 ==============================

interface Person {
  id: string;
  qualification: Qualification;
  /** 第幾天報到（含），預設 0 */
  joinDay?: number;
  /** 第幾天起離營（不含），預設不離營 */
  leaveDay?: number;
  /** 長假區間 [start, end)（以天為單位） */
  vacation?: [number, number];
}

interface Scenario {
  id: string;
  name: string;
  desc: string;
  people: Person[];
  /** 某人某天是否可動用（已排除報到前 / 離營後 / 長假） */
  available: (p: Person, idx: number, day: number, date: string, rand: () => number) => boolean;
  /** 若回傳數字，代表當天要從在營人員中隨機抽出幾人可動用（覆蓋 available） */
  dailyHeadcount?: (day: number, rand: () => number, onBase: number) => number;
}

function makePeople(leaders: number, guards: number, extra: (i: number) => Partial<Person> = () => ({})): Person[] {
  const quals: Qualification[] = [...Array(leaders).fill("leader"), ...Array(guards).fill("guard")];
  return quals.map((q, i) => ({ id: `p${String(i).padStart(2, "0")}`, qualification: q, ...extra(i) }));
}

const randomLeave = (prob: number) => (_p: Person, _i: number, _d: number, _date: string, rand: () => number) => rand() >= prob;
const weekday = (date: string) => new Date(date + "T00:00:00Z").getUTCDay(); // 0 = 週日

export const SCENARIOS: Scenario[] = [
  {
    id: "S1", name: "標準單位", desc: "30 人（哨長 18／僅槍兵 12），每天 20% 隨機休假",
    people: makePeople(18, 12), available: randomLeave(0.2),
  },
  {
    id: "S2", name: "小單位", desc: "12 人（7／5），每天 10% 隨機休假",
    people: makePeople(7, 5), available: randomLeave(0.1),
  },
  {
    id: "S3", name: "大單位", desc: "50 人（27／23），每天 30% 隨機休假",
    people: makePeople(27, 23), available: randomLeave(0.3),
  },
  {
    id: "S4", name: "極限 8 人全勤", desc: "8 人（5／3），全月無休，正好是最低門檻",
    people: makePeople(5, 3), available: () => true,
  },
  {
    id: "S5", name: "10 人全勤", desc: "10 人（6／4），全月無休",
    people: makePeople(6, 4), available: () => true,
  },
  {
    id: "S6", name: "哨長稀缺", desc: "20 人但只有 4 位哨長（哨長全勤，僅槍兵 20% 休假）",
    people: makePeople(4, 16),
    available: (p, _i, _d, _date, rand) => p.qualification === "leader" || rand() >= 0.2,
  },
  {
    id: "S7", name: "全員哨長", desc: "20 人全部具哨長資格，20% 休假（無資格限制）",
    people: makePeople(20, 0), available: randomLeave(0.2),
  },
  {
    id: "S8", name: "週末大休", desc: "30 人（18／12），平日 10% 休假、週末 60% 休假",
    people: makePeople(18, 12),
    available: (_p, _i, _d, date, rand) => rand() >= ([0, 6].includes(weekday(date)) ? 0.6 : 0.1),
  },
  {
    id: "S9", name: "長假", desc: "25 人（15／10），其中 7 人各休 10 天長假（時段錯開），其餘 10% 休假",
    people: makePeople(15, 10, (i) => (i % 4 === 0 ? { vacation: [(i * 3) % 20, (i * 3) % 20 + 10] as [number, number] } : {})),
    available: randomLeave(0.1),
  },
  {
    id: "S10", name: "中途報到／離營", desc: "25 人（15／10），5 人第 16 天才報到、3 人第 11 天起離營",
    people: makePeople(15, 10, (i) => (i >= 20 ? { joinDay: 15 } : i < 3 ? { leaveDay: 10 } : {})),
    available: randomLeave(0.1),
  },
  {
    id: "S11", name: "出勤劇烈波動", desc: "30 人（18／12），每天可動用人數在 8～30 之間隨機",
    people: makePeople(18, 12), available: () => true,
    dailyHeadcount: (_d, rand, onBase) => Math.min(onBase, 8 + Math.floor(rand() * 23)),
  },
  {
    id: "S12", name: "固定輪休（上 5 休 2）", desc: "21 人（13／8），每人每週固定連休 2 天、彼此錯開",
    people: makePeople(13, 8),
    available: (_p, i, d) => { const k = (d + i) % 7; return k !== 5 && k !== 6; },
  },
];

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

export interface RunResult {
  days: number;
  skippedDays: number;
  gaps: number;
  incompleteDays: number;
  violations: string[];
  people: PersonStat[];
  maxMs: number;
  totalMs: number;
  maxGray7: number;      // 任 7 天內最多幾天站灰色
  threeShiftDays: number; // 有人一天站滿 3 班的人次
}

export function runScenario(sc: Scenario, seed: number, days = 30, start = "2026-11-01"): RunResult {
  const rand = rng(seed);
  const stats: PersonStat[] = sc.people.map((p) => ({ person: p, workDays: 0, shifts: 0, gray: 0 }));
  const history: HistoryAssignment[] = [];
  const r: RunResult = { days, skippedDays: 0, gaps: 0, incompleteDays: 0, violations: [], people: stats, maxMs: 0, totalMs: 0, maxGray7: 0, threeShiftDays: 0 };

  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const onBase = stats.filter(({ person: p }) =>
      d >= (p.joinDay ?? 0) && d < (p.leaveDay ?? Infinity) && !(p.vacation && d >= p.vacation[0] && d < p.vacation[1]));
    let avail: PersonStat[];
    const n = sc.dailyHeadcount?.(d, rand, onBase.length);
    if (n !== undefined) {
      avail = [...onBase].sort(() => rand() - 0.5).slice(0, n);
    } else {
      avail = onBase.filter((s) => sc.available(s.person, stats.indexOf(s), d, date, rand));
    }
    if (!checkMinimumManpower(avail.map((s) => s.person)).ok) { r.skippedDays++; continue; }
    avail.forEach((s) => s.workDays++);

    const cands: Candidate[] = avail.map((s) => ({
      id: s.person.id, name: s.person.id, qualification: s.person.qualification,
      workDays: s.workDays, shiftCount: s.shifts, grayCount: s.gray,
    }));
    // 與網站相同：只提供前後兩天的歷史
    const recent = history.filter((h) => h.date >= addDays(date, -2));
    const t0 = performance.now();
    const res = generateRoster(date, cands, recent, { seed: seed * 1000 + d });
    const ms = performance.now() - t0;
    r.maxMs = Math.max(r.maxMs, ms);
    r.totalMs += ms;
    if (!res.complete) { r.incompleteDays++; r.gaps += res.unfilled.length; }

    const today = new Map<string, number>();
    res.roster.forEach((row, s) => {
      for (const role of ["leader", "guard"] as const) {
        const id = row[role];
        if (!id) continue;
        const st = stats.find((x) => x.person.id === id)!;
        if (!avail.includes(st)) r.violations.push(`${date} 排到未出勤的 ${id}`);
        if (role === "leader" && st.person.qualification !== "leader") r.violations.push(`${date} ${id} 不具哨長資格`);
        st.shifts++;
        if (GRAY_SHIFTS.has(s)) st.gray++;
        today.set(id, (today.get(id) ?? 0) + 1);
        history.push({ date, shiftIndex: s, memberId: id });
      }
    });
    r.threeShiftDays += [...today.values()].filter((v) => v >= 3).length;
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

export interface Settlement {
  /** 每人「實際 − 應得」節數的最大絕對值 */
  maxDev: number;
  /** 同上的標準差 */
  sdDev: number;
  maxGrayDev: number;
  sdGrayDev: number;
  /** 哨長平均負擔 ÷ 僅槍兵平均負擔（節 / 上班天） */
  leaderGuardRatio: number | null;
}

export function settle(r: RunResult): Settlement {
  const ps = r.people.filter((p) => p.workDays > 0);
  const totalW = ps.reduce((a, p) => a + p.workDays, 0);
  const rate = ps.reduce((a, p) => a + p.shifts, 0) / totalW;
  const grayRate = ps.reduce((a, p) => a + p.gray, 0) / totalW;
  const dev = ps.map((p) => p.shifts - p.workDays * rate);
  const gdev = ps.map((p) => p.gray - p.workDays * grayRate);
  const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
  const avgRate = (q: Qualification) => {
    const g = ps.filter((p) => p.person.qualification === q);
    return g.length ? g.reduce((a, p) => a + p.shifts, 0) / g.reduce((a, p) => a + p.workDays, 0) : null;
  };
  const l = avgRate("leader");
  const g = avgRate("guard");
  return {
    maxDev: Math.max(...dev.map(Math.abs)), sdDev: sd(dev),
    maxGrayDev: Math.max(...gdev.map(Math.abs)), sdGrayDev: sd(gdev),
    leaderGuardRatio: l !== null && g !== null && g > 0 ? l / g : null,
  };
}

// ============================== 執行 ==============================

const SEEDS = [1, 2, 3, 4, 5];

function main() {
  const only = process.argv.slice(2).filter((a) => /^S\d+$/.test(a));
  const list = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  const rows: string[][] = [];
  let totalViolations = 0;

  for (const sc of list) {
    const runs = SEEDS.map((seed) => runScenario(sc, seed));
    const sets = runs.map(settle);
    const avg = (f: (x: Settlement) => number) => sets.reduce((a, s) => a + f(s), 0) / sets.length;
    const worst = (f: (x: Settlement) => number) => Math.max(...sets.map(f));
    const v = runs.reduce((a, r) => a + r.violations.length, 0);
    totalViolations += v;
    if (v) console.error(`[${sc.id}] 違規：`, runs.flatMap((r) => r.violations).slice(0, 5));
    const ratios = sets.map((s) => s.leaderGuardRatio).filter((x): x is number => x !== null);
    rows.push([
      sc.id, sc.name,
      String(v),
      (runs.reduce((a, r) => a + r.gaps, 0) / runs.length).toFixed(1),
      (runs.reduce((a, r) => a + r.skippedDays, 0) / runs.length).toFixed(1),
      `${avg((s) => s.sdDev).toFixed(2)} / ${worst((s) => s.maxDev).toFixed(1)}`,
      `${avg((s) => s.sdGrayDev).toFixed(2)} / ${worst((s) => s.maxGrayDev).toFixed(1)}`,
      String(Math.max(...runs.map((r) => r.maxGray7))),
      ratios.length ? (ratios.reduce((a, x) => a + x, 0) / ratios.length).toFixed(2) : "—",
      `${(runs.reduce((a, r) => a + r.totalMs, 0) / runs.reduce((a, r) => a + r.days - r.skippedDays, 0)).toFixed(0)} / ${Math.max(...runs.map((r) => r.maxMs)).toFixed(0)}`,
    ]);
    process.stderr.write(`${sc.id} done\n`);
  }

  const header = ["ID", "情境", "違規", "空缺/月", "跳過天數", "節數偏差 SD / 最大", "灰色偏差 SD / 最大", "7日內最多灰色天", "哨長÷槍兵負擔", "ms/天 平均 / 最大"];
  const md = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
  console.log("\n" + md + "\n");

  if (!only.length) {
    const doc = `# 情境模擬報告

> 由 \`npm run simulate\` 自動產生。每個情境排 30 天，以 ${SEEDS.length} 個 random seed 重複執行。

## 情境

${SCENARIOS.map((s) => `- **${s.id} ${s.name}**：${s.desc}`).join("\n")}

## 結果

${md}

## 欄位說明

- **違規**：獨立 checker（以小時計算）找到的硬性規定違規數，5 次合計，必須為 0。
- **空缺/月**：每月平均有幾格排不出人。
- **跳過天數**：可動用人力低於最低門檻、系統拒絕排哨的天數（每月平均）。
- **節數偏差**：月結算時每人「實際節數 − 應得節數」，應得 = 上班天數 × 全單位平均（節／上班天）。
  SD 為 5 次平均，最大為 5 次中最差的一人。
- **灰色偏差**：同上，只計灰色時段（00–06、12–14）。
- **7 日內最多灰色天**：任一人在任意連續 7 天中，最多有幾天站到灰色時段。
- **哨長÷槍兵負擔**：哨長平均每上班天的節數 ÷ 僅槍兵的。1.00 代表兩種資格負擔相同。
- **ms/天**：產生一天哨表的運算時間（使用者按下「生成哨表」後要等多久）。
`;
    writeFileSync(new URL("../docs/simulation-report.md", import.meta.url), doc);
    console.log("已寫入 docs/simulation-report.md");
  }
  if (totalViolations) process.exitCode = 1;
}

main();
