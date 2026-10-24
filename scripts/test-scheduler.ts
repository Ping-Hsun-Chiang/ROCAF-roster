/**
 * 排哨演算法模擬測試：連續排 N 天，每天隨機有人休假，
 * 用一套「獨立實作」的檢查器驗證所有硬性限制，並印出公平值分布。
 *   npm run test:scheduler
 */
import {
  addDays, checkMinimumManpower, generateRoster, GRAY_SHIFTS, validateRoster,
  type Candidate, type HistoryAssignment, type Qualification,
} from "../lib/scheduler.ts";

function rng(seed: number) {
  let a = seed;
  return () => ((a = (a * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function simulate(label: string, quals: Qualification[], days: number, offProb: number, seed: number) {
  const rand = rng(seed);
  const people = quals.map((q, i) => ({ id: `p${i}`, name: `P${i}`, qualification: q, workDays: 0, shiftCount: 0 }));
  const history: HistoryAssignment[] = [];
  let date = "2026-11-01";
  let incompleteDays = 0;
  let blanks = 0;
  let skipped = 0;

  for (let d = 0; d < days; d++, date = addDays(date, 1)) {
    const avail = people.filter(() => rand() > offProb);
    if (!checkMinimumManpower(avail).ok) { skipped++; continue; }
    avail.forEach((p) => p.workDays++);
    const res = generateRoster(date, avail.map((p) => ({ ...p })) as Candidate[], history, { seed: seed + d });
    if (!res.complete) { incompleteDays++; blanks += res.unfilled.length; }
    const v = validateRoster(date, res.roster, avail, history);
    if (v.violations.length) throw new Error(`${date} validateRoster 與演算法不一致：${JSON.stringify(v.violations)}`);
    if (v.vacancies.length !== res.unfilled.length) throw new Error(`${date} 空缺數不一致`);
    res.roster.forEach((row, s) => {
      for (const role of ["leader", "guard"] as const) {
        const id = row[role];
        if (!id) continue;
        const p = people.find((x) => x.id === id)!;
        if (!avail.includes(p)) throw new Error(`${date} 排到未上班的人 ${id}`);
        if (p.qualification === "guard" && role === "leader") throw new Error(`${date} 資格不符 ${id}`);
        p.shiftCount++;
        history.push({ date, shiftIndex: s, memberId: id });
      }
    });
  }

  // ---- 獨立檢查：以小時為單位計算 ----
  const toHour = (h: HistoryAssignment) => {
    const days = Math.round((Date.parse(h.date) - Date.parse("2026-11-01")) / 86_400_000);
    return days * 24 + h.shiftIndex * 2;
  };
  for (const p of people) {
    const mine = history.filter((h) => h.memberId === p.id).sort((a, b) => toHour(a) - toHour(b));
    for (let i = 1; i < mine.length; i++) {
      const restHours = toHour(mine[i]) - (toHour(mine[i - 1]) + 2);
      if (restHours < 6) throw new Error(`${p.id} 休息僅 ${restHours}h：${JSON.stringify([mine[i - 1], mine[i]])}`);
    }
    const grayDates = [...new Set(mine.filter((h) => GRAY_SHIFTS.has(h.shiftIndex)).map((h) => h.date))].sort();
    for (let i = 2; i < grayDates.length; i++) {
      if (addDays(grayDates[i - 2], 2) === grayDates[i]) throw new Error(`${p.id} 連續三天灰色：${grayDates.slice(i - 2, i + 1)}`);
    }
  }

  const ratios = people.filter((p) => p.workDays).map((p) => p.shiftCount / p.workDays);
  console.log(`\n[${label}] ${people.length} 人 × ${days} 天：硬性限制全數通過 ✓`);
  console.log(`  未完整天數 ${incompleteDays}（空缺共 ${blanks} 格）、人力不足跳過 ${skipped} 天`);
  console.log(`  公平值(節/天) min=${Math.min(...ratios).toFixed(3)} max=${Math.max(...ratios).toFixed(3)}`);
  console.log("  " + people.map((p) => `${p.name}:${p.shiftCount}/${p.workDays}`).join("  "));
}

const mixed: Qualification[] = ["leader", "leader", "leader", "leader", "leader", "leader", "leader", "guard", "guard", "guard", "guard", "guard", "leader", "guard"];
simulate("一般人力", mixed, 30, 0.2, 1);
simulate("一般人力-另一種子", mixed, 30, 0.2, 99);
simulate("極限 8 人全勤", ["leader", "leader", "leader", "leader", "guard", "guard", "leader", "leader"], 30, 0, 7);
simulate("偏緊 10 人", ["leader", "leader", "leader", "leader", "guard", "guard", "guard", "guard", "leader", "leader"], 30, 0.1, 3);
