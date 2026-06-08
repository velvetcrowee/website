"""
Rıhtım doluluk zaman çizelgesi (Gantt) - PNG görsel üretir.

Her rıhtım bir satır; her gemi yanaşma→kalkış aralığında bir çubuk.
Renk gemi durumuna göre: yeşil=gelmiş, sarı=planlı, gri=gitmiş.
"""

import io
from datetime import date, datetime, timedelta

import matplotlib
matplotlib.use("Agg")          # ekran yok - sadece dosyaya çiz
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

_COLOR = {
    "ARRIVED":   "#2e7d32",    # yeşil
    "PLANNED":   "#f9a825",    # sarı
    "DEPATURED": "#9e9e9e",    # gri
    "DEPARTURED":"#9e9e9e",
}
_DEFAULT_COLOR = "#1565c0"     # mavi (bilinmeyen durum)


def build_gantt(entries, start: date, days: int = 3) -> bytes | None:
    """[start, start+days] aralığındaki rıhtım doluluğunu PNG (bytes) olarak döndürür.

    Veri yoksa None döner.
    """
    win_start = datetime.combine(start, datetime.min.time())
    win_end = win_start + timedelta(days=days)

    rows: dict[str, list] = {}
    for e in entries:
        a, d = e.arrival_dt(), e.departure_dt()
        if not a or not d or d <= a:
            continue
        if d < win_start or a > win_end:
            continue
        a, d = max(a, win_start), min(d, win_end)
        rows.setdefault(e.berth or "?", []).append((a, d, e.ship_name, e.status))

    if not rows:
        return None

    berths = sorted(rows.keys())
    fig, ax = plt.subplots(figsize=(11, 0.7 * len(berths) + 1.8))

    for i, b in enumerate(berths):
        for a, d, name, st in rows[b]:
            left = mdates.date2num(a)
            width = mdates.date2num(d) - left
            ax.barh(i, width, left=left, height=0.62,
                    color=_COLOR.get((st or "").upper(), _DEFAULT_COLOR),
                    edgecolor="white", linewidth=0.8)
            ax.text(left + width / 2, i, name, ha="center", va="center",
                    fontsize=7, color="white", clip_on=True)

    ax.set_yticks(range(len(berths)))
    ax.set_yticklabels(berths, fontweight="bold")
    ax.set_ylim(-0.6, len(berths) - 0.4)
    ax.invert_yaxis()

    ax.set_xlim(mdates.date2num(win_start), mdates.date2num(win_end))
    ax.xaxis_date()
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=[0, 6, 12, 18]))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H"))
    ax.xaxis.set_minor_locator(mdates.DayLocator())
    ax.xaxis.set_minor_formatter(mdates.DateFormatter("\n%d/%m %a"))
    ax.tick_params(axis="x", which="minor", length=0, labelsize=8)
    ax.tick_params(axis="x", which="major", labelsize=7)

    # gün ayraçları (gece yarıları)
    g = win_start
    while g <= win_end:
        ax.axvline(mdates.date2num(g), color="#bbbbbb", linewidth=0.8, linestyle="-")
        g += timedelta(days=1)

    ax.grid(axis="x", which="major", color="#eeeeee", linewidth=0.5)
    ax.set_axisbelow(True)
    ax.set_title(f"⚓ Rıhtım Çizelgesi · {start.strftime('%d/%m/%Y')} (+{days} gün)",
                 fontsize=12, fontweight="bold")

    # durum açıklaması
    handles = [plt.Line2D([0], [0], color=_COLOR["ARRIVED"], lw=8, label="gelmiş"),
               plt.Line2D([0], [0], color=_COLOR["PLANNED"], lw=8, label="planlı"),
               plt.Line2D([0], [0], color=_COLOR["DEPATURED"], lw=8, label="gitmiş")]
    ax.legend(handles=handles, loc="upper right", fontsize=7, ncol=3, framealpha=0.9)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()
