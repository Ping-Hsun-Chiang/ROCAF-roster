import { supabase } from "./supabase";
import { GRAY_SHIFTS, ROLES, addDays, type HistoryAssignment, type Qualification, type Role, type Roster } from "./scheduler";

export interface Member {
  id: string;
  name: string;
  qualification: Qualification;
  active: boolean;
  note: string | null;
}

export interface MonthStat {
  workDays: number;
  shiftCount: number;
  /** 當月灰色時段節數 */
  grayCount: number;
}

export interface AssignmentRow extends HistoryAssignment {
  role: Role;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---------- 名冊 ----------
export async function listMembers(): Promise<Member[]> {
  return check(
    await supabase().from("members").select("id,name,qualification,active,note").order("created_at"),
  ) as Member[];
}

export async function createMember(m: Omit<Member, "id">) {
  check(await supabase().from("members").insert(m));
}

export async function updateMember(id: string, patch: Partial<Omit<Member, "id">>) {
  check(await supabase().from("members").update(patch).eq("id", id));
}

export async function deleteMember(id: string) {
  check(await supabase().from("members").delete().eq("id", id));
}

// ---------- 統計 ----------
/** @param month 該月任一天 YYYY-MM-DD；@param excludeDate 不計入站哨節數的日期 */
export async function monthStats(month: string, excludeDate?: string): Promise<Map<string, MonthStat>> {
  const monthStart = month.slice(0, 7) + "-01";
  const monthEnd = addDays(addDays(monthStart, 32).slice(0, 7) + "-01", -1);
  const [rows, assignments] = await Promise.all([
    supabase().rpc("member_month_stats", { p_month: month, p_exclude_date: excludeDate ?? null }).then(check),
    getAssignments(monthStart, monthEnd), // 一個月最多 31×24 = 744 筆，低於 Supabase 預設 1000 筆上限
  ]);
  const gray = new Map<string, number>();
  for (const a of assignments) {
    if (a.date !== excludeDate && GRAY_SHIFTS.has(a.shiftIndex)) gray.set(a.memberId, (gray.get(a.memberId) ?? 0) + 1);
  }
  return new Map(
    (rows as Array<{ member_id: string; work_days: number; shift_count: number }>).map((r) => [
      r.member_id,
      { workDays: r.work_days, shiftCount: r.shift_count, grayCount: gray.get(r.member_id) ?? 0 },
    ]),
  );
}

// ---------- 出勤 ----------
export async function getAttendance(date: string): Promise<string[]> {
  const rows = check(await supabase().from("attendance").select("member_id").eq("work_date", date)) as Array<{
    member_id: string;
  }>;
  return rows.map((r) => r.member_id);
}

export async function setAttendance(date: string, memberIds: string[]) {
  check(await supabase().rpc("set_attendance", { p_date: date, p_member_ids: memberIds }));
}

// ---------- 哨表 ----------
export async function getAssignments(from: string, to: string): Promise<AssignmentRow[]> {
  const rows = check(
    await supabase()
      .from("duty_assignments")
      .select("duty_date,shift_index,role,member_id")
      .gte("duty_date", from)
      .lte("duty_date", to),
  ) as Array<{ duty_date: string; shift_index: number; role: Role; member_id: string }>;
  return rows.map((r) => ({ date: r.duty_date, shiftIndex: r.shift_index, role: r.role, memberId: r.member_id }));
}

export async function saveRoster(date: string, roster: Roster) {
  const payload = roster.flatMap((row, s) =>
    ROLES.filter((r) => row[r]).map((r) => ({ shift_index: s, role: r, member_id: row[r] })),
  );
  check(await supabase().rpc("save_duty_roster", { p_date: date, p_assignments: payload }));
}
