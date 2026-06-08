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
    "ARRIVED":   "#fb8c00",    # turuncu (gelmiş / çalışıyor)
    "PLANNED":   "#43a047",    # yeşil (planlı)
    "DEPATURED": "#b0bec5",    # gri (gitmiş)
    "DEPARTURED":"#b0bec5",
}
_DEFAULT_COLOR = "#1e88e5"     # mavi (bilinmeyen durum)


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
        ca, cd = max(a, win_start), min(d, win_end)
        rows.setdefault(e.berth or "?", []).append((ca, cd, a, d, e))

    if not rows:
        return None

    berths = sorted(rows.keys())
    fig, ax = plt.subplots(figsize=(13, 1.05 * len(berths) + 2.0))
    BAR_H = 0.74

    for i, b in enumerate(berths):
        for ca, cd, a, d, e in rows[b]:
            left = mdates.date2num(ca)
            width = mdates.date2num(cd) - left
            mid = left + width / 2
            ax.barh(i, width, left=left, height=BAR_H,
                    color=_COLOR.get((e.status or "").upper(), _DEFAULT_COLOR),
                    edgecolor="white", linewidth=1.0)

            # köşelerde yanaşma / kalkış saati (pencere içinde kalan uçlar)
            if a >= win_start:
                ax.text(left + 0.004, i - BAR_H / 2 + 0.04, a.strftime("%H:%M"),
                        ha="left", va="top", fontsize=5.5, color="white", clip_on=True)
            if d <= win_end:
                ax.text(left + width - 0.004, i - BAR_H / 2 + 0.04, d.strftime("%H:%M"),
                        ha="right", va="top", fontsize=5.5, color="white", clip_on=True)

            # orta etiket: GEMİ ADI-sefer / yük/tahliye/shift / servis
            voy = (e.voyage or "").split("/")[0]
            title = f"{e.ship_name}" + (f"-{voy}" if voy else "")
            cargo = f"{e.load_van or '0'}/{e.dis_van or '0'}/{e.shift_van or '0'}"
            label = title + "\n" + cargo + (f"  {e.service}" if e.service else "")
            ax.text(mid, i + 0.05, label, ha="center", va="center",
                    fontsize=6, color="white", linespacing=1.1, clip_on=True)

    ax.set_yticks(range(len(berths)))
    ax.set_yticklabels(berths, fontweight="bold")
    ax.set_ylim(-0.6, len(berths) - 0.4)
    ax.invert_yaxis()

    ax.set_xlim(mdates.date2num(win_start), mdates.date2num(win_end))
    ax.xaxis_date()
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=[2, 8, 14, 20]))
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
    leg = ax.legend(handles=handles, loc="upper right", fontsize=7, ncol=3,
                    framealpha=0.9, title="yük/tahliye/shift kutuda")
    leg.get_title().set_fontsize(6)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()
