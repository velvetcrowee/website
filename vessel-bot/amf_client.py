"""
BlazeDS AMF3 RemotingMessage encoder/decoder - pure Python, no dependencies.
Used to call berthChartDestination service on OPUS Terminal.

Run from Termux: python3 amf_client.py
"""

import struct, uuid, requests, re
from datetime import date, datetime

# ── AMF3 encoding ─────────────────────────────────────────────────────────────

def u29(v):
    v &= 0x1FFFFFFF
    if v < 0x80:        return bytes([v])
    if v < 0x4000:      return bytes([0x80|(v>>7), v&0x7F])
    if v < 0x200000:    return bytes([0x80|(v>>14), 0x80|((v>>7)&0x7F), v&0x7F])
    return bytes([0x80|(v>>22), 0x80|((v>>15)&0x7F), 0x80|((v>>8)&0x7F), v&0xFF])

def _s(text):
    """String content - no type marker, always inline (no ref table)"""
    if text == '': return bytes([0x01])
    b = text.encode('utf-8')
    return u29(len(b) << 1 | 1) + b

def ENC_STR(v):    return bytes([0x06]) + _s(v)
def ENC_INT(v):    return bytes([0x04]) + u29(v)
def ENC_DBL(v):    return bytes([0x05]) + struct.pack('>d', float(v))
def ENC_NULL():    return bytes([0x01])
def ENC_FALSE():   return bytes([0x02])
def ENC_TRUE():    return bytes([0x03])

def ENC_ARRAY(items):
    """Dense array"""
    return bytes([0x09]) + u29(len(items) << 1 | 1) + bytes([0x01]) + b''.join(items)

def ENC_ANON_OBJ():
    """Empty anonymous object {}"""
    return bytes([0x0A]) + u29(3) + _s('')

def ENC_OBJ(classname, trait_names, values):
    """Typed sealed object"""
    n = len(trait_names)
    d = bytes([0x0A]) + u29((n << 4) | 3) + _s(classname)
    for t in trait_names: d += _s(t)
    for v in values:      d += v
    return d

# ── BlazeDS message builders ──────────────────────────────────────────────────

REMOTING_TRAITS = [
    'destination', 'operation', 'body', 'headers',
    'messageId', 'timestamp', 'timeToLive', 'clientId', 'correlationId'
]

def make_remoting_msg(destination, operation, body_items):
    return ENC_OBJ(
        'flex.messaging.messages.RemotingMessage',
        REMOTING_TRAITS,
        [
            ENC_STR(destination),
            ENC_STR(operation),
            ENC_ARRAY(body_items),
            ENC_ANON_OBJ(),
            ENC_STR(str(uuid.uuid4()).upper()),
            ENC_DBL(0),
            ENC_DBL(0),
            ENC_NULL(),
            ENC_STR(''),
        ]
    )

def amf0_str(s):
    b = s.encode('utf-8')
    return struct.pack('>H', len(b)) + b

def build_request(destination, operation, body_items):
    """Full AMF0/3 envelope"""
    msg = make_remoting_msg(destination, operation, body_items)
    buf  = struct.pack('>H', 3)    # AMF3
    buf += struct.pack('>H', 0)    # 0 headers
    buf += struct.pack('>H', 1)    # 1 body
    buf += amf0_str('null')        # target
    buf += amf0_str('/1')          # response URI
    buf += struct.pack('>i', -1)   # body length unknown
    buf += bytes([0x11])           # AMF3 marker
    buf += msg
    return buf

# ── AMF3 decoding ─────────────────────────────────────────────────────────────

class _Buf:
    """Binary buffer reader."""
    def __init__(self, data, pos=0):
        self.d = data
        self.p = pos

    def u8(self):
        v = self.d[self.p]; self.p += 1; return v

    def u16(self):
        v = struct.unpack_from('>H', self.d, self.p)[0]; self.p += 2; return v

    def i32(self):
        v = struct.unpack_from('>i', self.d, self.p)[0]; self.p += 4; return v

    def dbl(self):
        v = struct.unpack_from('>d', self.d, self.p)[0]; self.p += 8; return v

    def read(self, n):
        chunk = self.d[self.p:self.p+n]; self.p += n; return chunk

    def u29(self):
        result = 0
        for i in range(4):
            b = self.u8()
            if i < 3:
                result = (result << 7) | (b & 0x7F)
                if not (b & 0x80): break
            else:
                result = (result << 8) | b
        return result

    def amf0str(self):
        return self.read(self.u16()).decode('utf-8', errors='replace')


class _AMF3:
    """AMF3 value decoder with string/object/trait reference tables."""
    def __init__(self, buf):
        self.buf = buf
        self.strs = []
        self.objs = []
        self.traits_cache = []

    def str(self):
        ref = self.buf.u29()
        if not (ref & 1):
            return self.strs[ref >> 1]
        n = ref >> 1
        if n == 0:
            return ''
        s = self.buf.read(n).decode('utf-8', errors='replace')
        self.strs.append(s)
        return s

    def val(self):
        t = self.buf.u8()
        if t == 0x00: return None              # undefined
        if t == 0x01: return None              # null
        if t == 0x02: return False
        if t == 0x03: return True
        if t == 0x04: return self.buf.u29()    # integer
        if t == 0x05: return self.buf.dbl()    # double
        if t == 0x06: return self.str()         # string

        if t == 0x07:                           # xml-doc
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            s = self.buf.read(ref >> 1).decode('utf-8', errors='replace')
            self.objs.append(s); return s

        if t == 0x08:                           # date (ms since epoch)
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            ts = self.buf.dbl()
            self.objs.append(ts); return ts

        if t == 0x09:                           # array
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1
            arr = []
            self.objs.append(arr)
            while True:                         # associative (key=value) part
                k = self.str()
                if not k: break
                arr.append({k: self.val()})
            for _ in range(count):              # dense part
                arr.append(self.val())
            return arr

        if t == 0x0A:                           # object
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            trait_ref = ref >> 1
            if not (trait_ref & 1):
                traits = self.traits_cache[trait_ref >> 1]
            else:
                cls    = self.str()
                is_dyn = bool(trait_ref & 8)
                is_ext = bool(trait_ref & 4)
                n_props = trait_ref >> 4
                props  = [self.str() for _ in range(n_props)]
                traits = (cls, is_dyn, is_ext, props)
                self.traits_cache.append(traits)
            cls, is_dyn, is_ext, props = traits
            obj = {'__cls': cls}
            self.objs.append(obj)
            if is_ext:
                # IExternalizable: readExternal() reads one AMF3 value
                # ArrayCollection externalizes its source array this way
                obj['__ext'] = self.val()
                return obj
            for p in props:
                obj[p] = self.val()
            if is_dyn:
                while True:
                    k = self.str()
                    if not k: break
                    obj[k] = self.val()
            return obj

        if t == 0x0B:                           # xml (E4X)
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            s = self.buf.read(ref >> 1).decode('utf-8', errors='replace')
            self.objs.append(s); return s

        if t == 0x0C:                           # byte-array
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            data = bytes(self.buf.read(ref >> 1))
            self.objs.append(data); return data

        if t == 0x0D:                           # Vector.<int>
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8()
            arr = [struct.unpack_from('>i', self.buf.read(4))[0] for _ in range(count)]
            self.objs.append(arr); return arr

        if t == 0x0E:                           # Vector.<uint>
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8()
            arr = [struct.unpack_from('>I', self.buf.read(4))[0] for _ in range(count)]
            self.objs.append(arr); return arr

        if t == 0x0F:                           # Vector.<Number>
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8()
            arr = [self.buf.dbl() for _ in range(count)]
            self.objs.append(arr); return arr

        if t == 0x10:                           # Vector.<Object>
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8(); self.str()
            arr = [self.val() for _ in range(count)]
            self.objs.append(arr); return arr

        if t == 0x11:                           # Dictionary
            ref = self.buf.u29()
            if not (ref & 1): return self.objs[ref >> 1]
            count = ref >> 1; self.buf.u8()
            d = {}
            self.objs.append(d)
            for _ in range(count):
                k = self.val(); v = self.val(); d[str(k)] = v
            return d

        return None  # unknown type - caller will likely mis-parse from here


def _extract_vessels(obj, out=None, depth=0):
    """Recursively find BerthChartVO objects in a decoded AMF3 tree."""
    if out is None: out = []
    if depth > 15: return out

    if isinstance(obj, list):
        for item in obj:
            _extract_vessels(item, out, depth + 1)
        return out

    if not isinstance(obj, dict):
        return out

    cls = obj.get('__cls', '')

    # flex.messaging.io.ArrayCollection - externalized list of items
    if 'ArrayCollection' in cls or 'ArrayList' in cls:
        src = obj.get('__ext') or obj.get('source')
        if src is not None:
            _extract_vessels(src, out, depth + 1)
        return out

    # BlazeDS message wrapper - look in body
    if 'Message' in cls:
        body = obj.get('body')
        if body is not None:
            _extract_vessels(body, out, depth + 1)
        return out

    # BerthChartVO: identified by its field names
    VESSEL_KEYS = {'vessel', 'berthno', 'berthTime', 'depatureTimeS',
                   'vesselName', 'vslNm', 'shipNm'}
    if VESSEL_KEYS & set(obj.keys()):
        out.append(obj)
        return out

    # Unknown object - recurse into all dict/list values
    for v in obj.values():
        if isinstance(v, (dict, list)):
            _extract_vessels(v, out, depth + 1)

    return out


def decode_response(data: bytes) -> list[dict]:
    """
    Parse a BlazeDS AMF response envelope.
    Returns a list of BerthChartVO-like dicts.
    """
    try:
        buf = _Buf(data)
        buf.u16()                       # AMF version (0 or 3)
        header_count = buf.u16()
        for _ in range(header_count):   # typically 0
            buf.amf0str()               # header name
            buf.u8()                    # must-understand
            n = buf.i32()
            if n >= 0: buf.read(n)      # skip header body

        body_count = buf.u16()
        vessels = []
        for _ in range(body_count):
            buf.amf0str()               # target-uri  (e.g. "/1/onResult")
            buf.amf0str()               # response-uri
            buf.i32()                   # body-length (-1 = unknown)
            marker = buf.u8()
            if marker == 0x11:          # AMF3 body
                amf3 = _AMF3(buf)
                value = amf3.val()
                vessels.extend(_extract_vessels(value))

        return vessels
    except Exception:
        return []

# ── Response parsing (for debug / fallback) ───────────────────────────────────

def extract_strings(data):
    text = data.decode('latin-1')
    return re.findall(r'[\x20-\x7e]{4,}', text)

def parse_amf_strings(data):
    text = data.decode('latin-1')
    keywords = [
        'vessel','vesselName','berthno','berthTime','depatureTime',
        'berthside','outservice','berthName','arrivalTime','departureTime',
        'VESSEL','BERTH','ETB','ETD','ETA','vslNm','vslCd',
    ]
    strings = re.findall(r'[\x20-\x7e]{3,}', text)
    relevant = [s for s in strings if any(k.lower() in s.lower() for k in keywords)]
    return strings, relevant

# ── Public API ────────────────────────────────────────────────────────────────

ENDPOINT = 'http://195.142.119.165:9120/messagebroker/amf'
HEADERS  = {
    'Content-Type': 'application/x-amf',
    'User-Agent':   'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36',
    'Referer':      'http://195.142.119.165:9120/eService',
}


def get_vessels(year: int, month: int, day: int) -> list[dict]:
    """
    Call selectBerthVessel(year, month, day) and return list of BerthChartVO dicts.
    Returns [] on connection error or empty response.
    """
    data = build_request('berthChartDestination', 'selectBerthVessel',
                         [ENC_INT(year), ENC_INT(month), ENC_INT(day)])
    try:
        r = requests.post(ENDPOINT, data=data, headers=HEADERS, timeout=15)
        if r.status_code != 200 or len(r.content) < 20:
            return []
        return decode_response(r.content)
    except Exception:
        return []


def call(operation, params, label=''):
    """Send one AMF request, print decoded results (used for testing)."""
    data = build_request('berthChartDestination', operation, params)
    try:
        r = requests.post(ENDPOINT, data=data, headers=HEADERS, timeout=15)
        all_strs, relevant = parse_amf_strings(r.content)
        vessels = decode_response(r.content)
        status = '✅' if r.status_code == 200 and len(r.content) > 50 else '⚠️'
        print(f'\n{status} {label or operation}')
        print(f'   HTTP {r.status_code} | {len(r.content)} byte')
        if vessels:
            print(f'   🚢 {len(vessels)} gemi:')
            for v in vessels[:5]:
                # Print only the interesting fields
                info = {k: val for k, val in v.items()
                        if k != '__cls' and val not in (None, '', 0, 0.0)}
                print(f'      {info}')
        elif relevant:
            print(f'   📌 Gemi verileri (string çıkarma):')
            for s in relevant[:30]:
                print(f'      {s}')
        else:
            print(f'   Ham stringler (ilk 15):')
            for s in all_strs[:15]:
                print(f'      {s}')
        return r
    except Exception as e:
        print(f'   ❌ {e}')
        return None

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    today = date.today()
    y, m, d = today.year, today.month, today.day
    print(f'=== BlazeDS AMF Client ===')
    print(f'Endpoint: {ENDPOINT}')
    print(f'Tarih: {today}')
    print()

    tests = [
        ('selectBerthVessel', [ENC_INT(y), ENC_INT(m), ENC_INT(d)],
            'selectBerthVessel(year,month,day)'),
        ('selectBerthVessel', [ENC_INT(y), ENC_INT(m), ENC_INT(d), ENC_STR('')],
            'selectBerthVessel(year,month,day,"")'),
        ('selectBerthVessel', [ENC_INT(y), ENC_INT(m), ENC_INT(d), ENC_STR('1A-01')],
            'selectBerthVessel(year,month,day,"1A-01")'),
        ('selectBerth', [ENC_INT(y), ENC_INT(m), ENC_INT(d)],
            'selectBerth(year,month,day)'),
        ('selectBerthBitt', [ENC_INT(y), ENC_INT(m), ENC_INT(d)],
            'selectBerthBitt(year,month,day)'),
        ('selectBerthVessel', [],
            'selectBerthVessel() no params'),
        ('getBerthDirection', [],
            'getBerthDirection()'),
    ]

    found = []
    for op, params, label in tests:
        r = call(op, params, label)
        if r and r.status_code == 200 and len(r.content) > 200:
            vessels = decode_response(r.content)
            all_strs, relevant = parse_amf_strings(r.content)
            if vessels or relevant:
                found.append((label, len(vessels)))

    print('\n' + '='*50)
    if found:
        print(f'✅ {len(found)} operasyonda veri bulundu!')
        for label, count in found:
            suffix = f' ({count} gemi obje)' if count else ''
            print(f'   {label}{suffix}')
    else:
        print('ℹ️  Gemi verisi bulunamadı.')
        print('Endpoint veya parametre formatı farklı olabilir.')
