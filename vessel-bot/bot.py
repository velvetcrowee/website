#!/usr/bin/env python3
"""
Asya Port Vardiya Telegram Botu

Kurulum:
    pip install -r requirements.txt
    export TELEGRAM_BOT_TOKEN="..."
    export TELEGRAM_CHAT_ID="..."
    python bot.py

Komutlar:
    /start           - Botu başlat, chat ID'yi öğren
    /vardiya_ekle    - Vardiya günü ekle
    /vardiyalar      - Vardiya listesi
    /vardiya_sil     - Vardiya günü sil
    /kontrol         - Bugünün gemi raporunu şimdi göster
"""

import logging
import asyncio
from datetime import date, datetime
from zoneinfo import ZoneInfo

from telegram import Update, BotCommand
from telegram.ext import (
    Application, CommandHandler, ContextTypes,
    CallbackContext,
)
from telegram.constants import ParseMode
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import config
from scraper import get_shift_report
from shift_manager import (
    add_shift, remove_shift, is_shift_day, get_upcoming_shifts,
    format_date_tr,
)
from formatter import build_shift_message, build_shifts_list

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

TZ = ZoneInfo(config.TIMEZONE)


# ── Komutlar ────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    text = (
        f"👋 Merhaba! Asya Port Vardiya Botu aktif.\n\n"
        f"Chat ID'niz: `{chat_id}`\n\n"
        f"Komutlar:\n"
        f"• /vardiya\\_ekle 2026-06-08 — vardiya günü ekle\n"
        f"• /vardiyalar — yaklaşan vardiyaları listele\n"
        f"• /vardiya\\_sil 2026-06-08 — vardiya günü sil\n"
        f"• /kontrol — bugünün raporunu şimdi göster\n\n"
        f"Her vardiya günü saat 07:30'da otomatik rapor gönderilir."
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN_V2.value.replace("V2", ""))


async def cmd_vardiya_ekle(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "Kullanım: /vardiya\\_ekle YYYY-MM-DD\n"
            "Örnek: /vardiya\\_ekle 2026-06-08\n\n"
            "Birden fazla gün: /vardiya\\_ekle 2026-06-08 2026-06-10 2026-06-12",
            parse_mode="Markdown",
        )
        return

    added = []
    skipped = []
    errors = []

    for arg in ctx.args:
        try:
            d = date.fromisoformat(arg.strip())
            if add_shift(d):
                added.append(format_date_tr(d))
            else:
                skipped.append(format_date_tr(d))
        except ValueError:
            errors.append(arg)

    msg_parts = []
    if added:
        msg_parts.append(f"✅ Eklendi:\n" + "\n".join(f"  • {x}" for x in added))
    if skipped:
        msg_parts.append(f"ℹ️ Zaten kayıtlı:\n" + "\n".join(f"  • {x}" for x in skipped))
    if errors:
        msg_parts.append(f"❌ Geçersiz format (YYYY-MM-DD olmalı): {', '.join(errors)}")

    await update.message.reply_text("\n\n".join(msg_parts) or "İşlem tamamlandı.")


async def cmd_vardiyalar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    upcoming = get_upcoming_shifts(days=60)
    text = build_shifts_list(upcoming)
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_vardiya_sil(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "Kullanım: /vardiya\\_sil YYYY-MM-DD\nÖrnek: /vardiya\\_sil 2026-06-08",
            parse_mode="Markdown",
        )
        return

    removed = []
    not_found = []
    errors = []

    for arg in ctx.args:
        try:
            d = date.fromisoformat(arg.strip())
            if remove_shift(d):
                removed.append(format_date_tr(d))
            else:
                not_found.append(format_date_tr(d))
        except ValueError:
            errors.append(arg)

    msg_parts = []
    if removed:
        msg_parts.append(f"🗑️ Silindi:\n" + "\n".join(f"  • {x}" for x in removed))
    if not_found:
        msg_parts.append(f"ℹ️ Kayıtlı değildi:\n" + "\n".join(f"  • {x}" for x in not_found))
    if errors:
        msg_parts.append(f"❌ Geçersiz format: {', '.join(errors)}")

    await update.message.reply_text("\n\n".join(msg_parts) or "İşlem tamamlandı.")


async def cmd_kontrol(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Şu anki gün için raporu hemen gönderir (vardiya günü olması şart değil)."""
    await update.message.reply_text("🔍 Veriler çekiliyor...")
    today = datetime.now(TZ).date()
    report = get_shift_report(today, config.SHIFT_START_HOUR, config.SHIFT_END_HOUR)
    text = build_shift_message(report)
    await update.message.reply_text(text, parse_mode="Markdown")


# ── Zamanlanmış görev ────────────────────────────────────────────────────────

async def scheduled_report(app: Application):
    """Her gün 07:30'da çalışır, sadece vardiya günlerinde mesaj gönderir."""
    today = datetime.now(TZ).date()

    if not is_shift_day(today):
        logger.info(f"{today} vardiya günü değil, bildirim gönderilmiyor.")
        return

    if not config.CHAT_ID:
        logger.error("TELEGRAM_CHAT_ID ayarlanmamış, bildirim gönderilemedi.")
        return

    logger.info(f"{today} vardiya günü, rapor hazırlanıyor...")
    report = get_shift_report(today, config.SHIFT_START_HOUR, config.SHIFT_END_HOUR)
    text = build_shift_message(report)

    await app.bot.send_message(
        chat_id=config.CHAT_ID,
        text=text,
        parse_mode="Markdown",
    )
    logger.info("Vardiya raporu gönderildi.")


# ── Ana akış ─────────────────────────────────────────────────────────────────

def main():
    if not config.BOT_TOKEN:
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN çevre değişkeni ayarlanmamış!\n"
            "  export TELEGRAM_BOT_TOKEN='buraya_token_yaz'"
        )

    app = (
        Application.builder()
        .token(config.BOT_TOKEN)
        .build()
    )

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("vardiya_ekle", cmd_vardiya_ekle))
    app.add_handler(CommandHandler("vardiyalar", cmd_vardiyalar))
    app.add_handler(CommandHandler("vardiya_sil", cmd_vardiya_sil))
    app.add_handler(CommandHandler("kontrol", cmd_kontrol))

    # Scheduler: her gün 07:30 İstanbul saatine göre çalış
    scheduler = AsyncIOScheduler(timezone=config.TIMEZONE)
    scheduler.add_job(
        scheduled_report,
        trigger=CronTrigger(
            hour=config.NOTIFY_HOUR,
            minute=config.NOTIFY_MINUTE,
            timezone=config.TIMEZONE,
        ),
        args=[app],
        id="daily_shift_report",
        replace_existing=True,
    )

    async def post_init(app: Application):
        await app.bot.set_my_commands([
            BotCommand("start", "Botu başlat"),
            BotCommand("vardiya_ekle", "Vardiya günü ekle (YYYY-MM-DD)"),
            BotCommand("vardiyalar", "Yaklaşan vardiyaları listele"),
            BotCommand("vardiya_sil", "Vardiya günü sil (YYYY-MM-DD)"),
            BotCommand("kontrol", "Bugünün raporunu şimdi göster"),
        ])
        scheduler.start()
        logger.info(
            f"Bot başladı. Vardiya bildirimi her gün "
            f"{config.NOTIFY_HOUR:02d}:{config.NOTIFY_MINUTE:02d} İstanbul saatinde gönderilecek."
        )

    app.post_init = post_init

    logger.info("Bot çalışıyor... Durdurmak için Ctrl+C.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
