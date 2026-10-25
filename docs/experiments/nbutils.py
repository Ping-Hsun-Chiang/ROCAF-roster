"""各實驗 notebook 共用的工具：讀取原始數據、月結算、統計檢定、圖表樣式。

統計量一律以 numpy / scipy 計算，不使用專案自己實作的 scripts/stats.ts，
如此 notebook 才能獨立驗證模擬腳本的結果。
"""
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

DATA = Path(__file__).resolve().parent / "data"

# 圖表樣式：細線、淡格線；類別色固定（現行版本永遠是藍色）
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE, AQUA, YELLOW, MAGENTA, GREEN, VIOLET, RED = (
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948")

plt.rcParams.update({
    "figure.dpi": 110, "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.axisbelow": True,
    "axes.spines.top": False, "axes.spines.right": False, "font.size": 10,
    "axes.titlelocation": "left", "axes.titlecolor": INK, "legend.frameon": False,
})


def load(exp: str, name: str) -> pd.DataFrame:
    """讀取 data/<exp>/<name>.csv"""
    return pd.read_csv(DATA / exp / f"{name}.csv")


def gini(x) -> float:
    """Gini coefficient：0 = 完全平均"""
    x = np.asarray(x, float)
    return float(np.abs(x[:, None] - x[None, :]).sum() / (2 * len(x) ** 2 * x.mean())) if x.mean() else 0.0


def settle(g: pd.DataFrame) -> pd.Series:
    """一個 run 的月結算。應得節數 E_i = 上班天數_i × 全單位（節 ÷ 上班天）"""
    g = g[g.work_days > 0]
    w, s, gr = g.work_days.to_numpy(float), g.shifts.to_numpy(float), g.gray.to_numpy(float)
    e, eg = w * s.sum() / w.sum(), w * gr.sum() / w.sum()
    dev = s - e
    return pd.Series({
        "rms": np.sqrt(np.mean(dev ** 2)), "max_dev": np.abs(dev).max(),
        "rms_gray": np.sqrt(np.mean((gr - eg) ** 2)),
        "gini": gini(s / w),
        "gray_min": gr.min(), "gray_max": gr.max(),
        "gray_rate_min": (gr / w).min(), "gray_rate_max": (gr / w).max(),
    })


def settle_all(persons: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """對每個 run（keys 的組合）做月結算"""
    return persons.groupby(keys).apply(settle, include_groups=False).reset_index()


def mw(x, y) -> tuple[float, float]:
    """Mann-Whitney U test（雙尾、normal approximation、無 continuity correction），與 stats.ts 設定相同。
    先四捨五入到 1e-9，讓浮點誤差造成的「幾乎相等」被視為 tie。"""
    x, y = np.round(np.asarray(x, float), 9), np.round(np.asarray(y, float), 9)
    r = stats.mannwhitneyu(x, y, alternative="two-sided", method="asymptotic", use_continuity=False)
    return float(r.statistic), float(r.pvalue)


def ci95(x) -> float:
    """平均數 95% confidence interval 的半寬（t 分布）"""
    x = np.asarray(x, float)
    return float(stats.t.ppf(0.975, len(x) - 1) * x.std(ddof=1) / np.sqrt(len(x))) if len(x) > 1 else 0.0


def mean_ci(x, d: int = 2) -> str:
    return f"{np.mean(x):.{d}f} ± {ci95(x):.{d}f}"


def assert_close(a, b, name: str, tol: float = 1e-6):
    """交叉驗證：notebook 重算的值必須與模擬腳本（TypeScript）輸出的值一致"""
    diff = float(np.nanmax(np.abs(np.asarray(a, float) - np.asarray(b, float))))
    assert diff < tol, f"{name}: 最大差異 {diff:.2e} 超過容許值 {tol:.0e}"
    print(f"✓ {name}：與 TypeScript 結果一致（最大差異 {diff:.1e}）")
