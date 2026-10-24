"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, dayDiff, GRAY_SHIFTS, ROLE_LABEL, ROLES, SHIFTS_PER_DAY, shiftLabel } from "@/lib/scheduler";
import { getAssignments, listMembers, type AssignmentRow, type Member } from "@/lib/db";
import { fmtDate, todayLocal } from "@/lib/date";

const DAYS_BACK = 7;
const FULL = SHIFTS_PER_DAY * ROLES.length;

export default function RosterHistory() {
  const today = todayLocal();
  // 明天 → 往前 7 天（明天常是剛排好的哨表，一併列出）
  const recent = useMemo(
    () => Array.from({ length: DAYS_BACK + 2 }, (_, i) => addDays(today, 1 - i)),
    [today],
  );

  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, a] = await Promise.all([listMembers(), getAssignments(recent[recent.length - 1], recent[0])]);
      setMembers(m);
      setRows(a);
      setError(null);
      return a;
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [recent]);

  // 預設選取最近一個有存哨表的日期
  useEffect(() => {
    load().then((a) => {
      const saved = recent.find((d) => a.some((r) => r.date === d));
      setSelected(saved ?? today);
    });
  }, [load, recent, today]);

  /** 近期日期已載入；其他日期只抓那一天並併入 */
  const pick = async (d: string) => {
    setSelected(d);
    if (recent.includes(d)) return;
    setLoading(true);
    try {
      const a = await getAssignments(d, d);
      setRows((prev) => [...prev.filter((r) => r.date !== d), ...a]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const countOf = (d: string) => rows.filter((r) => r.date === d).length;

  const grid = useMemo(() => {
    const g: Array<Record<string, string | null>> = Array.from({ length: SHIFTS_PER_DAY }, () => ({ leader: null, guard: null }));
    for (const r of rows) if (r.date === selected) g[r.shiftIndex][r.role] = r.memberId;
    return g;
  }, [rows, selected]);

  const people = useMemo(() => {
    const m = new Map<string, number[]>();
    grid.forEach((row, s) => ROLES.forEach((r) => {
      const id = row[r];
      if (id) m.set(id, [...(m.get(id) ?? []), s]);
    }));
    return [...m.entries()].sort((a, b) => a[1][0] - b[1][0]);
  }, [grid]);

  const selectedCount = selected ? countOf(selected) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">哨表紀錄</h1>
          <p className="text-sm text-stone-500">點選日期查看當天已儲存的哨表</p>
        </div>
        <label className="text-sm text-stone-600">
          查詢其他日期{" "}
          <input type="date" className="input ml-1" value={selected ?? ""}
            onChange={(e) => e.target.value && pick(e.target.value)} />
        </label>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {recent.map((d) => {
          const n = countOf(d);
          const on = d === selected;
          return (
            <button key={d} onClick={() => pick(d)}
              className={`min-w-[88px] shrink-0 rounded-lg border px-3 py-2 text-left ${on ? "border-emerald-800 bg-emerald-800 text-white" : "border-stone-200 bg-white hover:border-stone-400"}`}>
              <div className="text-xs opacity-75">{d === today ? "今天" : d === addDays(today, 1) ? "明天" : `${dayDiff(d, today)} 天前`}</div>
              <div className="font-medium">{fmtDate(d)}</div>
              <div className={`text-xs ${on ? "text-emerald-100" : n === 0 ? "text-stone-400" : n < FULL ? "text-amber-700" : "text-emerald-700"}`}>
                {loading && n === 0 ? "…" : n === 0 ? "未排" : n < FULL ? `${n}/${FULL} 有空缺` : "已排"}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{fmtDate(selected)} 哨表</h2>
              <Link href={`/schedule?date=${selected}`} className="btn-secondary">
                {selectedCount ? "編輯此日哨表" : "排這天的哨表"}
              </Link>
            </div>
            {loading ? (
              <p className="py-8 text-center text-sm text-stone-400">載入中…</p>
            ) : selectedCount === 0 ? (
              <p className="py-8 text-center text-sm text-stone-400">這天沒有儲存的哨表。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="text-left text-stone-500">
                    <tr>
                      <th className="w-36 px-3 py-1.5">時段</th>
                      {ROLES.map((r) => <th key={r} className="px-3 py-1.5">{ROLE_LABEL[r]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row, s) => (
                      <tr key={s} className={`border-t border-stone-100 ${GRAY_SHIFTS.has(s) ? "bg-stone-200/60" : ""}`}>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {shiftLabel(s)}
                          {GRAY_SHIFTS.has(s) && <span className="ml-1 text-xs text-stone-500">灰</span>}
                        </td>
                        {ROLES.map((r) => (
                          <td key={r} className="px-3 py-1.5">
                            {row[r] ? nameOf.get(row[r]!) ?? "（已刪除）" : <span className="text-amber-700">空缺</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selectedCount > 0 && (
            <aside className="card h-fit">
              <h3 className="mb-2 font-bold">當日上哨人員（{people.length} 人）</h3>
              <ul className="space-y-1 text-sm">
                {people.map(([id, shifts]) => (
                  <li key={id} className="flex justify-between gap-2 border-t border-stone-100 pt-1">
                    <span>{nameOf.get(id) ?? "（已刪除）"}</span>
                    <span className="text-right font-mono text-xs text-stone-500">
                      {shifts.map((s) => shiftLabel(s).slice(0, 5)).join("、")}
                    </span>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
