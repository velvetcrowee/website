#!/usr/bin/env python3
"""
Asya Port Vardiya Telegram Botu
Termux (Android) üzerinde çalışır.

Mantık:
  18:00 (vardiya biterken, liman WiFi'si varken) → ertesi günün gemilerini çek
  07:30 (vardiya sabahı)                         → cache'ten raporu gönder

Komutlar:
  /start           - Botu başlat
  /vardiya_ekle    - Vardiya günü ekle
  /vardiyalar      - Yaklaşan vardiyaları listele
  /vardiya_sil     - Vardiya günü sil
  /kontrol         - Bugünkü raporu şimdi göster (canlı çeker)
  /prefetch        - Yarınki veriyi şimdi çek (liman WiFi'sinde ol)
  /gemi_ekle       - Gemi manuel ekle (scraping çalışmıyorsa)
  /gemiler         - Manuel eklenen gemileri listele
  /yardim          - Komut listesi
"""

import logging
import json
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from telegram import Update, BotCommand
from telegram.ext import Application, CommandHandler, ContextTypes
from telegram.constants import ParseMode
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import config
from scraper import (
    get_shift_report, fetch_live, fetch_entries, fetch_live_diff,
    prefetch_tomorrow, BerthEntry, _save_cache,
)
from shift_manager import (
    add_shift, remove_shift, is_shift_day, get_upcoming_shifts, format_date_tr,
)
from formatter import (
    build_shift_message, build_shifts_list, build_ship_detail,
    build_ship_list, build_berth_view, build_diff_message,
)

logging.basicConfig(
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)
TZ = ZoneInfo(config.TIMEZONE)

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
    # Eski kayıtları temizle (30 günden eski)
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

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cid = update.effective_chat.id
    await update.message.reply_text(
        f"🚢 *Asya Port Vardiya Botu*\n\n"
        f"Chat ID'niz: `{cid}`\n\n"
        f"Bu ID'yi `.env` dosyasına `TELEGRAM_CHAT_ID={cid}` olarak ekleyin.\n\n"
        f"Komutlar için /yardim yazın.",
        parse_mode="Markdown",
    )


async def cmd_yardim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = (
        "📋 *Komutlar:*\n\n"
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
        "/gemi MSC ALIX — tek gemi detayı\n"
        "/rihtim B3 — o rıhtımdaki gemiler\n"
        "/simdi — şu an limanda olanlar\n"
        "/degisiklik — kayıtlı veriye göre değişenler\n"
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

    # Manuel gemileri ekle
    manual = _manual_to_entries(_load_manual(today), today)
    if manual:
        report["at_port"]   += [e for e in manual if e.is_active_during(
            datetime.combine(today, __import__("datetime").time(config.SHIFT_START_HOUR)),
            datetime.combine(today, __import__("datetime").time(config.SHIFT_END_HOUR)))]

    await update.message.reply_text(
        build_shift_message(report), parse_mode="Markdown"
    )


# ── Esnek vardiya sorgusu ─────────────────────────────────────────────────────

# Türkiye'deki klasik 3 vardiya: 8-4 / 4-12 / 12-8  (sözel kısaltma -> 24 saat)
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
    """İki saat sayısını 24-saatlik (start, end) vardiya penceresine çevirir."""
    if len(nums) < 2:
        return config.SHIFT_START_HOUR, config.SHIFT_END_HOUR
    a, b = nums[0], nums[1]
    if (a, b) in _SHIFT_ALIASES:
        return _SHIFT_ALIASES[(a, b)]
    if 0 <= a < b <= 24:
        return a, b              # düz 24-saat aralığı
    if b <= a:                   # "8 4" gibi -> bitişi öğleden sonraya taşı
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
    from datetime import time as dtime
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
    """
    Belirli gün + vardiya için rapor.
    Örnekler:
      /rapor yarin 8 4   -> yarın 08:00–16:00
      /rapor 4 12        -> bugün 16:00–24:00
      /rapor 2026-06-10 gece
    """
    today = datetime.now(TZ).date()
    target, start_h, end_h = _parse_rapor_args(ctx.args, today)
    await update.message.reply_text(
        f"🔍 {target.isoformat()} {start_h:02d}:00–{end_h:02d}:00 için veri çekiliyor..."
    )
    report = get_shift_report(target, start_h, end_h)
    _merge_manual(report, target, start_h, end_h)
    await update.message.reply_text(
        build_shift_message(report), parse_mode="Markdown"
    )


async def cmd_gemi(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/gemi MSC ALIX → eşleşen geminin/gemilerin tüm detayı."""
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
        await update.message.reply_text(
            f"{len(matches)} eşleşme bulundu, ilk 6 gösteriliyor.")
        matches = matches[:6]
    for e in matches:
        await update.message.reply_text(build_ship_detail(e), parse_mode="Markdown")


async def cmd_rihtim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/rihtim B3 → o rıhtımdaki gemiler, yanaşma sırasına göre."""
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
    """/simdi → tam şu anki saate göre limandaki gemiler."""
    now = datetime.now(TZ)
    today = now.date()
    entries, _ = fetch_entries(today)
    now_naive = now.replace(tzinfo=None)
    at = [e for e in entries if e.is_active_at(now_naive)]
    at.sort(key=lambda e: e.departure or "")
    title = f"🕘 *Şu an limanda* ({now.strftime('%H:%M')})"
    await update.message.reply_text(
        build_ship_list(title, today, at), parse_mode="Markdown")


async def cmd_degisiklik(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/degisiklik [yarin|tarih] → kayıtlı veriyle canlıyı karşılaştır."""
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
    await update.message.reply_text(
        build_diff_message(target, diff), parse_mode="Markdown")


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
    """
    Kullanım: /gemi_ekle GemiAdı Rıhtım Geliş Çıkış [Acente]
    Örnek:    /gemi_ekle "MSC BELLA" BERTH2 06:00 20:00 NAF
    Saatler HH:MM formatında, bugünün tarihi kullanılır.
    Sonraki günün gemisi için: /gemi_ekle ... --yarin
    """
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

    # Gemi adı birden fazla kelime olabilir
    # Format: son 3 (veya 4 acente dahil) parametre: rıhtım geliş çıkış [acente]
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


# ── Zamanlanmış görevler ──────────────────────────────────────────────────────

async def job_morning_report(app: Application):
    """07:30 — Bugün vardiya ise raporu gönder."""
    today = datetime.now(TZ).date()
    if not is_shift_day(today):
        log.info(f"{today} vardiya değil.")
        return
    if not config.CHAT_ID:
        log.error("TELEGRAM_CHAT_ID ayarlanmamış!")
        return

    report = get_shift_report(today, config.SHIFT_START_HOUR, config.SHIFT_END_HOUR)

    # Manuel gemileri birleştir
    from datetime import time as dtime
    manual = _manual_to_entries(_load_manual(today), today)
    s = datetime.combine(today, dtime(config.SHIFT_START_HOUR))
    e = datetime.combine(today, dtime(config.SHIFT_END_HOUR))
    report["at_port"]   += [m for m in manual if m.is_active_during(s, e)]
    report["departing"] += [m for m in manual if m.departs_during(s, e)]
    report["arriving"]  += [m for m in manual if m.arrives_during(s, e)]

    text = build_shift_message(report)
    await app.bot.send_message(chat_id=config.CHAT_ID, text=text, parse_mode="Markdown")
    log.info("Sabah raporu gönderildi.")


async def job_prefetch(app: Application):
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
            await app.bot.send_message(
                chat_id=config.CHAT_ID,
                text=f"📦 Yarının gemi verisi hazırlandı ({count} gemi). Sabah 07:30'da gönderilecek."
            )
            # Önceki kayda göre değişiklik varsa ayrıca bildir
            if diff and (diff.get("added") or diff.get("removed") or diff.get("changed")):
                await app.bot.send_message(
                    chat_id=config.CHAT_ID,
                    text=build_diff_message(tomorrow, diff),
                    parse_mode="Markdown",
                )
    else:
        log.warning("Pre-fetch başarısız, veri bulunamadı.")
        if config.CHAT_ID:
            await app.bot.send_message(
                chat_id=config.CHAT_ID,
                text="⚠️ Yarınki gemi verisi çekilemedi.\n"
                     "Liman WiFi'sine bağlıysanız /prefetch veya /gemi\\_ekle deneyin.",
                parse_mode="Markdown",
            )


# ── Ana akış ─────────────────────────────────────────────────────────────────

def main():
    if not config.BOT_TOKEN:
        raise SystemExit("TELEGRAM_BOT_TOKEN ayarlanmamış!\nexport TELEGRAM_BOT_TOKEN='...'")

    app = Application.builder().token(config.BOT_TOKEN).build()

    app.add_handler(CommandHandler("start",        cmd_start))
    app.add_handler(CommandHandler("yardim",       cmd_yardim))
    app.add_handler(CommandHandler("vardiya_ekle", cmd_vardiya_ekle))
    app.add_handler(CommandHandler("vardiyalar",   cmd_vardiyalar))
    app.add_handler(CommandHandler("vardiya_sil",  cmd_vardiya_sil))
    app.add_handler(CommandHandler("kontrol",      cmd_kontrol))
    app.add_handler(CommandHandler("rapor",        cmd_rapor))
    app.add_handler(CommandHandler("gemi",         cmd_gemi))
    app.add_handler(CommandHandler("rihtim",       cmd_rihtim))
    app.add_handler(CommandHandler("simdi",        cmd_simdi))
    app.add_handler(CommandHandler("degisiklik",   cmd_degisiklik))
    app.add_handler(CommandHandler("prefetch",     cmd_prefetch))
    app.add_handler(CommandHandler("gemi_ekle",    cmd_gemi_ekle))
    app.add_handler(CommandHandler("gemiler",      cmd_gemiler))
    app.add_handler(CommandHandler("gemi_sil",     cmd_gemi_sil))

    scheduler = AsyncIOScheduler(timezone=config.TIMEZONE)

    # 07:30 — Sabah raporu
    scheduler.add_job(
        job_morning_report, args=[app],
        trigger=CronTrigger(hour=config.NOTIFY_HOUR, minute=config.NOTIFY_MINUTE,
                            timezone=config.TIMEZONE),
        id="morning_report", replace_existing=True,
    )

    # 18:00 — Pre-fetch (vardiya bitişi)
    scheduler.add_job(
        job_prefetch, args=[app],
        trigger=CronTrigger(hour=config.PREFETCH_HOUR, minute=config.PREFETCH_MINUTE,
                            timezone=config.TIMEZONE),
        id="prefetch", replace_existing=True,
    )

    async def post_init(a: Application):
        await a.bot.set_my_commands([
            BotCommand("start",        "Botu başlat"),
            BotCommand("yardim",       "Komut listesi"),
            BotCommand("vardiya_ekle", "Vardiya günü ekle"),
            BotCommand("vardiyalar",   "Yaklaşan vardiyalar"),
            BotCommand("vardiya_sil",  "Vardiya günü sil"),
            BotCommand("kontrol",      "Raporu şimdi göster"),
            BotCommand("rapor",        "Gün + vardiya sorgula"),
            BotCommand("gemi",         "Tek gemi detayı"),
            BotCommand("rihtim",       "Rıhtımdaki gemiler"),
            BotCommand("simdi",        "Şu an limanda"),
            BotCommand("degisiklik",   "Değişiklikleri göster"),
            BotCommand("prefetch",     "Yarınki veriyi çek"),
            BotCommand("gemi_ekle",    "Manuel gemi ekle"),
            BotCommand("gemiler",      "Manuel gemiler"),
            BotCommand("gemi_sil",     "Manuel gemi sil"),
        ])
        scheduler.start()
        log.info("Bot başladı. 07:30 rapor + 18:00 pre-fetch aktif.")

    app.post_init = post_init
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
