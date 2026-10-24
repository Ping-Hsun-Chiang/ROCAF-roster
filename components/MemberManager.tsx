"use client";

import { useCallback, useEffect, useState } from "react";
import { QUAL_LABEL, type Qualification } from "@/lib/scheduler";
import { createMember, deleteMember, listMembers, monthStats, updateMember, type Member, type MonthStat } from "@/lib/db";
import { todayLocal } from "@/lib/date";

/** 預設為哨長（可兼槍兵），只有「僅能擔任槍兵」的人才需要特別勾選 */
function QualPicker({ value, onChange }: { value: Qualification; onChange: (q: Qualification) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm">
      <input type="checkbox" className="size-4 accent-amber-600" checked={value === "guard"}
        onChange={(e) => onChange(e.target.checked ? "guard" : "leader")} />
      僅能擔任槍兵
    </label>
  );
}

export default function MemberManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [stats, setStats] = useState<Map<string, MonthStat>>(new Map());
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 新增表單
  const [name, setName] = useState("");
  const [qual, setQual] = useState<Qualification>("leader");
  const [note, setNote] = useState("");

  // 編輯 / 刪除狀態
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pick<Member, "name" | "qualification" | "note">>({ name: "", qualification: "leader", note: "" });
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([listMembers(), monthStats(`${month}-01`)]);
      setMembers(m);
      setStats(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { reload(); }, [reload]);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); await reload(); } catch (e) { setError((e as Error).message); }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    run(async () => {
      await createMember({ name: name.trim(), qualification: qual, note: note.trim() || null, active: true });
      setName(""); setNote("");
    });
  };

  const startEdit = (m: Member) => {
    setEditId(m.id);
    setDraft({ name: m.name, qualification: m.qualification, note: m.note ?? "" });
  };

  const saveEdit = () =>
    run(async () => {
      await updateMember(editId!, { name: draft.name.trim(), qualification: draft.qualification, note: draft.note?.trim() || null });
      setEditId(null);
    });

  const counts = {
    total: members.filter((m) => m.active).length,
    leader: members.filter((m) => m.active && m.qualification !== "guard").length,
    guardOnly: members.filter((m) => m.active && m.qualification === "guard").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">人員名冊</h1>
          <p className="text-sm text-stone-500">
            在籍 {counts.total} 人・哨長 {counts.leader} 人・僅槍兵 {counts.guardOnly} 人
          </p>
        </div>
        <label className="text-sm text-stone-600">
          統計月份{" "}
          <input type="month" className="input ml-1" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={add} className="card flex flex-wrap items-center gap-3">
        <input className="input w-40" placeholder="姓名" value={name} onChange={(e) => setName(e.target.value)} required />
        <QualPicker value={qual} onChange={setQual} />
        <input className="input min-w-0 flex-1" placeholder="備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary">＋ 新增人員</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-2">姓名</th>
              <th className="px-4 py-2">資格</th>
              <th className="px-4 py-2 text-right">當月上班天數</th>
              <th className="px-4 py-2 text-right">當月站哨節數</th>
              <th className="px-4 py-2 text-right" title="站哨節數 ÷ 上班天數，越低越優先排哨">公平值</th>
              <th className="px-4 py-2">在籍</th>
              <th className="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-6 text-center text-stone-400">載入中…</td></tr>}
            {!loading && members.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-stone-400">尚無人員，請由上方新增。</td></tr>
            )}
            {members.map((m) => {
              const st = stats.get(m.id) ?? { workDays: 0, shiftCount: 0 };
              const editing = editId === m.id;
              return (
                <tr key={m.id} className={`border-b border-stone-100 ${m.active ? "" : "text-stone-400"}`}>
                  <td className="px-4 py-2">
                    {editing ? (
                      <input className="input w-32" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    ) : (
                      <>
                        <div className="font-medium">{m.name}</div>
                        {m.note && <div className="text-xs text-stone-400">{m.note}</div>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {editing ? (
                      <QualPicker value={draft.qualification} onChange={(q) => setDraft({ ...draft, qualification: q })} />
                    ) : (
                      <span className={`rounded px-2 py-0.5 ${m.qualification === "guard" ? "bg-amber-100 text-amber-800" : "bg-stone-100"}`}>
                        {QUAL_LABEL[m.qualification]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{st.workDays}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{st.shiftCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {st.workDays ? (st.shiftCount / st.workDays).toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={m.active} title="取消勾選即停用，不會出現在排哨名單，但保留歷史"
                      onChange={(e) => run(() => updateMember(m.id, { active: e.target.checked }))} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {editing ? (
                      <>
                        <input className="input mr-2 w-40" placeholder="備註" value={draft.note ?? ""}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                        <button className="btn-primary mr-1 py-1.5" onClick={saveEdit}>儲存</button>
                        <button className="btn-ghost" onClick={() => setEditId(null)}>取消</button>
                      </>
                    ) : confirmDel === m.id ? (
                      <>
                        <span className="mr-2 text-xs text-red-600">連同出勤與哨表紀錄一起刪除？</span>
                        <button className="btn-danger mr-1" onClick={() => run(async () => { await deleteMember(m.id); setConfirmDel(null); })}>
                          確定刪除
                        </button>
                        <button className="btn-ghost" onClick={() => setConfirmDel(null)}>取消</button>
                      </>
                    ) : (
                      <>
                        <button className="btn-ghost" onClick={() => startEdit(m)}>編輯</button>
                        <button className="btn-ghost text-red-600" onClick={() => setConfirmDel(m.id)}>刪除</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        提示：人員退伍或調離時建議取消「在籍」而非刪除，以保留歷史哨表與灰色時段的跨日檢核資料。
      </p>
    </div>
  );
}
