"""
liman_modulu.py — Asya Port Vardiya botu (modüler mimariye taşınmış hali).

Eski bot.py'nin TÜM işlevi buraya taşındı. Destek dosyaları (scraper.py,
formatter.py, chart.py, amf_client.py, shift_manager.py) projenin kökünde
durur ve buradan düz import edilir.

main.py ile sözleşme:
  * KOMUT_HANDLERS  -> her komut kendi fonksiyonuna gider (çok komutlu modül)
  * CALLBACK_AD + callback -> "liman:..." ile başlayan buton tıklamaları buraya
  * async def setup(app)   -> 07:30 sabah raporu + 18:00 prefetch job'larını kurar

Not: Eski kod callback_data olarak düz "today", "berth:B3" kullanıyordu. Modüler
yönlendirici ön eke göre dağıttığı için hepsini "liman:" ile namespace'ledik;
on_callback girişinde bu ön ek soyulur, gerisi aynen çalışır.
"""

import logging
import json
import os
from datetime import date, datetime, time as dtime, timedelta
from io import BytesIO
from zoneinfo import ZoneInfo

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, ContextTypes

import config
# Kökteki mevcut liman dosyaları (düz import — proje kökünden çalıştırılır):
from scraper import (
    get_shift_report, fetch_live, fetch_entries, fetch_live_diff,
    prefetch_tomorrow, BerthEntry, _save_cache,
)
from shift_manager import (
    add_shift, remove_shift, is_shift_day, get_upcoming_shifts, format_date_tr,
)
from formatter import (
    build_shift_message, build_shifts_list, build_ship_detail,
    build_ship_list, build_berth_view, build_diff_message, build_day_overview,
)
try:
    from chart import build_gantt          # matplotlib gerektirir; yoksa çizelge kapalı
except Exception:
    build_gantt = None

log = logging.getLogger("liman_botu.liman")
TZ = ZoneInfo(config.TIMEZONE)

# Buton callback'lerinin namespace'i (modüler yönlendirici buna göre dağıtır).
CALLBACK_AD = "liman"
_CB = CALLBACK_AD + ":"   # "liman:" ön eki

MANUAL_FILE = "manual_ships.json"


# ── Manuel gemi yönetimi ──────────────────────────────────────────────────────

def _load_manual(d: date) -> list[dict]:
    if not os.path.exists(MANUAL_FILE):
        return []
    try:
        data = json.loads(open(MANUAL_FILE).read())
        return data.get(d.isoformat(), [])
    except Exception:
        return []


def _save_manual(d: date, ships: list[dict]):
    data = {}
    if os.path.exists(MANUAL_FILE):
        try:
            data = json.loads(open(MANUAL_FILE).read())
        except Exception:
            pass
    data[d.isoformat()] = ships
    cutoff = (d - timedelta(days=30)).isoformat()
    data = {k: v for k, v in data.items() if k >= cutoff}
    with open(MANUAL_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _manual_to_entries(ships: list[dict], ref: date) -> list[BerthEntry]:
    from scraper import _parse_dt
    entries = []
    for s in ships:
        arr_dt = _parse_dt(s.get("arrival", ""), ref)
        dep_dt = _parse_dt(s.get("departure", ""), ref)
        entries.append(BerthEntry(
            berth=s.get("berth", ""),
            ship_name=s.get("ship", ""),
            arrival=arr_dt.isoformat() if arr_dt else None,
            departure=dep_dt.isoformat() if dep_dt else None,
            agent=s.get("agent", ""),
            load_info="",
        ))
    return entries


# ── Komut handler'ları ────────────────────────────────────────────────────────

async def cmd_kimlik(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/kimlik — Chat ID'ni gösterir (zamanlanmış bildirimler için gerekli)."""
    cid = update.effective_chat.id
    await update.message.reply_text(
        f"🚢 Chat ID'niz: `{cid}`\n\n"
        f"Zamanlanmış sabah raporu için `.env` dosyasına "
        f"`TELEGRAM_CHAT_ID={cid}` ekleyin.",
        parse_mode="Markdown",
        reply_markup=_menu_kb(),
    )


async def cmd_yardim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = (
        "📋 *Liman komutları:*\n\n"
        "*Vardiya takvimi:*\n"
        "/vardiya\\_ekle 2026-06-08 — gün ekle\n"
        "/vardiyalar — yaklaşan vardiyalar\n"
        "/vardiya\\_sil 2026-06-08 — gün sil\n\n"
        "*Raporlar:*\n"
        "/kontrol — bugünkü raporu canlı çek\n"
        "/rapor — gün + vardiya sorgula\n"
        "  örn: /rapor yarin 8 4 _(yarın 08:00–16:00)_\n"
        "  örn: /rapor 4 12 _(bugün 16:00–24:00)_\n"
        "  örn: /rapor 2026-06-10 gece\n"
        "  vardiyalar: 8-4, 4-12, 12-8 ya da düz saat (16 24)\n"
        "/liste 2 — N gün boyu gün-boyu tüm gemiler\n"
        "  örn: /liste 2 _(bugün+yarın)_, /liste yarin 3\n"
        "/gemi MSC ALIX — tek gemi detayı\n"
        "/rihtim B3 — o rıhtımdaki gemiler\n"
        "/simdi — şu an limanda olanlar\n"
        "/degisiklik — kayıtlı veriye göre değişenler\n"
        "/cizelge — rıhtım doluluk çizelgesi (görsel)\n"
        "/menu — butonlu menü _(yazmadan kullan)_\n"
        "/prefetch — yarınki veriyi şimdi çek\n\n"
        "*Manuel gemi girişi _(scraping çalışmıyorsa):_*\n"
        "/gemi\\_ekle MSC BELLA BERTH2 06:00 20:00 NAF\n"
        "  format: /gemi\\_ekle GemiAdı Rıhtım Geliş Çıkış Acente\n"
        "  saat formatı: SS:DD _(bugünün tarihi kullanılır)_\n"
        "/gemiler — manuel girilen gemiler\n"
        "/gemi\\_sil GemiAdı — sil"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_vardiya_ekle(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "Kullanım: /vardiya\\_ekle YYYY-MM-DD\n"
            "Örnek: /vardiya\\_ekle 2026-06-08 2026-06-10",
            parse_mode="Markdown",
        )
        return
    added, skipped, errors = [], [], []
    for arg in ctx.args:
        try:
            d = date.fromisoformat(arg.strip())
            (added if add_shift(d) else skipped).append(format_date_tr(d))
        except ValueError:
            errors.append(arg)
    parts = []
    if added:   parts.append("✅ Eklendi:\n" + "\n".join(f"  • {x}" for x in added))
    if skipped: parts.append("ℹ️ Zaten vardı:\n" + "\n".join(f"  • {x}" for x in skipped))
    if errors:  parts.append(f"❌ Geçersiz format: {', '.join(errors)}")
    await update.message.reply_text("\n\n".join(parts) or "Tamam.")


async def cmd_vardiyalar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    upcoming = get_upcoming_shifts(days=60)
    await update.message.reply_text(build_shifts_list(upcoming), parse_mode="Markdown")


async def cmd_vardiya_sil(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text("Kullanım: /vardiya\\_sil YYYY-MM-DD", parse_mode="Markdown")
        return
    removed, not_found, errors = [], [], []
    for arg in ctx.args:
        try:
            d = date.fromisoformat(arg.strip())
            (removed if remove_shift(d) else not_found).append(format_date_tr(d))
        except ValueError:
            errors.append(arg)
    parts = []
    if removed:   parts.append("🗑️ Silindi:\n" + "\n".join(f"  • {x}" for x in removed))
    if not_found: parts.append("ℹ️ Bulunamadı:\n" + "\n".join(f"  • {x}" for x in not_found))
    if errors:    parts.append(f"❌ Geçersiz format: {', '.join(errors)}")
    await update.message.reply_text("\n\n".join(parts) or "Tamam.")


async def cmd_kontrol(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    today = datetime.now(TZ).date()
    await update.message.reply_text("🔍 Canlı veri çekiliyor...")

    report = get_shift_report(today, config.SHIFT_START_HOUR, config.SHIFT_END_HOUR)

    manual = _manual_to_entries(_load_manual(today), today)
    if manual:
        report["at_port"] += [e for e in manual if e.is_active_during(
            datetime.combine(today, dtime(config.SHIFT_START_HOUR)),
            datetime.combine(today, dtime(config.SHIFT_END_HOUR)))]

    await update.message.reply_text(build_shift_message(report), parse_mode="Markdown")


# ── Esnek vardiya sorgusu ─────────────────────────────────────────────────────

_SHIFT_ALIASES = {
    (8, 4):  (8, 16),  (8, 16):  (8, 16),
    (4, 12): (16, 24), (16, 24): (16, 24),
    (12, 8): (0, 8),   (0, 8):   (0, 8),  (24, 8): (0, 8),
}
_SHIFT_NAMES = {
    "gunduz": (8, 16), "gündüz": (8, 16),
    "aksam":  (16, 24), "akşam":  (16, 24),
    "gece":   (0, 8),
}


def _resolve_shift(nums: list[int]) -> tuple[int, int]:
    if len(nums) < 2:
        return config.SHIFT_START_HOUR, config.SHIFT_END_HOUR
    a, b = nums[0], nums[1]
    if (a, b) in _SHIFT_ALIASES:
        return _SHIFT_ALIASES[(a, b)]
    if 0 <= a < b <= 24:
        return a, b
    if b <= a:
        return a, b + 12
    return a, b


def _parse_rapor_args(args: list[str], today: date) -> tuple[date, int, int]:
    target = today
    nums: list[int] = []
    for a in args:
        al = a.lower()
        if al in ("bugun", "bugün"):
            target = today
        elif al in ("yarin", "yarın"):
            target = today + timedelta(days=1)
        elif al in ("dun", "dün"):
            target = today - timedelta(days=1)
        elif al in _SHIFT_NAMES:
            nums = list(_SHIFT_NAMES[al])
        else:
            try:
                target = date.fromisoformat(a)
                continue
            except ValueError:
                pass
            try:
                nums.append(int(a))
            except ValueError:
                pass
    start_h, end_h = _resolve_shift(nums)
    return target, start_h, end_h


def _merge_manual(report: dict, target: date, start_h: int, end_h: int):
    manual = _manual_to_entries(_load_manual(target), target)
    if not manual:
        return
    midnight = datetime.combine(target, dtime(0, 0))
    s = midnight + timedelta(hours=start_h)
    e = midnight + timedelta(hours=end_h)
    report["at_port"]   += [m for m in manual if m.is_active_during(s, e)]
    report["departing"] += [m for m in manual if m.departs_during(s, e)]
    report["arriving"]  += [m for m in manual if m.arrives_during(s, e)]


async def cmd_rapor(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    today = datetime.now(TZ).date()
    target, start_h, end_h = _parse_rapor_args(ctx.args, today)
    await update.message.reply_text(
        f"🔍 {target.isoformat()} {start_h:02d}:00–{end_h:02d}:00 için veri çekiliyor..."
    )
    report = get_shift_report(target, start_h, end_h)
    _merge_manual(report, target, start_h, end_h)
    await update.message.reply_text(build_shift_message(report), parse_mode="Markdown")


async def cmd_liste(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    today = datetime.now(TZ).date()
    start = today
    ndays = 1
    for a in ctx.args:
        al = a.lower()
        if al in ("bugun", "bugün"):
            start = today
        elif al in ("yarin", "yarın"):
            start = today + timedelta(days=1)
        elif al in ("dun", "dün"):
            start = today - timedelta(days=1)
        else:
            try:
                start = date.fromisoformat(a)
                continue
            except ValueError:
                pass
            try:
                ndays = max(1, min(7, int(a)))
            except ValueError:
                pass
    await update.message.reply_text(f"🔍 {ndays} günlük gemi listesi çekiliyor...")
    for i in range(ndays):
        d = start + timedelta(days=i)
        entries, _ = fetch_entries(d)
        await update.message.reply_text(build_day_overview(d, entries), parse_mode="Markdown")


async def cmd_gemi(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "Kullanım: /gemi GemiAdı\nÖrnek: /gemi MSC ALIX", parse_mode="Markdown")
        return
    query = " ".join(ctx.args).upper()
    today = datetime.now(TZ).date()
    entries, _ = fetch_entries(today)
    matches = [e for e in entries if query in e.ship_name.upper()]
    if not matches:
        await update.message.reply_text(f"'{query}' bugünkü listede bulunamadı.")
        return
    if len(matches) > 6:
        await update.message.reply_text(f"{len(matches)} eşleşme bulundu, ilk 6 gösteriliyor.")
        matches = matches[:6]
    for e in matches:
        await update.message.reply_text(build_ship_detail(e), parse_mode="Markdown")


async def cmd_rihtim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "Kullanım: /rihtim B3\nÖrnek: /rihtim FB1", parse_mode="Markdown")
        return
    berth = ctx.args[0]
    today = datetime.now(TZ).date()
    entries, _ = fetch_entries(today)
    await update.message.reply_text(
        build_berth_view(today, berth, entries), parse_mode="Markdown")


async def cmd_simdi(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    now = datetime.now(TZ)
    today = now.date()
    entries, _ = fetch_entries(today)
    now_naive = now.replace(tzinfo=None)
    at = [e for e in entries if e.is_active_at(now_naive)]
    at.sort(key=lambda e: e.departure or "")
    title = f"🕘 *Şu an limanda* ({now.strftime('%H:%M')})"
    await update.message.reply_text(build_ship_list(title, today, at), parse_mode="Markdown")


async def cmd_degisiklik(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    today = datetime.now(TZ).date()
    target = today
    if ctx.args:
        a = ctx.args[0].lower()
        if a in ("yarin", "yarın"):
            target = today + timedelta(days=1)
        else:
            try:
                target = date.fromisoformat(ctx.args[0])
            except ValueError:
                pass
    await update.message.reply_text(
        f"🔄 {target.isoformat()} için değişiklikler kontrol ediliyor...")
    diff, source = fetch_live_diff(target)
    if source == "no_data":
        await update.message.reply_text("❌ Canlı veri çekilemedi.")
        return
    if not diff:
        await update.message.reply_text(
            "ℹ️ Karşılaştırılacak önceki kayıt yoktu (ilk çekiş). "
            "Veri şimdi kaydedildi; bir sonraki sefer değişiklikleri gösteririm.")
        return
    await update.message.reply_text(build_diff_message(target, diff), parse_mode="Markdown")


# ── Dokunmatik menü + çizelge ─────────────────────────────────────────────────

def _report_text(target: date, start_h: int, end_h: int) -> str:
    report = get_shift_report(target, start_h, end_h)
    _merge_manual(report, target, start_h, end_h)
    return build_shift_message(report)


def _now_text() -> str:
    now = datetime.now(TZ)
    today = now.date()
    entries, _ = fetch_entries(today)
    nn = now.replace(tzinfo=None)
    at = sorted((e for e in entries if e.is_active_at(nn)), key=lambda e: e.departure or "")
    return build_ship_list(f"🕘 *Şu an limanda* ({now.strftime('%H:%M')})", today, at)


def _menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📋 Bugün",    callback_data=_CB + "today"),
         InlineKeyboardButton("📅 Yarın",    callback_data=_CB + "tomorrow")],
        [InlineKeyboardButton("🕘 Şimdi",    callback_data=_CB + "now"),
         InlineKeyboardButton("📆 2 Gün",    callback_data=_CB + "two")],
        [InlineKeyboardButton("⚓ Rıhtımlar", callback_data=_CB + "berths"),
         InlineKeyboardButton("📊 Çizelge",  callback_data=_CB + "chart")],
        [InlineKeyboardButton("🔄 Değişiklik", callback_data=_CB + "diff")],
    ])


def _back_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Menü", callback_data=_CB + "menu")]])


def _berth_kb(berths: list[str]) -> InlineKeyboardMarkup:
    btns = [InlineKeyboardButton(b, callback_data=_CB + f"berth:{b}") for b in berths]
    rows = [btns[i:i + 3] for i in range(0, len(btns), 3)]
    rows.append([InlineKeyboardButton("⬅️ Menü", callback_data=_CB + "menu")])
    return InlineKeyboardMarkup(rows)


async def cmd_menu(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📋 *Menü* — bir seçenek seç:", reply_markup=_menu_kb(), parse_mode="Markdown")


async def cmd_cizelge(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if build_gantt is None:
        await update.message.reply_text("Çizelge için matplotlib kurulu değil (pip install matplotlib).")
        return
    today = datetime.now(TZ).date()
    days = 3
    if ctx.args:
        try:
            days = max(1, min(7, int(ctx.args[0])))
        except ValueError:
            pass
    entries, _ = fetch_entries(today)
    png = build_gantt(entries, today, days=days)
    if png:
        await update.message.reply_photo(photo=BytesIO(png),
                                          caption=f"⚓ Rıhtım çizelgesi ({days} gün)")
    else:
        await update.message.reply_text("Çizelge için veri bulunamadı.")


async def callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """main.py'nin "liman:..." ile başlayan buton tıklamalarını yönlendirdiği yer.

    Namespace ön ekini ("liman:") soyup, eski on_callback mantığını aynen çalıştırır.
    """
    q = update.callback_query
    await q.answer()
    data = (q.data or "").split(":", 1)[1] if ":" in (q.data or "") else (q.data or "")
    today = datetime.now(TZ).date()
    try:
        if data == "menu":
            await q.edit_message_text("📋 *Menü* — bir seçenek seç:",
                                      reply_markup=_menu_kb(), parse_mode="Markdown")
        elif data == "today":
            await q.edit_message_text(
                _report_text(today, config.SHIFT_START_HOUR, config.SHIFT_END_HOUR),
                reply_markup=_back_kb(), parse_mode="Markdown")
        elif data == "tomorrow":
            t = today + timedelta(days=1)
            await q.edit_message_text(
                _report_text(t, config.SHIFT_START_HOUR, config.SHIFT_END_HOUR),
                reply_markup=_back_kb(), parse_mode="Markdown")
        elif data == "now":
            await q.edit_message_text(_now_text(), reply_markup=_back_kb(), parse_mode="Markdown")
        elif data == "two":
            for i in range(2):
                d = today + timedelta(days=i)
                ents, _ = fetch_entries(d)
                await q.message.reply_text(build_day_overview(d, ents), parse_mode="Markdown")
        elif data == "berths":
            ents, _ = fetch_entries(today)
            berths = sorted({e.berth for e in ents if e.berth})
            if berths:
                await q.edit_message_text("⚓ *Rıhtım seç:*",
                                          reply_markup=_berth_kb(berths), parse_mode="Markdown")
            else:
                await q.edit_message_text("Bugün rıhtım verisi yok.", reply_markup=_back_kb())
        elif data.startswith("berth:"):
            b = data.split(":", 1)[1]
            ents, _ = fetch_entries(today)
            await q.edit_message_text(build_berth_view(today, b, ents),
                                      reply_markup=_back_kb(), parse_mode="Markdown")
        elif data == "chart":
            if build_gantt is None:
                await q.message.reply_text("Çizelge için matplotlib kurulu değil.")
            else:
                ents, _ = fetch_entries(today)
                png = build_gantt(ents, today, days=3)
                if png:
                    await q.message.reply_photo(photo=BytesIO(png),
                                                caption="⚓ Rıhtım çizelgesi (3 gün)")
                else:
                    await q.message.reply_text("Çizelge için veri yok.")
        elif data == "diff":
            diff, source = fetch_live_diff(today)
            if source == "no_data":
                txt = "❌ Canlı veri çekilemedi."
            elif not diff:
                txt = "ℹ️ Karşılaştıracak önceki kayıt yok (ilk çekiş)."
            else:
                txt = build_diff_message(today, diff)
            await q.edit_message_text(txt, reply_markup=_back_kb(), parse_mode="Markdown")
    except Exception as e:
        log.warning(f"callback hatası ({data}): {e}")


async def cmd_prefetch(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    today = datetime.now(TZ).date()
    await update.message.reply_text(
        "📡 Yarınki gemi verisi çekiliyor...\n_(Liman WiFi'sindeyken çalıştırın)_",
        parse_mode="Markdown",
    )
    count, source = prefetch_tomorrow(today)
    if count:
        await update.message.reply_text(
            f"✅ {count} gemi bilgisi kaydedildi.\n"
            f"Yarın sabah 07:30'da otomatik gönderilecek."
        )
    else:
        await update.message.reply_text(
            "❌ Veri çekilemedi.\n"
            "Liman WiFi'sine bağlı olduğunuzdan emin olun.\n"
            "Ya da /gemi\\_ekle ile manuel girebilirsiniz.",
            parse_mode="Markdown",
        )


async def cmd_gemi_ekle(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if not args or len(args) < 4:
        await update.message.reply_text(
            "Kullanım:\n"
            "/gemi\\_ekle GemiAdı Rıhtım Geliş Çıkış [Acente]\n\n"
            "Örnek:\n"
            "/gemi\\_ekle BELLAVIA BERTH3 08:00 18:00 NAF\n\n"
            "Yarın için:\n"
            "/gemi\\_ekle BELLAVIA BERTH3 08:00 18:00 NAF --yarin",
            parse_mode="Markdown",
        )
        return

    tomorrow = "--yarin" in args
    args = [a for a in args if a != "--yarin"]
    target = datetime.now(TZ).date() + timedelta(days=1 if tomorrow else 0)

    if len(args) >= 4:
        ship  = " ".join(args[:-3]) if len(args) > 4 else args[0]
        berth = args[-3] if len(args) > 3 else args[1]
        arr   = args[-2] if len(args) > 2 else args[2]
        dep   = args[-1] if len(args) > 1 else args[3]
        agent = ""
    if len(args) >= 5:
        ship  = " ".join(args[:-4]) if len(args) > 5 else args[0]
        berth = args[-4]
        arr   = args[-3]
        dep   = args[-2]
        agent = args[-1]

    ships = _load_manual(target)
    ships.append({"ship": ship, "berth": berth, "arrival": arr, "departure": dep, "agent": agent})
    _save_manual(target, ships)

    label = "yarın" if tomorrow else "bugün"
    await update.message.reply_text(
        f"✅ Eklendi ({label} — {format_date_tr(target)}):\n"
        f"  *{ship}* | {berth} | {arr}→{dep} | {agent}",
        parse_mode="Markdown",
    )


async def cmd_gemiler(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    today = datetime.now(TZ).date()
    tomorrow = today + timedelta(days=1)
    lines = [f"📋 *Manuel girilen gemiler:*\n"]
    for label, d in [("Bugün", today), ("Yarın", tomorrow)]:
        ships = _load_manual(d)
        if ships:
            lines.append(f"*{label} ({format_date_tr(d)}):*")
            for s in ships:
                lines.append(f"  • {s['ship']} | {s['berth']} | {s['arrival']}→{s['departure']} | {s['agent']}")
    if len(lines) == 1:
        lines.append("Kayıtlı manuel gemi yok.")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_gemi_sil(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text("Kullanım: /gemi\\_sil GemiAdı [--yarin]", parse_mode="Markdown")
        return
    tomorrow = "--yarin" in ctx.args
    args = [a for a in ctx.args if a != "--yarin"]
    ship_name = " ".join(args).upper()
    target = datetime.now(TZ).date() + timedelta(days=1 if tomorrow else 0)
    ships = _load_manual(target)
    new_ships = [s for s in ships if s["ship"].upper() != ship_name]
    if len(new_ships) == len(ships):
        await update.message.reply_text(f"'{ship_name}' bulunamadı.")
        return
    _save_manual(target, new_ships)
    await update.message.reply_text(f"🗑️ '{ship_name}' silindi.")


# ── Zamanlanmış görevler (PTB job_queue) ──────────────────────────────────────

async def job_morning_report(ctx: ContextTypes.DEFAULT_TYPE):
    """07:30 — Bugün vardiya ise raporu CHAT_ID'ye gönder."""
    today = datetime.now(TZ).date()
    if not is_shift_day(today):
        log.info(f"{today} vardiya değil.")
        return
    if not config.CHAT_ID:
        log.error("TELEGRAM_CHAT_ID ayarlanmamış!")
        return

    report = get_shift_report(today, config.SHIFT_START_HOUR, config.SHIFT_END_HOUR)
    manual = _manual_to_entries(_load_manual(today), today)
    s = datetime.combine(today, dtime(config.SHIFT_START_HOUR))
    e = datetime.combine(today, dtime(config.SHIFT_END_HOUR))
    report["at_port"]   += [m for m in manual if m.is_active_during(s, e)]
    report["departing"] += [m for m in manual if m.departs_during(s, e)]
    report["arriving"]  += [m for m in manual if m.arrives_during(s, e)]

    await ctx.bot.send_message(
        chat_id=config.CHAT_ID, text=build_shift_message(report), parse_mode="Markdown")
    log.info("Sabah raporu gönderildi.")


async def job_prefetch(ctx: ContextTypes.DEFAULT_TYPE):
    """18:00 — Yarınki gemi verisini çek ve cache'e kaydet."""
    today = datetime.now(TZ).date()
    tomorrow = today + timedelta(days=1)
    if not is_shift_day(tomorrow):
        log.info(f"Yarın ({tomorrow}) vardiya değil, pre-fetch atlandı.")
        return

    log.info(f"Pre-fetch başlıyor: {tomorrow}")
    diff, source = fetch_live_diff(tomorrow)
    entries, _ = fetch_entries(tomorrow)
    count = len(entries)
    if count:
        log.info(f"Pre-fetch tamamlandı: {count} gemi ({source})")
        if config.CHAT_ID:
            await ctx.bot.send_message(
                chat_id=config.CHAT_ID,
                text=f"📦 Yarının gemi verisi hazırlandı ({count} gemi). Sabah 07:30'da gönderilecek.")
            if diff and (diff.get("added") or diff.get("removed") or diff.get("changed")):
                await ctx.bot.send_message(
                    chat_id=config.CHAT_ID,
                    text=build_diff_message(tomorrow, diff), parse_mode="Markdown")
    else:
        log.warning("Pre-fetch başarısız, veri bulunamadı.")
        if config.CHAT_ID:
            await ctx.bot.send_message(
                chat_id=config.CHAT_ID,
                text="⚠️ Yarınki gemi verisi çekilemedi.\n"
                     "Liman WiFi'sine bağlıysanız /prefetch veya /gemi\\_ekle deneyin.",
                parse_mode="Markdown")


# ── main.py sözleşmesi: komutlar + setup hook ─────────────────────────────────

KOMUT_HANDLERS = {
    "kimlik":       cmd_kimlik,
    "yardim":       cmd_yardim,
    "vardiya_ekle": cmd_vardiya_ekle,
    "vardiyalar":   cmd_vardiyalar,
    "vardiya_sil":  cmd_vardiya_sil,
    "kontrol":      cmd_kontrol,
    "rapor":        cmd_rapor,
    "liste":        cmd_liste,
    "gemi":         cmd_gemi,
    "rihtim":       cmd_rihtim,
    "simdi":        cmd_simdi,
    "degisiklik":   cmd_degisiklik,
    "menu":         cmd_menu,
    "cizelge":      cmd_cizelge,
    "prefetch":     cmd_prefetch,
    "gemi_ekle":    cmd_gemi_ekle,
    "gemiler":      cmd_gemiler,
    "gemi_sil":     cmd_gemi_sil,
}

# Telegram'da "/" yazınca çıkacak menü açıklamaları (main.py topluyor).
KOMUT_ACIKLAMA = {
    "kimlik":       "Chat ID'ni göster",
    "yardim":       "Liman komut listesi",
    "vardiya_ekle": "Vardiya günü ekle",
    "vardiyalar":   "Yaklaşan vardiyalar",
    "vardiya_sil":  "Vardiya günü sil",
    "kontrol":      "Raporu şimdi göster",
    "rapor":        "Gün + vardiya sorgula",
    "liste":        "N gün boyu tüm gemiler",
    "gemi":         "Tek gemi detayı",
    "rihtim":       "Rıhtımdaki gemiler",
    "simdi":        "Şu an limanda",
    "degisiklik":   "Değişiklikleri göster",
    "menu":         "Dokunmatik menü",
    "cizelge":      "Rıhtım çizelgesi (görsel)",
    "prefetch":     "Yarınki veriyi çek",
    "gemi_ekle":    "Manuel gemi ekle",
    "gemiler":      "Manuel gemiler",
    "gemi_sil":     "Manuel gemi sil",
}


async def setup(app: Application) -> None:
    """Bot başlarken çağrılır. Otomatik veri çekme SADECE config.LIMAN_OTOMATIK
    açıksa kurulur; varsayılan kapalıdır (veri yalnızca komutla çekilir)."""
    if not config.LIMAN_OTOMATIK:
        log.info("Otomatik liman görevleri KAPALI (veri sadece komutla çekilir). "
                 "Açmak için .env'e LIMAN_OTOMATIK=1 ekle.")
        return

    jq = app.job_queue
    if jq is None:
        log.warning("job_queue yok; zamanlanmış görevler kurulamadı "
                    "(pip install \"python-telegram-bot[job-queue]\").")
        return
    jq.run_daily(job_morning_report,
                 time=dtime(config.NOTIFY_HOUR, config.NOTIFY_MINUTE, tzinfo=TZ),
                 name="morning_report")
    jq.run_daily(job_prefetch,
                 time=dtime(config.PREFETCH_HOUR, config.PREFETCH_MINUTE, tzinfo=TZ),
                 name="prefetch")
    log.info("Liman görevleri kuruldu: 07:30 rapor + 18:00 pre-fetch.")
