#!/usr/bin/env bash
set -e

# .env dosyasından değerleri yükle
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Bağımlılıkları kur (ilk sefer)
if [ ! -d venv ]; then
    python3 -m venv venv
    ./venv/bin/pip install -r requirements.txt
fi

./venv/bin/python bot.py
