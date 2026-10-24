/**
 * 營區站哨排班演算法（純函式、無外部依賴，前後端與測試皆可直接引用）
 *
 * ─────────────────────────────────────────────────────────────────────
 * 問題建模（CSP）
 *   變數：一天 12 班 × 2 個位置（哨長 / 槍兵）= 24 個 slot
 *   值域：今日可動用的人員
 *   硬性限制：
 *     H1 資格吻合   哨長位 ← 哨長；槍兵位 ← 哨長或僅槍兵（哨長可兼任槍兵）
 *     H2 歇哨時間   站完 2 小時至少休 6 小時（含跨日）
 *     H3 灰色時段   不可連續三天被排到 00-02 / 02-04 / 04-06 / 12-14
 *     （H0 同班不可兼任兩個位置 —— 已被 H2 涵蓋，因為同班時間差為 0）
 *   軟性限制：
 *     S1 公平值 = 當月已站哨節數 / 當月已上班天數，越低越優先，並帶隨機擾動
 *     S2 灰色公平值 = 當月灰色節數 / 當月已上班天數 —— 排灰色班時越低越優先，
 *        避免「總節數平均、但灰色時段總落在同幾個人身上」
 *
 * ─────────────────────────────────────────────────────────────────────
 * 時間軸：「絕對班次索引」(absolute slot)
 *   把每一班換算成以「本次排班日 00:00」為原點的整數：
 *       abs = dayOffset(排班日 → 該班日期) × 12 + shiftIndex
 *   例：昨天 22-24 班 → (-1)×12 + 11 = -1；今天 00-02 班 → 0；明天 00-02 → 12
 *
 *   【H2 歇哨 6 小時的跨日檢測】
 *   一班 2 小時 + 休息 6 小時 = 下一次上哨最早在 8 小時後 = 4 個班次之後。
 *   因此同一人的任兩班必須滿足 |abs₁ - abs₂| ≥ 4（MIN_GAP）。
 *   因為昨天的班次被換算成負數，「昨天 22-24 站完 → 今天最早 06-08 才能上」
 *   就自然變成 |0 - (-1)| = 1 < 4 ✗ … |3 - (-1)| = 4 ✓，完全不需要寫特例。
 *   若「明天」的哨表已存在（例如回頭重排今天），同一套公式也會往後檢查。
 *   附帶效果：單日 12 班內同一人最多 3 班（0,4,8），與題目的「單人單日最多 3 班」一致。
 *
 *   【H3 不連續三天灰色時段的跨日檢測】
 *   對每位人員建立「有站灰色時段的日期集合」grayDays（來自歷史紀錄 + 今天已排入的班）。
 *   想把某人排進今天(D)的灰色班時，檢查所有包含 D 的三天窗口：
 *       (D-2, D-1, D)、(D-1, D, D+1)、(D, D+1, D+2)
 *   只要任一窗口在「加入 D 之後」三天全是灰色，就禁止。
 *   一般情況只會有過去資料（讀昨天、前天），所以實際生效的是第一個窗口；
 *   後兩個窗口是為了「補排／重排過去某天」時也不會破壞已存在的未來哨表。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 搜尋策略
 *   Phase 1：回溯搜尋 + MRV（每次挑「可用人選最少」的 slot 先填），
 *            候選人依公平值排序（加隨機擾動）。限制節點數避免卡死。
 *   Phase 2：若 Phase 1 在上限內找不到完整解（人力極緊或歷史限制太多），
 *            改跑多輪隨機貪婪，保留「空缺最少」的結果，空缺附上原因交由人工微調。
 */

// ============================== 型別 ==============================

/** leader = 哨長（可兼任槍兵）；guard = 僅能擔任槍兵 */
export type Qualification = "leader" | "guard";
export type Role = "leader" | "guard";

export const SHIFTS_PER_DAY = 12;
export const ROLES: Role[] = ["leader", "guard"];
/** 灰色時段：00-02, 02-04, 04-06, 12-14 */
export const GRAY_SHIFTS: ReadonlySet<number> = new Set([0, 1, 2, 6]);
/** 2 小時班 + 6 小時休 = 8 小時 = 4 個班次 */
export const MIN_GAP = 4;
/** 連續幾天灰色即違規 */
export const GRAY_STREAK_LIMIT = 3;

export const ROLE_LABEL: Record<Role, string> = { leader: "哨長", guard: "槍兵" };
export const QUAL_LABEL: Record<Qualification, string> = { leader: "哨長", guard: "僅槍兵" };

export function shiftLabel(i: number): string {
  const p = (h: number) => String(h).padStart(2, "0");
  return `${p(i * 2)}:00-${p(i * 2 + 2)}:00`;
}

export interface Candidate {
  id: string;
  name: string;
  qualification: Qualification;
  /** 當月已上班天數（已包含本次勤務日） */
  workDays: number;
  /** 當月已站哨節數（不含本次勤務日） */
  shiftCount: number;
  /** 當月已站灰色時段節數（不含本次勤務日） */
  grayCount?: number;
}

/** 其他日期已存在的哨表紀錄（至少需包含 D-2 ~ D+2） */
export interface HistoryAssignment {
  date: string; // YYYY-MM-DD
  shiftIndex: number;
  memberId: string;
}

/** 一天的哨表：roster[shiftIndex][role] = memberId | null */
export type Roster = Array<Record<Role, string | null>>;

export interface Violation {
  shiftIndex: number;
  role: Role;
  memberId: string | null;
  message: string;
}

export interface GenerateOptions {
  /** 固定亂數種子，方便重現結果 */
  seed?: number;
  /** 隨機擾動幅度（單位：節）。月累計節數差距小於此值的人會被隨機打散 */
  jitter?: number;
  /** Phase 1 回溯搜尋節點上限 */
  maxNodes?: number;
  /** Phase 2 貪婪重試次數 */
  greedyRestarts?: number;
  /** 預先鎖定的格子（人工指定），演算法不會更動 */
  locked?: Roster;

  // ---- 以下僅供實驗（ablation study / 對照組）使用，網站一律用預設值 ----
  /** 灰色公平值權重，預設 3；0 = 停用（EXP-001 之前的行為） */
  grayWeight?: number;
  /** 昨天、前天站過灰色的扣分，預設 [0.5, 0.3] */
  grayRecentPenalty?: [number, number];
  /** 擾動單位：預設 "shift"（節）；"ratio" 為 EXP-002 之前以公平值為單位的舊行為 */
  jitterUnit?: "shift" | "ratio";
  /** 對照組：候選人完全隨機排序，只遵守硬性規定、不考慮任何公平性 */
  randomOrder?: boolean;
}

export interface GenerateResult {
  roster: Roster;
  complete: boolean;
  /** 無法排入的空缺與原因 */
  unfilled: Violation[];
}

// ============================== 工具 ==============================

export function emptyRoster(): Roster {
  return Array.from({ length: SHIFTS_PER_DAY }, () => ({ leader: null, guard: null }));
}

/** YYYY-MM-DD 之間相差幾天（b - a），以 UTC 計算避免時區/日光節約誤差 */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 哨長兩個位置都能站；僅槍兵只能站槍兵位 */
export function canFill(q: Qualification, role: Role): boolean {
  return q !== "guard" || role === "guard";
}

/** mulberry32：小型可設種子的 PRNG */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================== 限制狀態 ==============================

/**
 * 每位人員的時間佔用狀態。
 *   absSlots : 所有已知班次的絕對索引（歷史 + 今天已排）
 *   grayDays : 有站灰色時段的「相對日」(相對排班日的天數差) → 該日灰色班數
 */
interface PersonState {
  absSlots: number[];
  grayDays: Map<number, number>;
  todayCount: number;
  todayGray: number;
}

class ConstraintState {
  private people = new Map<string, PersonState>();

  constructor(date: string, history: HistoryAssignment[]) {
    for (const h of history) {
      const off = dayDiff(date, h.date);
      if (off === 0) continue; // 當天的舊哨表會被覆蓋，不列入歷史
      this.add(h.memberId, off * SHIFTS_PER_DAY + h.shiftIndex, off, h.shiftIndex, false);
    }
  }

  private get(id: string): PersonState {
    let p = this.people.get(id);
    if (!p) {
      p = { absSlots: [], grayDays: new Map(), todayCount: 0, todayGray: 0 };
      this.people.set(id, p);
    }
    return p;
  }

  private add(id: string, abs: number, dayOff: number, shiftIndex: number, today: boolean) {
    const p = this.get(id);
    p.absSlots.push(abs);
    if (GRAY_SHIFTS.has(shiftIndex)) p.grayDays.set(dayOff, (p.grayDays.get(dayOff) ?? 0) + 1);
    if (today) {
      p.todayCount++;
      if (GRAY_SHIFTS.has(shiftIndex)) p.todayGray++;
    }
  }

  place(id: string, shiftIndex: number) {
    this.add(id, shiftIndex, 0, shiftIndex, true);
  }

  unplace(id: string, shiftIndex: number) {
    const p = this.get(id);
    const k = p.absSlots.lastIndexOf(shiftIndex);
    if (k >= 0) p.absSlots.splice(k, 1);
    if (GRAY_SHIFTS.has(shiftIndex)) {
      const n = (p.grayDays.get(0) ?? 1) - 1;
      if (n <= 0) p.grayDays.delete(0);
      else p.grayDays.set(0, n);
      p.todayGray--;
    }
    p.todayCount--;
  }

  /** 此人在相對日 dayOff 是否有站灰色時段 */
  hadGray(id: string, dayOff: number): boolean {
    return this.people.get(id)?.grayDays.has(dayOff) ?? false;
  }

  todayCount(id: string): number {
    return this.people.get(id)?.todayCount ?? 0;
  }

  todayGray(id: string): number {
    return this.people.get(id)?.todayGray ?? 0;
  }

  /** H2：與此人任何已知班次的距離是否都 ≥ MIN_GAP（自動涵蓋昨天尾班 / 明天首班） */
  restOk(id: string, shiftIndex: number): boolean {
    const p = this.people.get(id);
    if (!p) return true;
    return p.absSlots.every((a) => Math.abs(a - shiftIndex) >= MIN_GAP);
  }

  /** H3：若把今天(相對日 0)標為灰色，是否會出現連續 3 天灰色 */
  grayOk(id: string, shiftIndex: number): boolean {
    if (!GRAY_SHIFTS.has(shiftIndex)) return true;
    const p = this.people.get(id);
    if (!p) return true;
    const isGray = (d: number) => d === 0 || p.grayDays.has(d);
    // 所有包含今天的三日窗口：起點為 -2, -1, 0
    for (let start = -(GRAY_STREAK_LIMIT - 1); start <= 0; start++) {
      let all = true;
      for (let d = start; d < start + GRAY_STREAK_LIMIT; d++) {
        if (!isGray(d)) { all = false; break; }
      }
      if (all) return false;
    }
    return true;
  }

  /** 回傳不可排入的原因；可排入則回傳 null */
  reason(c: Candidate, shiftIndex: number, role: Role): string | null {
    if (!canFill(c.qualification, role)) return `${c.name} 不具${ROLE_LABEL[role]}資格`;
    if (!this.restOk(c.id, shiftIndex)) return `${c.name} 未滿 6 小時歇哨`;
    if (!this.grayOk(c.id, shiftIndex)) return `${c.name} 將連續三天站灰色時段`;
    return null;
  }
}

// ============================== 主演算法 ==============================

/**
 * 產生一天的哨表。
 * @param date        勤務日期 YYYY-MM-DD
 * @param candidates  今日可動用人員（含當月統計）
 * @param history     其他日期的哨表紀錄（建議 D-2 ~ D+2）
 */
export function generateRoster(
  date: string,
  candidates: Candidate[],
  history: HistoryAssignment[],
  opts: GenerateOptions = {},
): GenerateResult {
  const rng = makeRng(opts.seed ?? (Date.now() ^ (Math.random() * 2 ** 31)));
  const jitter = opts.jitter ?? 0.5;
  const maxNodes = opts.maxNodes ?? 50_000;
  const restarts = opts.greedyRestarts ?? 300;

  // 每次生成時抽一次每人的隨機擾動 → 同分者隨機，但單次搜尋內排序穩定
  const noiseOf = (): Map<string, number> => new Map(candidates.map((c) => [c.id, rng() * jitter]));

  /**
   * S1 公平性排序鍵（越小越優先）：
   *   (當月節數 + 今日已排 + 1 + 擾動) / 上班天數 —— 「排了這班之後」的公平值
   *       擾動以「節」為單位（預設 0.5 節）再除以上班天數，因此不論月初或月底，
   *       「累計節數差不到半節的人」才會被隨機打散。若直接以公平值為單位加擾動，
   *       月底上班 20 天時 0.3 的擾動等於 6 節，會嚴重破壞公平（情境模擬實測）。
   *   + 0.15 × 今日已排       —— 同一天盡量分散給不同人
   * 若此班為灰色時段，再加上：
   *   + GRAY_WEIGHT × (當月灰色 + 今日灰色 + 1) / 上班天數   —— S2 灰色公平值
   *   + 0.5（昨天站過灰色）
   *       —— 避免灰色連續累積：昨天+今天都灰色的人，明天整天的灰色班都不能排，
   *          會讓隔天人力變緊、產生空缺。這是「為明天預留彈性」的前瞻性軟限制。
   *   + 0.3（前天站過灰色）
   *       —— 避免「灰、灰、休、灰、灰…」這種完全合規、但一直輪到同一人的模式
   */
  const grayWeight = opts.grayWeight ?? 3;
  const [penalty1, penalty2] = opts.grayRecentPenalty ?? [0.5, 0.3];
  const fairKey = (st: ConstraintState, c: Candidate, shiftIndex: number, noise: Map<string, number>) => {
    const today = st.todayCount(c.id);
    const workDays = Math.max(c.workDays, 1);
    let key =
      opts.jitterUnit === "ratio"
        ? (c.shiftCount + today + 1) / workDays + 0.15 * today + noise.get(c.id)!
        : (c.shiftCount + today + 1 + noise.get(c.id)!) / workDays + 0.15 * today;
    if (GRAY_SHIFTS.has(shiftIndex)) {
      key += (grayWeight * ((c.grayCount ?? 0) + st.todayGray(c.id) + 1)) / workDays;
      if (st.hadGray(c.id, -1)) key += penalty1;
      if (st.hadGray(c.id, -2)) key += penalty2;
    }
    return key;
  };

  /** 依公平性排序候選人；對照組則每次決策都重新隨機洗牌（Fisher-Yates） */
  const orderCandidates = (list: Candidate[], st: ConstraintState, shiftIndex: number, noise: Map<string, number>) => {
    if (opts.randomOrder) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return;
    }
    list.sort((a, b) => fairKey(st, a, shiftIndex, noise) - fairKey(st, b, shiftIndex, noise));
  };

  const slots: Array<{ shiftIndex: number; role: Role }> = [];
  for (let s = 0; s < SHIFTS_PER_DAY; s++) for (const role of ROLES) slots.push({ shiftIndex: s, role });

  /** 建立初始狀態：歷史 + 人工鎖定格 */
  const init = () => {
    const st = new ConstraintState(date, history);
    const roster = emptyRoster();
    const open: typeof slots = [];
    for (const sl of slots) {
      const lockedId = opts.locked?.[sl.shiftIndex]?.[sl.role] ?? null;
      if (lockedId) {
        roster[sl.shiftIndex][sl.role] = lockedId;
        st.place(lockedId, sl.shiftIndex);
      } else open.push(sl);
    }
    return { st, roster, open };
  };

  const options = (st: ConstraintState, sl: { shiftIndex: number; role: Role }) =>
    candidates.filter((c) => st.reason(c, sl.shiftIndex, sl.role) === null);

  // ---------- Phase 1：回溯 + MRV ----------
  {
    const { st, roster, open } = init();
    const noise = noiseOf();
    let nodes = 0;

    const solve = (remaining: typeof slots): boolean => {
      if (remaining.length === 0) return true;
      if (++nodes > maxNodes) return false;

      // MRV：挑候選最少的 slot；候選數相同時優先灰色班（較難排）
      let bestIdx = -1;
      let bestOpts: Candidate[] = [];
      for (let i = 0; i < remaining.length; i++) {
        const o = options(st, remaining[i]);
        if (o.length === 0) return false; // 剪枝：已有 slot 無解
        if (
          bestIdx < 0 ||
          o.length < bestOpts.length ||
          (o.length === bestOpts.length && GRAY_SHIFTS.has(remaining[i].shiftIndex))
        ) {
          bestIdx = i;
          bestOpts = o;
        }
      }
      const sl = remaining[bestIdx];
      const rest = remaining.filter((_, i) => i !== bestIdx);
      orderCandidates(bestOpts, st, sl.shiftIndex, noise);

      for (const c of bestOpts) {
        roster[sl.shiftIndex][sl.role] = c.id;
        st.place(c.id, sl.shiftIndex);
        if (solve(rest)) return true;
        st.unplace(c.id, sl.shiftIndex);
        roster[sl.shiftIndex][sl.role] = null;
        if (nodes > maxNodes) return false;
      }
      return false;
    };

    if (solve(open)) return { roster, complete: true, unfilled: [] };
  }

  // ---------- Phase 2：多輪隨機貪婪，保留空缺最少者 ----------
  let best: GenerateResult | null = null;
  for (let r = 0; r < restarts; r++) {
    const { st, roster, open } = init();
    const noise = noiseOf();
    const unfilled: Violation[] = [];
    let remaining = [...open];

    while (remaining.length) {
      // 同樣用 MRV 決定下一個 slot，但無解時留空並記錄原因而不是回溯
      let bestIdx = 0;
      let bestOpts = options(st, remaining[0]);
      for (let i = 1; i < remaining.length; i++) {
        const o = options(st, remaining[i]);
        if (o.length < bestOpts.length) { bestIdx = i; bestOpts = o; }
      }
      const sl = remaining[bestIdx];
      remaining = remaining.filter((_, i) => i !== bestIdx);

      if (bestOpts.length === 0) {
        unfilled.push({ ...sl, memberId: null, message: explainEmpty(st, candidates, sl.shiftIndex, sl.role) });
        continue;
      }
      orderCandidates(bestOpts, st, sl.shiftIndex, noise);
      const c = bestOpts[0];
      roster[sl.shiftIndex][sl.role] = c.id;
      st.place(c.id, sl.shiftIndex);
    }

    if (!best || unfilled.length < best.unfilled.length) {
      best = { roster, complete: unfilled.length === 0, unfilled };
      if (unfilled.length === 0) break;
    }
  }
  best!.unfilled.sort((a, b) => a.shiftIndex - b.shiftIndex);
  return best!;
}

/** 某個空缺為什麼排不進人：統計各原因的人數，給人工微調參考 */
function explainEmpty(st: ConstraintState, cands: Candidate[], shiftIndex: number, role: Role): string {
  const qualified = cands.filter((c) => canFill(c.qualification, role));
  if (qualified.length === 0) return `無具${ROLE_LABEL[role]}資格的可用人員`;
  let rest = 0;
  let gray = 0;
  for (const c of qualified) {
    if (!st.restOk(c.id, shiftIndex)) rest++;
    else if (!st.grayOk(c.id, shiftIndex)) gray++;
  }
  const parts: string[] = [];
  if (rest) parts.push(`${rest} 人歇哨未滿 6 小時`);
  if (gray) parts.push(`${gray} 人會連續三天灰色時段`);
  return `無可排人員（${parts.join("、")}）`;
}

// ============================== 人工微調驗證 ==============================

/** 以「歷史 + 今天除了 (shiftIndex, role) 這一格以外的所有班」建立限制狀態 */
function stateExcludingCell(date: string, roster: Roster, history: HistoryAssignment[], shiftIndex: number, role: Role) {
  const st = new ConstraintState(date, history);
  for (let s = 0; s < SHIFTS_PER_DAY; s++) {
    for (const r of ROLES) {
      if (s === shiftIndex && r === role) continue;
      const id = roster[s][r];
      if (id) st.place(id, s);
    }
  }
  return st;
}

type MemberLite = Pick<Candidate, "id" | "name" | "qualification">;

/**
 * 人工微調用：列出某一格每位人員「若被選入會違反什麼」。
 * 回傳 Map<memberId, 原因 | null>，null 表示可以排。
 */
export function cellOptionReasons(
  date: string,
  roster: Roster,
  members: MemberLite[],
  history: HistoryAssignment[],
  shiftIndex: number,
  role: Role,
): Map<string, string | null> {
  const st = stateExcludingCell(date, roster, history, shiftIndex, role);
  return new Map(members.map((m) => [m.id, st.reason({ ...m, workDays: 0, shiftCount: 0 }, shiftIndex, role)]));
}

/**
 * 檢查一份（可能被人工修改過的）哨表是否違反硬性限制。
 * 空格不算違規，但會回報為「空缺」。
 * 每一格都以「其餘所有格」為背景檢查，因此兩班互相衝突時兩格都會被標示。
 */
export function validateRoster(
  date: string,
  roster: Roster,
  members: MemberLite[],
  history: HistoryAssignment[],
): { violations: Violation[]; vacancies: Array<{ shiftIndex: number; role: Role }> } {
  const byId = new Map(members.map((m) => [m.id, m]));
  const violations: Violation[] = [];
  const vacancies: Array<{ shiftIndex: number; role: Role }> = [];

  for (let s = 0; s < SHIFTS_PER_DAY; s++) {
    for (const role of ROLES) {
      const id = roster[s][role];
      if (!id) { vacancies.push({ shiftIndex: s, role }); continue; }
      const m = byId.get(id);
      if (!m) {
        violations.push({ shiftIndex: s, role, memberId: id, message: "非今日可動用人員" });
        continue;
      }
      const msg = stateExcludingCell(date, roster, history, s, role).reason({ ...m, workDays: 0, shiftCount: 0 }, s, role);
      if (msg) violations.push({ shiftIndex: s, role, memberId: id, message: msg });
    }
  }
  return { violations, vacancies };
}

// ============================== 最低人力防呆 ==============================

export const MIN_TOTAL = 8;      // 24 班次 ÷ 每人每日最多 3 班
export const MIN_PER_ROLE = 4;   // 12 班次 ÷ 3
/**
 * 建議人力（情境模擬得出，見 docs/simulation-report.md）：
 *   全勤 30 天每月空缺：9 人 ≈ 37 格、10 人 ≈ 13 格、11 人 ≈ 0.3 格、12 人 = 0
 *   哨長：4 人 ≈ 31 格、5 人 ≈ 7 格、6 人 = 0
 * 低於建議值仍可排哨，但可能出現空缺。
 */
export const RECOMMENDED_TOTAL = 12;
export const RECOMMENDED_LEADERS = 6;

export interface ManpowerCheck {
  ok: boolean;
  total: number;
  leaderCapable: number;
  guardCapable: number;
  messages: string[];
  /** 達到最低門檻、但低於建議人力時的提醒（不阻擋排哨） */
  advisories: string[];
}

export function checkMinimumManpower(people: Array<{ qualification: Qualification }>): ManpowerCheck {
  const total = people.length;
  const leaderCapable = people.filter((p) => canFill(p.qualification, "leader")).length;
  const guardCapable = people.filter((p) => canFill(p.qualification, "guard")).length;
  const messages: string[] = [];
  if (total < MIN_TOTAL) messages.push(`可動用總人數 ${total} 人，最低需求 ${MIN_TOTAL} 人`);
  if (leaderCapable < MIN_PER_ROLE)
    messages.push(`具哨長資格 ${leaderCapable} 人，最低需求 ${MIN_PER_ROLE} 人`);
  if (guardCapable < MIN_PER_ROLE)
    messages.push(`可擔任槍兵 ${guardCapable} 人，最低需求 ${MIN_PER_ROLE} 人`);
  const advisories: string[] = [];
  if (messages.length === 0) {
    if (total < RECOMMENDED_TOTAL)
      advisories.push(`可動用 ${total} 人，低於建議的 ${RECOMMENDED_TOTAL} 人：受歇哨與灰色時段規定限制，可能出現空缺`);
    if (leaderCapable < RECOMMENDED_LEADERS)
      advisories.push(`哨長 ${leaderCapable} 人，低於建議的 ${RECOMMENDED_LEADERS} 人：哨長位可能出現空缺，且哨長負擔會明顯偏重`);
  }
  return { ok: messages.length === 0, total, leaderCapable, guardCapable, messages, advisories };
}
