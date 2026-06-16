"""
liman_gemi_cek.py — Asya Port gemi/rıhtım verisini çeken TEK DOSYALIK modül.

Sunucuya (BlazeDS / AMF0 remoting) bağlanır, selectBerthVessel(fromDate, toDate)
çağırır ve gemileri TEMİZ bir liste olarak döndürür.
Saf Python; tek harici bağımlılık: requests  (pip install requests)

────────────────────────────────────────────────────────────────────────────
KULLANIM (başka bir projeye/telefona kopyala, sonra):

    from liman_gemi_cek import gemileri_getir
    from datetime import date, timedelta

    bugun = date.today()
    # ÖNEMLİ: aralık BİRDEN FAZLA gün olmalı (from == to boş döner).
    gemiler = gemileri_getir(bugun - timedelta(days=1), bugun + timedelta(days=3))

    for g in gemiler:
        print(g["ad"], "|", g["rihtim"], "|", g["yanasma"], "->", g["kalkis"])

Her gemi şu alanları içeren bir sözlüktür:
    {ad, rihtim, yanasma, kalkis, durum, ham}
('ham' = sunucudan gelen ham sözlük; ekstra alanlar lazım olursa orada.)
────────────────────────────────────────────────────────────────────────────
"""

import struct
import requests
from datetime import date, datetime, timedelta

# ── Sunucu ayarları ───────────────────────────────────────────────────────────
ENDPOINT = "http://195.142.119.165:9120/messagebroker/amf"
HEADERS = {
    "Content-Type": "application/x-amf",
    "User-Agent":   "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
    "Referer":      "http://195.142.119.165:9120/eService",
}
DATE_FMT = "%Y%m%d"


# ── İstek üretimi: AMF0 remoting selectBerthVessel(fromDate, toDate) ───────────
def amf0_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack(">H", len(b)) + b


def _amf0_string(s: str) -> bytes:
    b = s.encode("utf-8")
    return bytes([0x02]) + struct.pack(">H", len(b)) + b


def _amf0_strict_array(items) -> bytes:
    return bytes([0x0A]) + struct.pack(">I", len(items)) + b"".join(items)


def build_select_berth_vessel(from_date: str, to_date: str) -> bytes:
    """selectBerthVessel(fromDate, toDate) için tam AMF0 remoting zarfı."""
    body = _amf0_strict_array([_amf0_string(from_date), _amf0_string(to_date)])
    buf  = struct.pack(">H", 0)        # AMF version 0
    buf += struct.pack(">H", 0)        # 0 header
    buf += struct.pack(">H", 1)        # 1 body
    buf += amf0_str("berthChartDestination.selectBerthVessel")  # target URI
    buf += amf0_str("/1")              # response URI
    buf += struct.pack(">i", -1)       # body length bilinmiyor
    return buf + body


# ── AMF3 / AMF0 çözücü ────────────────────────────────────────────────────────
class _Buf:
    def __init__(self, data, pos=0):
        self.d = data
        self.p = pos

    def u8(self):
        v = self.d[self.p]; self.p += 1; return v

    def u16(self):
        v = struct.unpack_from(">H", self.d, self.p)[0]; self.p += 2; return v

    def i32(self):
        v = struct.unpack_from(">i", self.d, self.p)[0]; self.p += 4; return v

    def dbl(self):
        v = struct.unpack_from(">d", self.d, self.p)[0]; self.p += 8; return v

    def read(self, n):
        chunk = self.d[self.p:self.p + n]; self.p += n; return chunk

    def amf0str(self):
        return self.read(self.u16()).decode("utf-8", errors="replace")


_FLEX_MSGS = {
    "RemotingMessage", "AsyncMessage", "AcknowledgeMessage",
    "ErrorMessage", "CommandMessage", "AbstractMessage",
}


class _AMF3:
    def __init__(self, buf):
        self.buf = buf
        self.strs = []
        self.objs = []
        self.traits_cache = []

    def str(self):
        ref = self.buf_u29()
        if not (ref & 1):
            return self.strs[ref >> 1]
        n = ref >> 1
        if n == 0:
            return ""
        s = self.buf.read(n).decode("utf-8", errors="replace")
        self.strs.append(s)
        return s

    def buf_u29(self):
        result = 0
        for i in range(4):
            b = self.buf.u8()
            if i < 3:
                result = (result << 7) | (b & 0x7F)
                if not (b & 0x80):
                    break
            else:
                result = (result << 8) | b
        return result

    def _read_flags(self):
        flags = []
        while True:
            b = self.buf.u8()
            flags.append(b)
            if not (b & 0x80):
                break
        return flags

    def _skip_reserved(self, flags, start):
        for i in range(start, 7):
            if (flags >> i) & 1:
                self.val()

    def _read_abstract(self, obj):
        flags = self._read_flags()
        f0 = flags[0]
        if f0 & 0x01: obj["body"]        = self.val()
        if f0 & 0x02: obj["clientId"]    = self.val()
        if f0 & 0x04: obj["destination"] = self.val()
        if f0 & 0x08: obj["headers"]     = self.val()
        if f0 & 0x10: obj["messageId"]   = self.val()
        if f0 & 0x20: obj["timestamp"]   = self.val()
        if f0 & 0x40: obj["timeToLive"]  = self.val()
        if len(flags) > 1:
            f1 = flags[1]
            if f1 & 0x01: obj["clientIdBytes"]  = self.val()
            if f1 & 0x02: obj["messageIdBytes"] = self.val()
            self._skip_reserved(f1, 2)
            for fb in flags[2:]:
                self._skip_reserved(fb, 0)

    def _read_async(self, obj):
        flags = self._read_flags()
        f0 = flags[0]
        if f0 & 0x01: obj["correlationId"]      = self.val()
        if f0 & 0x02: obj["correlationIdBytes"] = self.val()
        self._skip_reserved(f0, 2)
        for fb in flags[1:]:
            self._skip_reserved(fb, 0)

    def _read_empty(self):
        for fb in self._read_flags():
            self._skip_reserved(fb, 0)

    def _read_error(self, obj):
        flags = self._read_flags()
        f0 = flags[0]
        if f0 & 0x01: obj["extendedData"] = self.val()
        if f0 & 0x02: obj["faultCode"]    = self.val()
        if f0 & 0x04: obj["faultDetail"]  = self.val()
        if f0 & 0x08: obj["faultString"]  = self.val()
        if f0 & 0x10: obj["rootCause"]    = self.val()
        self._skip_reserved(f0, 5)
        for fb in flags[1:]:
            self._skip_reserved(fb, 0)

    def _read_flex_message(self, obj, short):
        self._read_abstract(obj)
        if short in ("AsyncMessage", "AcknowledgeMessage", "ErrorMessage", "CommandMessage"):
            self._read_async(obj)
        if short in ("AcknowledgeMessage", "ErrorMessage"):
            self._read_empty()
        if short == "ErrorMessage":
            self._read_error(obj)
        if short == "CommandMessage":
            self._read_empty()
        if short == "RemotingMessage":
            flags = self._read_flags()
            f0 = flags[0]
            if f0 & 0x01: obj["operation"] = self.val()
            if f0 & 0x02: obj["source"]    = self.val()
            self._skip_reserved(f0, 2)

    def val(self):
        t = self.buf.u8()
        if t == 0x00: return None
        if t == 0x01: return None
        if t == 0x02: return False
        if t == 0x03: return True
        if t == 0x04: return self.buf_u29()
        if t == 0x05: return self.buf.dbl()
        if t == 0x06: return self.str()

        if t == 0x08:                           # date
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            ts = self.buf.dbl()
            self.objs.append(ts); return ts

        if t == 0x09:                           # array
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1
            arr = []
            self.objs.append(arr)
            while True:
                k = self.str()
                if not k: break
                arr.append({k: self.val()})
            for _ in range(count):
                arr.append(self.val())
            return arr

        if t == 0x0A:                           # object
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            trait_ref = ref >> 1
            if not (trait_ref & 1):
                traits = self.traits_cache[trait_ref >> 1]
            else:
                cls     = self.str()
                is_ext  = bool(trait_ref & 2)
                is_dyn  = bool(trait_ref & 4)
                n_props = trait_ref >> 3
                props   = [self.str() for _ in range(n_props)]
                traits  = (cls, is_dyn, is_ext, props)
                self.traits_cache.append(traits)
            cls, is_dyn, is_ext, props = traits
            obj = {"__cls": cls}
            self.objs.append(obj)
            short = cls.rsplit(".", 1)[-1]
            if is_ext:
                if "ArrayCollection" in cls or "ArrayList" in short or "ObjectProxy" in cls:
                    obj["source"] = self.val()
                elif short in _FLEX_MSGS:
                    self._read_flex_message(obj, short)
                else:
                    try: obj["__ext"] = self.val()
                    except Exception: pass
                return obj
            for p in props:
                obj[p] = self.val()
            if is_dyn:
                while True:
                    k = self.str()
                    if not k: break
                    obj[k] = self.val()
            return obj

        if t in (0x07, 0x0B):                   # xml
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            s = self.buf.read(ref >> 1).decode("utf-8", errors="replace")
            self.objs.append(s); return s

        if t == 0x0C:                           # byte-array
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            data = bytes(self.buf.read(ref >> 1))
            self.objs.append(data); return data

        if t in (0x0D, 0x0E):                   # Vector.<int|uint>
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8()
            fmt = ">i" if t == 0x0D else ">I"
            arr = [struct.unpack(fmt, self.buf.read(4))[0] for _ in range(count)]
            self.objs.append(arr); return arr

        if t == 0x0F:                           # Vector.<Number>
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8()
            arr = [self.buf.dbl() for _ in range(count)]
            self.objs.append(arr); return arr

        if t == 0x10:                           # Vector.<Object>
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8(); self.str()
            arr = [self.val() for _ in range(count)]
            self.objs.append(arr); return arr

        if t == 0x11:                           # Dictionary
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8()
            d = {}
            self.objs.append(d)
            for _ in range(count):
                k = self.val(); v = self.val(); d[str(k)] = v
            return d

        raise ValueError(f"unknown AMF3 marker 0x{t:02x} at {self.buf.p}")


class _AMF0:
    def __init__(self, buf):
        self.buf = buf
        self.refs = []

    def val(self):
        t = self.buf.u8()
        if t == 0x00: return self.buf.dbl()
        if t == 0x01: return bool(self.buf.u8())
        if t == 0x02:
            return self.buf.read(self.buf.u16()).decode("utf-8", errors="replace")
        if t == 0x03:
            obj = {}; self.refs.append(obj)
            return self._body(obj)
        if t in (0x05, 0x06): return None
        if t == 0x07:
            idx = self.buf.u16()
            return self.refs[idx] if idx < len(self.refs) else None
        if t == 0x08:
            self.buf.i32()
            obj = {}; self.refs.append(obj)
            return self._body(obj)
        if t == 0x0A:
            n = struct.unpack(">I", self.buf.read(4))[0]
            arr = []; self.refs.append(arr)
            for _ in range(n): arr.append(self.val())
            return arr
        if t == 0x0B:
            ms = self.buf.dbl(); self.buf.u16(); return ms
        if t == 0x0C:
            n = struct.unpack(">I", self.buf.read(4))[0]
            return self.buf.read(n).decode("utf-8", errors="replace")
        if t == 0x10:
            cls = self.buf.read(self.buf.u16()).decode("utf-8", errors="replace")
            obj = {"__cls": cls}; self.refs.append(obj)
            return self._body(obj)
        if t == 0x11:
            return _AMF3(self.buf).val()
        raise ValueError(f"unknown AMF0 marker 0x{t:02x} at {self.buf.p}")

    def _body(self, obj):
        while True:
            klen = self.buf.u16()
            key = self.buf.read(klen).decode("utf-8", errors="replace")
            if key == "" and self.buf.d[self.buf.p] == 0x09:
                self.buf.u8()
                break
            obj[key] = self.val()
        return obj


def decode_envelope(data: bytes) -> list:
    """AMF yanıt zarfından çözülmüş gövde değerlerini döndürür."""
    buf = _Buf(data)
    buf.u16()                       # AMF version
    header_count = buf.u16()
    for _ in range(header_count):
        buf.amf0str()
        buf.u8()
        n = buf.i32()
        if n >= 0: buf.read(n)

    body_count = buf.u16()
    values = []
    for _ in range(body_count):
        target = buf.amf0str()
        buf.amf0str()
        buf.i32()
        try:
            values.append((target, _AMF0(buf).val()))
        except Exception:
            break
    return values


# Bir gemi (BerthChartDomain) satırını işaretleyen alanlar.
VESSEL_KEYS = {"vslName", "vessel", "berthno", "berthTime", "depatureTime",
               "depatureTimeS", "atb", "atd", "berthside", "outservice"}


def _extract_vessels(obj, out, depth=0):
    if out is None: out = []
    if depth > 20: return out
    if isinstance(obj, list):
        for item in obj:
            _extract_vessels(item, out, depth + 1)
        return out
    if not isinstance(obj, dict):
        return out
    if VESSEL_KEYS & set(obj.keys()):
        out.append(obj)
        return out
    for key in ("body", "source", "__ext"):
        if key in obj:
            _extract_vessels(obj[key], out, depth + 1)
    for v in obj.values():
        if isinstance(v, (dict, list)):
            _extract_vessels(v, out, depth + 1)
    return out


def decode_response(data: bytes) -> list:
    """AMF yanıtını çözüp BerthChartVO benzeri sözlük listesi döndürür."""
    vessels = []
    try:
        for _target, value in decode_envelope(data):
            _extract_vessels(value, vessels)
    except Exception:
        pass
    seen, uniq = set(), []
    for v in vessels:
        key = id(v)
        if key not in seen:
            seen.add(key); uniq.append(v)
    return uniq


# ── Genel API ─────────────────────────────────────────────────────────────────
def get_vessels(from_date, to_date) -> list:
    """selectBerthVessel(fromDate, toDate) çağırır, HAM gemi sözlüklerini döndürür.

    Tarihler date/datetime ya da "%Y%m%d" string olabilir. Aralık birden
    fazla gün olmalı, yoksa sunucu boş döner.
    """
    s1 = from_date.strftime(DATE_FMT) if hasattr(from_date, "strftime") else str(from_date)
    s2 = to_date.strftime(DATE_FMT)   if hasattr(to_date, "strftime")   else str(to_date)
    data = build_select_berth_vessel(s1, s2)
    try:
        r = requests.post(ENDPOINT, data=data, headers=HEADERS, timeout=15)
        if r.status_code != 200 or len(r.content) < 20:
            return []
        return decode_response(r.content)
    except Exception:
        return []


def gemileri_getir(from_date, to_date) -> list:
    """get_vessels'ı çağırıp TEMİZ alanlara sahip sözlük listesi döndürür.

    Her öğe: {ad, rihtim, yanasma, kalkis, durum, ham}
    """
    sonuc = []
    for v in get_vessels(from_date, to_date):
        sonuc.append({
            "ad":      v.get("vslName") or v.get("vessel") or "?",
            "rihtim":  v.get("berthno"),
            "yanasma": v.get("atb") or v.get("berthTime"),
            "kalkis":  v.get("atd") or v.get("depatureTime") or v.get("depatureTimeS"),
            "durum":   v.get("statusDesc") or v.get("outservice"),
            "ham":     v,   # ekstra alanlar lazımsa burada
        })
    return sonuc


# ── Komut satırından deneme ───────────────────────────────────────────────────
if __name__ == "__main__":
    bugun = date.today()
    frm = bugun - timedelta(days=2)
    to  = bugun + timedelta(days=3)
    print(f"selectBerthVessel({frm:%Y%m%d}, {to:%Y%m%d})  ->  {ENDPOINT}\n")
    gemiler = gemileri_getir(frm, to)
    if not gemiler:
        print("Gemi verisi yok / sunucuya ulaşılamadı.")
    else:
        print(f"{len(gemiler)} gemi:\n")
        for g in gemiler:
            print(f"  {g['ad']:<24} rıhtım={g['rihtim'] or '?':<5} "
                  f"yanaşma={g['yanasma'] or '?'}  kalkış={g['kalkis'] or '?'}")
