/**
 * 模擬分析用的統計函式（無外部依賴）
 *
 * 實作參考：Numerical Recipes（incomplete gamma）、Abramowitz & Stegun 7.1.26（erf）。
 * 準確度以模擬報告所需為準（p-value 約小數點後 4 位）。
 */

export const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** 樣本標準差（n − 1） */
export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Student t 分布雙尾 95% 臨界值（查表內插；df ≥ 120 時取 1.96） */
function tCrit95(df: number): number {
  const table: Array<[number, number]> = [
    [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447], [7, 2.365], [8, 2.306],
    [9, 2.262], [10, 2.228], [15, 2.131], [20, 2.086], [25, 2.06], [30, 2.042], [40, 2.021], [60, 2.0], [120, 1.98],
  ];
  if (df >= 120) return 1.96;
  for (let i = 1; i < table.length; i++) {
    const [d1, t1] = table[i - 1];
    const [d2, t2] = table[i];
    if (df <= d2) return t1 + ((df - d1) / (d2 - d1)) * (t2 - t1);
  }
  return 1.96;
}

/** 平均數的 95% confidence interval 半寬 */
export const ci95 = (xs: number[]) => (xs.length < 2 ? 0 : (tCrit95(xs.length - 1) * sd(xs)) / Math.sqrt(xs.length));

/** Gini coefficient：0 = 完全平均，1 = 全部集中在一人 */
export function gini(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  let sum = 0;
  for (const a of xs) for (const b of xs) sum += Math.abs(a - b);
  return sum / (2 * xs.length * xs.length * m);
}

// ---------------- chi-square ----------------

function lnGamma(z: number): number {
  // Lanczos approximation (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized lower incomplete gamma P(a, x) */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // series
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 500; n++) {
      del *= x / (a + n);
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // continued fraction (Lentz) for Q, then P = 1 − Q
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export interface ChiSquareResult {
  chi2: number;
  df: number;
  /** 上尾 p-value：P(χ² ≥ 觀察值)。很小 → 分配有系統性偏差 */
  pUpper: number;
  /** 下尾 p-value：P(χ² ≤ 觀察值)。很小 → 分配比「隨機抽籤」還平均 */
  pLower: number;
  /** Dispersion index = χ² / df。隨機抽籤 ≈ 1，越小越平均 */
  dispersion: number;
}

/**
 * Chi-square goodness-of-fit test。
 * 虛無假設 H0：每個人的節數依「上班天數比例」隨機分配（multinomial）。
 */
export function chiSquareGOF(observed: number[], expected: number[]): ChiSquareResult {
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) chi2 += (observed[i] - expected[i]) ** 2 / expected[i];
  const df = observed.length - 1;
  const pLower = gammaP(df / 2, chi2 / 2);
  return { chi2, df, pUpper: 1 - pLower, pLower, dispersion: chi2 / df };
}

// ---------------- Mann-Whitney U ----------------

/** Standard normal CDF（A&S 7.1.26，誤差 < 1.5e-7） */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Mann-Whitney U test（雙尾，normal approximation + tie correction）。
 * 用於比較兩組樣本（例如兩個演算法版本在 N 個 seed 下的偏差 SD）是否有顯著差異。
 *
 * 數值先四捨五入到 1e-9 再排序：數學上相等的 RMS 可能因浮點誤差在第 15 位以後不同，
 * 若不處理就不會被視為 tie，使 U 值偏差（由 analysis.ipynb 與 scipy 交叉驗證時發現）。
 */
export function mannWhitney(a: number[], b: number[]): { u: number; z: number; p: number } {
  const q = (v: number) => Math.round(v * 1e9) / 1e9;
  const all = [...a.map((v) => ({ v: q(v), g: 0 })), ...b.map((v) => ({ v: q(v), g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(all.length);
  let tieSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1;
    tieSum += t ** 3 - t;
    i = j + 1;
  }
  const n1 = a.length;
  const n2 = b.length;
  const r1 = all.reduce((s, x, i) => s + (x.g === 0 ? ranks[i] : 0), 0);
  const u = r1 - (n1 * (n1 + 1)) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1))));
  if (sigma === 0) return { u, z: 0, p: 1 };
  const z = (u - (n1 * n2) / 2) / sigma;
  return { u, z, p: 2 * (1 - normCdf(Math.abs(z))) };
}
