"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays, checkMinimumManpower, emptyRoster, generateRoster, MIN_PER_ROLE, MIN_TOTAL, QUAL_LABEL, ROLES,
  type Candidate, type Role, type Roster, type Violation,
} from "@/lib/scheduler";
import {
  getAssignments, getAttendance, listMembers, monthStats, saveRoster, setAttendance,
  type AssignmentRow, type Member, type MonthStat,
} from "@/lib/db";
import { fmtDate, todayLocal } from "@/lib/date";
import Modal from "./Modal";
import RosterEditor from "./RosterEditor";

type Phase = "select" | "edit";
type LockGrid = Array<Record<Role, boolean>>;

const emptyLocks = (): LockGrid => Array.from({ length: 12 }, () => ({ leader: false, guard: false }));

function rosterFromRows(rows: AssignmentRow[]): Roster {
  const r = emptyRoster();
  for (const a of rows) r[a.shiftIndex][a.role] = a.memberId;
  return r;
}

export default function ScheduleWizard() {
  const [date, setDate] = useState(() => addDays(todayLocal(), 1)); // 預設排「明天」的哨表
  const [phase, setPhase] = useState<Phase>("select");

  const [members, setMembers] = useState<Member[]>([]);
  const [stats, setStats] = useState<Map<string, MonthStat>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nearby, setNearby] = useState<AssignmentRow[]>([]); // D-2 ~ D+2 的哨表

  const [roster, setRoster] = useState<Roster>(emptyRoster);
  const [locks, setLocks] = useState<LockGrid>(emptyLocks);
  const [unfilled, setUnfilled] = useState<Violation[]>([]);

  const [warning, setWarning] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmVacancy, setConfirmVacancy] = useState(false);

  /** 歷史資料（不含當天）——給演算法做跨日歇哨與灰色時段檢核 */
  const history = useMemo(() => nearby.filter((a) => a.date !== date), [nearby, date]);
  const savedToday = useMemo(() => nearby.filter((a) => a.date === date), [nearby, date]);

  const load = useCallback(async () => {
    setBusy("載入中…");
    setError(null);
    try {
      const [m, att, st, near] = await Promise.all([
        listMembers(),
        getAttendance(date),
        monthStats(date, date),
        getAssignments(addDays(date, -2), addDays(date, 2)),
      ]);
      setMembers(m);
      setStats(st);
      setNearby(near);
      // 若當天已登錄出勤就沿用，否則預設全部在籍人員
      setSelected(new Set(att.length ? att : m.filter((x) => x.active).map((x) => x.id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [date]);

  useEffect(() => {
    setPhase("select");
    setNotice(null);
    load();
  }, [load]);

  const active = members.filter((m) => m.active);
  const available = active.filter((m) => selected.has(m.id));
  const manpower = checkMinimumManpower(available);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const buildCandidates = (st: Map<string, MonthStat>): Candidate[] =>
    available.map((m) => ({
      id: m.id, name: m.name, qualification: m.qualification,
      workDays: st.get(m.id)?.workDays ?? 1,
      shiftCount: st.get(m.id)?.shiftCount ?? 0,
    }));

  /** 跑演算法（放到下一個 tick，讓「排哨中…」先畫出來） */
  const runAlgorithm = (cands: Candidate[], locked?: Roster) =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        const res = generateRoster(date, cands, history, { locked });
        setRoster(res.roster);
        setUnfilled(res.unfilled);
        resolve();
      }, 20);
    });

  // ===== Step 2 ~ 4：防呆 → 寫入出勤 → 產生哨表 =====
  const onGenerate = async () => {
    // Step 2：最低人力門檻檢核，未通過直接跳警告並中止
    if (!manpower.ok) {
      setWarning(manpower.messages);
      return;
    }
    setError(null);
    setNotice(null);
    try {
      // Step 3：寫入出勤（= 被勾選者當月上班天數 +1；以覆寫方式，重複按不會重複累加）
      setBusy("登錄出勤…");
      await setAttendance(date, available.map((m) => m.id));
      const st = await monthStats(date, date);
      setStats(st);

      // Step 4：排哨
      setBusy("排哨中…");
      await runAlgorithm(buildCandidates(st));
      setLocks(emptyLocks());
      setConfirmVacancy(false);
      setPhase("edit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** 重新產生：保留被鎖定（人工指定）的格子 */
  const onRegenerate = async () => {
    const locked = emptyRoster();
    locks.forEach((row, s) => ROLES.forEach((r) => { if (row[r]) locked[s][r] = roster[s][r]; }));
    setBusy("排哨中…");
    await runAlgorithm(buildCandidates(stats), locked);
    setConfirmVacancy(false);
    setBusy(null);
  };

  const onLoadSaved = () => {
    setRoster(rosterFromRows(savedToday));
    setUnfilled([]);
    setLocks(emptyLocks());
    setPhase("edit");
  };

  // ===== Step 5：手動微調 =====
  const onCellChange = (s: number, role: Role, id: string | null) => {
    setRoster((prev) => prev.map((row, i) => (i === s ? { ...row, [role]: id } : row)));
    setLocks((prev) => prev.map((row, i) => (i === s ? { ...row, [role]: id !== null } : row))); // 手動改的格子自動鎖定
    setUnfilled((prev) => prev.filter((u) => !(u.shiftIndex === s && u.role === role)));
    setConfirmVacancy(false);
    setNotice(null);
  };

  const onToggleLock = (s: number, role: Role) =>
    setLocks((prev) => prev.map((row, i) => (i === s ? { ...row, [role]: !row[role] } : row)));

  const onSave = async (vacancies: number) => {
    if (vacancies > 0 && !confirmVacancy) {
      setConfirmVacancy(true);
      return;
    }
    setBusy("儲存中…");
    setError(null);
    try {
      // 寫入哨表；「已站哨節數」由資料庫依哨表統計，等於同步更新
      await saveRoster(date, roster);
      const [st, near] = await Promise.all([monthStats(date, date), getAssignments(addDays(date, -2), addDays(date, 2))]);
      setStats(st);
      setNearby(near);
      setNotice(`${fmtDate(date)} 哨表已儲存。`);
      setConfirmVacancy(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ================================ UI ================================
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">每日排哨精靈</h1>
          <Steps phase={phase} />
        </div>
        <label className="text-sm text-stone-600">
          勤務日期{" "}
          <input type="date" className="input ml-1" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">✓ {notice}</div>}

      {phase === "select" && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">Step 1　勾選 {fmtDate(date)} 可動用人員</h2>
              <p className="text-sm text-stone-500">未勾選者視為休假，不列入排哨。</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setSelected(new Set(active.map((m) => m.id)))}>全選</button>
              <button className="btn-ghost" onClick={() => setSelected(new Set())}>全不選</button>
            </div>
          </div>

          {/* 即時人力儀表：讓使用者勾選時就看到是否達標 */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Gauge label="可動用總人數" value={manpower.total} min={MIN_TOTAL} />
            <Gauge label="可任哨長（哨長＋皆可）" value={manpower.leaderCapable} min={MIN_PER_ROLE} />
            <Gauge label="可任槍兵（槍兵＋皆可）" value={manpower.guardCapable} min={MIN_PER_ROLE} />
          </div>

          {active.length === 0 && !busy && (
            <p className="py-4 text-center text-sm text-stone-400">名冊中沒有在籍人員，請先到「人員名冊」新增。</p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {active.map((m) => {
              const st = stats.get(m.id);
              const on = selected.has(m.id);
              return (
                <label key={m.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${on ? "border-emerald-700 bg-emerald-50" : "border-stone-200 bg-white text-stone-400"}`}>
                  <input type="checkbox" className="size-4 accent-emerald-800" checked={on} onChange={() => toggle(m.id)} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.name}</div>
                    <div className="text-xs text-stone-500">
                      {QUAL_LABEL[m.qualification]}・{st?.shiftCount ?? 0} 節 / {st?.workDays ?? 0} 天
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-stone-100 pt-4">
            {savedToday.length > 0 && (
              <>
                <span className="text-sm text-amber-700">此日期已有儲存的哨表（{savedToday.length} 格）</span>
                <button className="btn-secondary" onClick={onLoadSaved}>載入已存哨表</button>
              </>
            )}
            <button className="btn-primary" onClick={onGenerate} disabled={!!busy}>
              {busy ?? "生成哨表 →"}
            </button>
          </div>
        </div>
      )}

      {phase === "edit" && (
        <RosterEditor
          date={date}
          roster={roster}
          locks={locks}
          unfilled={unfilled}
          members={available.length ? available : active}
          allMembers={members}
          stats={stats}
          history={history}
          busy={busy}
          confirmVacancy={confirmVacancy}
          onCellChange={onCellChange}
          onToggleLock={onToggleLock}
          onRegenerate={onRegenerate}
          onBack={() => { setPhase("select"); setNotice(null); }}
          onSave={onSave}
        />
      )}

      <Modal open={!!warning} title="今日可動用人力不足，無法排哨" onClose={() => setWarning(null)}>
        <p>一天 12 班 × 2 人 = 24 個班次；在「站 2 休 6」下每人每日最多 3 班，因此最低需求為：</p>
        <ul className="list-disc pl-5 text-stone-600">
          <li>可動用總人數 ≥ {MIN_TOTAL} 人</li>
          <li>具「哨長／皆可」資格 ≥ {MIN_PER_ROLE} 人</li>
          <li>具「槍兵／皆可」資格 ≥ {MIN_PER_ROLE} 人</li>
        </ul>
        <p className="font-medium text-red-700">目前不足：</p>
        <ul className="list-disc pl-5 text-red-700">
          {warning?.map((w) => <li key={w}>{w}</li>)}
        </ul>
      </Modal>
    </div>
  );
}

function Gauge({ label, value, min }: { label: string; value: number; min: number }) {
  const ok = value >= min;
  return (
    <div className={`rounded-lg border px-3 py-2 ${ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
      <div className="text-xs text-stone-600">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${ok ? "text-emerald-800" : "text-red-700"}`}>
        {value} <span className="text-xs font-normal text-stone-500">/ 最低 {min}</span>
      </div>
    </div>
  );
}

function Steps({ phase }: { phase: Phase }) {
  const steps = ["勾選人員", "人力檢核", "登錄出勤", "產生哨表", "微調儲存"];
  const current = phase === "select" ? 0 : 4;
  return (
    <ol className="mt-1 flex flex-wrap gap-x-2 text-xs text-stone-500">
      {steps.map((s, i) => (
        <li key={s} className={i <= current ? "font-medium text-emerald-800" : ""}>
          {i + 1}. {s}{i < steps.length - 1 && <span className="ml-2 text-stone-300">›</span>}
        </li>
      ))}
    </ol>
  );
}
