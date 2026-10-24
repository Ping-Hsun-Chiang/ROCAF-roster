/** 本地時區的 YYYY-MM-DD */
export function todayLocal(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export function fmtDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const w = "日一二三四五六"[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${w}）`;
}
