/**
 * 模擬核心：情境定義、演算法版本、單月模擬、獨立 checker、月結算。
 *
 * 由 simulate.ts（報告／CI）與 experiments/*.ts（各實驗的原始數據）共用。
 * 所有亂數皆由 seed 決定，相同 seed 在任何機器上都會得到相同結果。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  addDays, checkMinimumManpower, generateRoster, GRAY_SHIFTS,
  type Candidate, type GenerateOptions, type GenerateResult, type HistoryAssignment, type Qualification,
} from "../lib/scheduler.ts";
import { chiSquareGOF, gini, type ChiSquareResult } from "./stats.ts";

// ============================== 情境定義 ==============================

export interface Person {
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
export interface Expect {
  maxGaps?: number;   // 每月平均空缺上限
  maxSdDev?: number;  // 月結算節數偏差 SD（seed 平均）上限
  maxSdGray?: number; // 灰色偏差 SD 上限
  minChiPass?: number; // χ² 上尾檢定 p ≥ 0.05 的 run 比例下限
}

export interface Scenario {
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

export function makePeople(leaders: number, guards: number, extra: (i: number) => Partial<Person> = () => ({})): Person[] {
  const quals: Qualification[] = [...Array(leaders).fill("leader"), ...Array(guards).fill("guard")];
  return quals.map((q, i) => ({ id: `p${String(i).padStart(2, "0")}`, qualification: q, ...extra(i) }));
}

export const randomLeave = (prob: number) => (_p: Person, _i: number, _d: number, _date: string, rand: () => number) => rand() >= prob;
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

export interface Variant { id: string; name: string; opts: GenerateOptions }

export const V_CURRENT: Variant = { id: "current", name: "現行版本", opts: {} };
export const V_RANDOM: Variant = { id: "random", name: "對照組（只守硬性規定、隨機排人）", opts: { randomOrder: true } };
export const V_NO_GRAY: Variant = { id: "noGray", name: "移除灰色公平值（EXP-001 前）", opts: { grayWeight: 0, grayRecentPenalty: [0.5, 0] } };
export const V_RATIO_JITTER: Variant = { id: "ratioJitter", name: "舊 jitter 單位（EXP-002 前）", opts: { jitterUnit: "ratio", jitter: 0.3 } };
export const VARIANTS = [V_CURRENT, V_RANDOM, V_NO_GRAY, V_RATIO_JITTER];

// ============================== 模擬 ==============================

/** mulberry32：小而快、可重現的 PRNG */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PersonStat { person: Person; workDays: number; shifts: number; gray: number }

export interface RunResult {
  days: number;
  skippedDays: number;
  gaps: number;
  violations: string[];
  people: PersonStat[];
  maxMs: number;
  totalMs: number;
  maxGray7: number;
}

export interface RunHooks {
  /** 每天排完後呼叫，供個別實驗收集額外指標 */
  onDay?: (date: string, res: GenerateResult, avail: PersonStat[]) => void;
}

export function runScenario(sc: Scenario, seed: number, opts: GenerateOptions, days = 30, start = "2026-11-01", hooks: RunHooks = {}): RunResult {
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
    hooks.onDay?.(date, res, avail);

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

export interface Settlement {
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

export function settle(r: RunResult): Settlement {
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

export interface Agg { runs: RunResult[]; sets: Settlement[] }

export function aggregate(sc: Scenario, variant: Variant, seeds: number[]): Agg {
  const runs = seeds.map((seed) => runScenario(sc, seed, variant.opts));
  return { runs, sets: runs.map(settle) };
}

// ============================== 共用輸出工具 ==============================

export const seedList = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
export const progress = (msg: string) => process.stderr.write(msg + "\n");
export const f = (x: number, d = 2) => x.toFixed(d);
export const table = (header: string[], rows: string[][]) =>
  [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** 讀取 `--seeds N`，未指定時回傳預設值 */
export function seedsArg(args: string[], fallback: number): number {
  const i = args.indexOf("--seeds");
  return i >= 0 ? Number(args[i + 1]) : fallback;
}

// ============================== 原始數據（CSV）輸出 ==============================

export type CsvRow = Array<string | number | boolean>;

const num = (x: number) => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(12))));
const cell = (v: string | number | boolean) =>
  typeof v === "number" ? num(v) : typeof v === "boolean" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/** 輸出 CSV 字串。數值以 12 位有效數字表示，不含執行時間等與機器有關的欄位，確保不同機器產生相同檔案 */
export const csv = (header: string[], rows: CsvRow[]) =>
  [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";

/** 寫入 docs/experiments/data/<exp>/<name>.csv */
export function writeData(exp: string, files: Record<string, [string[], CsvRow[]]>) {
  const dir = new URL(`../docs/experiments/data/${exp}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [name, [header, rows]] of Object.entries(files)) writeFileSync(new URL(`${name}.csv`, dir), csv(header, rows));
  progress(`已寫入 docs/experiments/data/${exp}/（${Object.keys(files).map((n) => `${n}.csv`).join("、")}）`);
}

export const PERSON_COLUMNS = ["person", "qualification", "work_days", "shifts", "gray"];
/** 一個 run 中每個人的月結算，前面加上識別欄位 */
export const personRows = (r: RunResult, key: CsvRow): CsvRow[] =>
  r.people.map((p) => [...key, p.person.id, p.person.qualification, p.workDays, p.shifts, p.gray]);
