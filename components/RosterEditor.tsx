"use client";

import { useMemo } from "react";
import {
  cellOptionReasons, GRAY_SHIFTS, ROLE_LABEL, ROLES, shiftLabel, validateRoster,
  type HistoryAssignment, type Role, type Roster, type Violation,
} from "@/lib/scheduler";
import type { Member, MonthStat } from "@/lib/db";
import { fmtDate } from "@/lib/date";

interface Props {
  date: string;
  roster: Roster;
  locks: Array<Record<Role, boolean>>;
  unfilled: Violation[];
  /** 今日可動用人員（下拉選單的選項） */
  members: Member[];
  /** 全部人員（用來顯示名字） */
  allMembers: Member[];
  stats: Map<string, MonthStat>;
  history: HistoryAssignment[];
  busy: string | null;
  confirmVacancy: boolean;
  onCellChange: (shiftIndex: number, role: Role, memberId: string | null) => void;
  onToggleLock: (shiftIndex: number, role: Role) => void;
  onRegenerate: () => void;
  onBack: () => void;
  onSave: (vacancies: number) => void;
}

const key = (s: number, r: Role) => `${s}-${r}`;

export default function RosterEditor(p: Props) {
  const nameOf = useMemo(() => new Map(p.allMembers.map((m) => [m.id, m.name])), [p.allMembers]);

  // 即時驗證：每次手動修改都重新檢查硬性限制
  const { violations, vacancies } = useMemo(
    () => validateRoster(p.date, p.roster, p.members, p.history),
    [p.date, p.roster, p.members, p.history],
  );
  const violationAt = useMemo(() => new Map(violations.map((v) => [key(v.shiftIndex, v.role), v.message])), [violations]);
  const unfilledAt = useMemo(() => new Map(p.unfilled.map((u) => [key(u.shiftIndex, u.role), u.message])), [p.unfilled]);

  // 每人今日班數與排完後的公平值
  const summary = useMemo(() => {
    const today = new Map<string, number[]>();
    p.roster.forEach((row, s) => ROLES.forEach((r) => {
      const id = row[r];
      if (id) today.set(id, [...(today.get(id) ?? []), s]);
    }));
    return p.members
      .map((m) => {
        const st = p.stats.get(m.id) ?? { workDays: 1, shiftCount: 0, grayCount: 0 };
        const shifts = today.get(m.id) ?? [];
        const total = st.shiftCount + shifts.length;
        return { m, shifts, total, workDays: st.workDays, ratio: total / Math.max(st.workDays, 1) };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }, [p.roster, p.members, p.stats]);

  const fairOf = (id: string) => {
    const st = p.stats.get(id);
    return st ? st.shiftCount / Math.max(st.workDays, 1) : 0;
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Step 5　{fmtDate(p.date)} 哨表微調</h2>
            <p className="text-xs text-stone-500">
              灰底為灰色時段。手動改過的格子會自動 🔒 鎖定，「重新排哨」時保留不動。
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={p.onBack}>← 回到勾選</button>
            <button className="btn-secondary" onClick={p.onRegenerate} disabled={!!p.busy}>↻ 重新排哨</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="w-32 px-2 py-1">時段</th>
                {ROLES.map((r) => <th key={r} className="px-2 py-1">{ROLE_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {p.roster.map((row, s) => (
                <tr key={s} className={GRAY_SHIFTS.has(s) ? "bg-stone-200/60" : ""}>
                  <td className="px-2 py-1.5 font-mono tabular-nums">
                    {shiftLabel(s)}
                    {GRAY_SHIFTS.has(s) && <span className="ml-1 text-xs text-stone-500">灰</span>}
                  </td>
                  {ROLES.map((role) => (
                    <Cell
                      key={role}
                      value={row[role]}
                      locked={p.locks[s][role]}
                      violation={violationAt.get(key(s, role))}
                      unfilled={unfilledAt.get(key(s, role))}
                      options={p.members}
                      reasons={cellOptionReasons(p.date, p.roster, p.members, p.history, s, role)}
                      nameOf={nameOf}
                      fairOf={fairOf}
                      onChange={(id) => p.onCellChange(s, role, id)}
                      onToggleLock={() => p.onToggleLock(s, role)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-stone-100 pt-4">
          {violations.length > 0 && (
            <span className="text-sm text-red-700">有 {violations.length} 格違反硬性限制，請修正後再儲存</span>
          )}
          {violations.length === 0 && vacancies.length > 0 && (
            <span className="text-sm text-amber-700">
              {p.confirmVacancy ? `仍有 ${vacancies.length} 格空缺，再按一次確認儲存` : `尚有 ${vacancies.length} 格空缺`}
            </span>
          )}
          <button className="btn-primary" disabled={violations.length > 0 || !!p.busy}
            onClick={() => p.onSave(vacancies.length)}>
            {p.busy ?? (p.confirmVacancy ? "確認儲存（含空缺）" : "💾 儲存哨表")}
          </button>
        </div>
      </div>

      <aside className="card h-fit">
        <h3 className="mb-2 font-bold">公平性檢視</h3>
        <p className="mb-3 text-xs text-stone-500">公平值 = 當月站哨節數 ÷ 上班天數（含本日）</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr><th>姓名</th><th className="text-right">今日</th><th className="text-right">月計</th><th className="text-right">公平值</th></tr>
          </thead>
          <tbody>
            {summary.map(({ m, shifts, total, workDays, ratio }) => (
              <tr key={m.id} className="border-t border-stone-100">
                <td className="py-1">{m.name}</td>
                <td className="py-1 text-right tabular-nums" title={shifts.map(shiftLabel).join("\n")}>{shifts.length}</td>
                <td className="py-1 text-right tabular-nums text-stone-500">{total}/{workDays}</td>
                <td className="py-1 text-right font-medium tabular-nums">{ratio.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </aside>
    </div>
  );
}

function Cell(props: {
  value: string | null;
  locked: boolean;
  violation?: string;
  unfilled?: string;
  options: Member[];
  reasons: Map<string, string | null>;
  nameOf: Map<string, string>;
  fairOf: (id: string) => number;
  onChange: (id: string | null) => void;
  onToggleLock: () => void;
}) {
  const { value, violation, unfilled, reasons } = props;
  // 可排的人在前（依公平值），會違規的人在後並標示原因
  const sorted = [...props.options].sort((a, b) => {
    const ra = reasons.get(a.id) ? 1 : 0;
    const rb = reasons.get(b.id) ? 1 : 0;
    return ra - rb || props.fairOf(a.id) - props.fairOf(b.id);
  });
  const inList = value === null || props.options.some((o) => o.id === value);

  return (
    <td className="px-2 py-1.5 align-top">
      <div className="flex items-center gap-1">
        <select
          value={value ?? ""}
          onChange={(e) => props.onChange(e.target.value || null)}
          className={`input w-full py-1.5 ${violation ? "border-red-500 bg-red-50 text-red-800" : value ? "" : "border-amber-400 bg-amber-50"}`}
        >
          <option value="">（空缺）</option>
          {!inList && <option value={value!}>{props.nameOf.get(value!) ?? "?"}（非今日人員）</option>}
          {sorted.map((m) => {
            const r = m.id === value ? null : reasons.get(m.id);
            return (
              <option key={m.id} value={m.id}>
                {r ? `⚠ ${m.name}｜${r.replace(m.name + " ", "")}` : `${m.name}（${props.fairOf(m.id).toFixed(2)}）`}
              </option>
            );
          })}
        </select>
        <button type="button" onClick={props.onToggleLock} title={props.locked ? "已鎖定：重新排哨時保留" : "未鎖定"}
          className={`w-7 shrink-0 text-center ${props.locked ? "" : "opacity-25 hover:opacity-60"}`}>
          {props.locked ? "🔒" : "🔓"}
        </button>
      </div>
      {violation && <div className="mt-0.5 text-xs text-red-700">✗ {violation}</div>}
      {!value && unfilled && <div className="mt-0.5 text-xs text-amber-700">{unfilled}</div>}
    </td>
  );
}
