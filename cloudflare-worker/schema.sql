-- Element Simyası — D1 tarif havuzu şeması.
-- Bir kez çalıştırın (D1 konsolu ya da: wrangler d1 execute simya-db --file schema.sql).
-- Tablo boşsa Worker, eski KV "pack" anahtarındaki tarifleri ilk istekte otomatik
-- olarak buraya taşır (INSERT OR IGNORE — tekrar çalışsa da güvenli).

CREATE TABLE IF NOT EXISTS recipes (
  key    TEXT PRIMARY KEY,   -- normalize ikili anahtarı, örn. "ateş++su"
  name   TEXT NOT NULL,      -- sonuç element adı
  emoji  TEXT,               -- tek emoji
  isnew  INTEGER,            -- 0/1: sıra dışı/yaratıcı sonuç mu
  descr  TEXT,               -- Türkçe açıklama ("desc" SQL'de ayrılmış sözcük)
  cat    TEXT,               -- kategori (doga, canli, ...)
  finder TEXT,               -- ilk keşfeden takma adı (dünya ilki)
  at     TEXT                -- ISO tarih
);

CREATE INDEX IF NOT EXISTS idx_recipes_finder ON recipes(finder);
