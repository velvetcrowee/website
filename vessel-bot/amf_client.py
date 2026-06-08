"""
BlazeDS AMF3 RemotingMessage encoder/decoder - pure Python, no dependencies.
Used to call berthChartDestination service on OPUS Terminal.

Flex messaging classes (RemotingMessage, AcknowledgeMessage, ...) are
IExternalizable in BlazeDS, so they use a compact flag-based wire format
instead of normal sealed-trait objects. Both directions are implemented here.

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
    """Empty anonymous (dynamic) object {}"""
    return bytes([0x0A]) + u29(0x0B) + _s('') + _s('')

def ENC_OBJ(classname, trait_names, values):
    """Typed sealed object"""
    n = len(trait_names)
    d = bytes([0x0A]) + u29((n << 4) | 3) + _s(classname)
    for t in trait_names: d += _s(t)
    for v in values:      d += v
    return d

# ── BlazeDS RemotingMessage (IExternalizable wire format) ─────────────────────
#
# AbstractMessage.writeExternal flag bits (1st flag byte):
#   BODY=1  CLIENT_ID=2  DESTINATION=4  HEADERS=8
#   MESSAGE_ID=16  TIMESTAMP=32  TIME_TO_LIVE=64  HAS_NEXT=128
# RemotingMessage.writeExternal flag bits:
#   OPERATION=1  SOURCE=2

def make_remoting_msg(destination, operation, body_items, message_id=None):
    """Externalizable RemotingMessage: marker, U29O(ext), class name, body."""
    if message_id is None:
        message_id = str(uuid.uuid4()).upper()

    out  = bytes([0x0A, 0x07])      # object marker + U29O (inline, ext, no traits)
    out += _s('flex.messaging.messages.RemotingMessage')

    # --- AbstractMessage.writeExternal ---
    flags = 0x01 | 0x04 | 0x10      # body + destination + messageId
    out += bytes([flags])
    out += ENC_ARRAY(body_items)    # body  (argument list)
    out += ENC_STR(destination)     # destination
    out += ENC_STR(message_id)      # messageId

    # --- RemotingMessage.writeExternal ---
    out += bytes([0x01])            # operation flag (source omitted)
    out += ENC_STR(operation)       # operation
    return out

def amf0_str(s):
    b = s.encode('utf-8')
    return struct.pack('>H', len(b)) + b

def build_request(destination, operation, body_items):
    """Full AMF0/3 envelope wrapping one RemotingMessage."""
    msg = make_remoting_msg(destination, operation, body_items)
    buf  = struct.pack('>H', 3)    # AMF version 3
    buf += struct.pack('>H', 0)    # 0 headers
    buf += struct.pack('>H', 1)    # 1 body
    buf += amf0_str('null')        # target URI
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

    def amf0str(self):
        return self.read(self.u16()).decode('utf-8', errors='replace')


_FLEX_MSGS = {
    'RemotingMessage', 'AsyncMessage', 'AcknowledgeMessage',
    'ErrorMessage', 'CommandMessage', 'AbstractMessage',
}


class _AMF3:
    """AMF3 value decoder with string/object/trait reference tables."""
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
            return ''
        s = self.buf.read(n).decode('utf-8', errors='replace')
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

    # -- externalizable flag helpers --
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
        if f0 & 0x01: obj['body']       = self.val()
        if f0 & 0x02: obj['clientId']   = self.val()
        if f0 & 0x04: obj['destination']= self.val()
        if f0 & 0x08: obj['headers']    = self.val()
        if f0 & 0x10: obj['messageId']  = self.val()
        if f0 & 0x20: obj['timestamp']  = self.val()
        if f0 & 0x40: obj['timeToLive'] = self.val()
        if len(flags) > 1:
            f1 = flags[1]
            if f1 & 0x01: obj['clientIdBytes']  = self.val()
            if f1 & 0x02: obj['messageIdBytes'] = self.val()
            self._skip_reserved(f1, 2)
            for fb in flags[2:]:
                self._skip_reserved(fb, 0)

    def _read_async(self, obj):
        flags = self._read_flags()
        f0 = flags[0]
        if f0 & 0x01: obj['correlationId']      = self.val()
        if f0 & 0x02: obj['correlationIdBytes'] = self.val()
        self._skip_reserved(f0, 2)
        for fb in flags[1:]:
            self._skip_reserved(fb, 0)

    def _read_empty(self):
        for fb in self._read_flags():
            self._skip_reserved(fb, 0)

    def _read_error(self, obj):
        flags = self._read_flags()
        f0 = flags[0]
        if f0 & 0x01: obj['extendedData'] = self.val()
        if f0 & 0x02: obj['faultCode']    = self.val()
        if f0 & 0x04: obj['faultDetail']  = self.val()
        if f0 & 0x08: obj['faultString']  = self.val()
        if f0 & 0x10: obj['rootCause']    = self.val()
        self._skip_reserved(f0, 5)
        for fb in flags[1:]:
            self._skip_reserved(fb, 0)

    def _read_flex_message(self, obj, short):
        self._read_abstract(obj)
        if short in ('AsyncMessage', 'AcknowledgeMessage', 'ErrorMessage', 'CommandMessage'):
            self._read_async(obj)
        if short in ('AcknowledgeMessage', 'ErrorMessage'):
            self._read_empty()          # AcknowledgeMessage layer: no fields
        if short == 'ErrorMessage':
            self._read_error(obj)
        if short == 'CommandMessage':
            self._read_empty()          # operation int etc. - best effort
        if short == 'RemotingMessage':
            flags = self._read_flags()
            f0 = flags[0]
            if f0 & 0x01: obj['operation'] = self.val()
            if f0 & 0x02: obj['source']    = self.val()
            self._skip_reserved(f0, 2)

    def val(self):
        t = self.buf.u8()
        if t == 0x00: return None              # undefined
        if t == 0x01: return None              # null
        if t == 0x02: return False
        if t == 0x03: return True
        if t == 0x04: return self.buf_u29()    # integer
        if t == 0x05: return self.buf.dbl()    # double
        if t == 0x06: return self.str()         # string

        if t == 0x08:                           # date (ms since epoch)
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
            while True:                         # associative part
                k = self.str()
                if not k: break
                arr.append({k: self.val()})
            for _ in range(count):              # dense part
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
            obj = {'__cls': cls}
            self.objs.append(obj)
            short = cls.rsplit('.', 1)[-1]
            if is_ext:
                if 'ArrayCollection' in cls or 'ArrayList' in short or 'ObjectProxy' in cls:
                    obj['source'] = self.val()
                elif short in _FLEX_MSGS:
                    self._read_flex_message(obj, short)
                else:
                    try: obj['__ext'] = self.val()
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

        if t in (0x07, 0x0B):                   # xml-doc / xml
            ref = self.buf_u29()
            if not (ref & 1): return self.objs[ref >> 1]
            s = self.buf.read(ref >> 1).decode('utf-8', errors='replace')
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
            fmt = '>i' if t == 0x0D else '>I'
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

        raise ValueError(f'unknown AMF3 marker 0x{t:02x} at {self.buf.p}')


class _AMF0:
    """AMF0 value decoder; switches to AMF3 on the 0x11 marker."""
    def __init__(self, buf):
        self.buf = buf
        self.refs = []

    def val(self):
        t = self.buf.u8()
        if t == 0x00: return self.buf.dbl()                 # number
        if t == 0x01: return bool(self.buf.u8())            # boolean
        if t == 0x02:                                        # string
            return self.buf.read(self.buf.u16()).decode('utf-8', errors='replace')
        if t == 0x03:                                        # object
            obj = {}; self.refs.append(obj)
            return self._body(obj)
        if t in (0x05, 0x06): return None                    # null / undefined
        if t == 0x07:                                        # reference
            idx = self.buf.u16()
            return self.refs[idx] if idx < len(self.refs) else None
        if t == 0x08:                                        # ECMA array
            self.buf.i32()                                   # assoc count (unreliable)
            obj = {}; self.refs.append(obj)
            return self._body(obj)
        if t == 0x0A:                                        # strict array
            n = struct.unpack('>I', self.buf.read(4))[0]
            arr = []; self.refs.append(arr)
            for _ in range(n): arr.append(self.val())
            return arr
        if t == 0x0B:                                        # date
            ms = self.buf.dbl(); self.buf.u16(); return ms
        if t == 0x0C:                                        # long string
            n = struct.unpack('>I', self.buf.read(4))[0]
            return self.buf.read(n).decode('utf-8', errors='replace')
        if t == 0x10:                                        # typed object
            cls = self.buf.read(self.buf.u16()).decode('utf-8', errors='replace')
            obj = {'__cls': cls}; self.refs.append(obj)
            return self._body(obj)
        if t == 0x11:                                        # AMF3 switch
            return _AMF3(self.buf).val()
        raise ValueError(f'unknown AMF0 marker 0x{t:02x} at {self.buf.p}')

    def _body(self, obj):
        while True:
            klen = self.buf.u16()
            key = self.buf.read(klen).decode('utf-8', errors='replace')
            if key == '' and self.buf.d[self.buf.p] == 0x09:
                self.buf.u8()                                # object-end marker
                break
            obj[key] = self.val()
        return obj


# ── Envelope / extraction ─────────────────────────────────────────────────────

def decode_envelope(data: bytes) -> list:
    """Return the list of decoded body values from an AMF response envelope."""
    buf = _Buf(data)
    buf.u16()                       # AMF version
    header_count = buf.u16()
    for _ in range(header_count):
        buf.amf0str()               # header name
        buf.u8()                    # must-understand
        n = buf.i32()
        if n >= 0: buf.read(n)

    body_count = buf.u16()
    values = []
    for _ in range(body_count):
        target = buf.amf0str()      # e.g. "/1/onResult" or "/1/onStatus"
        buf.amf0str()               # response URI
        buf.i32()                   # body length (-1 = unknown)
        try:                        # AMF0 reader handles 0x11 -> AMF3 switch
            values.append((target, _AMF0(buf).val()))
        except Exception:
            break
    return values


VESSEL_KEYS = {'vessel', 'berthno', 'berthTime', 'depatureTimeS',
               'vesselName', 'vslNm', 'shipNm', 'berthside', 'outservice'}


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

    for key in ('body', 'source', '__ext'):
        if key in obj:
            _extract_vessels(obj[key], out, depth + 1)
    for v in obj.values():
        if isinstance(v, (dict, list)):
            _extract_vessels(v, out, depth + 1)
    return out


def decode_response(data: bytes) -> list:
    """Parse a BlazeDS AMF response, return list of BerthChartVO-like dicts."""
    vessels = []
    try:
        for _target, value in decode_envelope(data):
            _extract_vessels(value, vessels)
    except Exception:
        pass
    # de-dup preserving order (object refs can repeat)
    seen, uniq = set(), []
    for v in vessels:
        key = id(v)
        if key not in seen:
            seen.add(key); uniq.append(v)
    return uniq


def find_fault(data: bytes) -> str:
    """Return a fault/error string from the response, or '' if none."""
    try:
        for target, value in decode_envelope(data):
            if isinstance(value, dict):
                for k in ('faultString', 'message', 'description',
                          'faultDetail', 'details', 'code'):
                    if value.get(k):
                        return f'{value[k]}'
            if 'onStatus' in (target or ''):
                return repr(value)[:300]
    except Exception:
        pass
    return ''

# ── Debug string scan (fallback) ──────────────────────────────────────────────

def parse_amf_strings(data):
    text = data.decode('latin-1')
    strings = re.findall(r'[\x20-\x7e]{3,}', text)
    keywords = ['vessel','berth','etb','etd','eta','outservice','vslnm','depature']
    relevant = [s for s in strings if any(k in s.lower() for k in keywords)]
    return strings, relevant

# ── Public API ────────────────────────────────────────────────────────────────

ENDPOINT = 'http://195.142.119.165:9120/messagebroker/amf'
HEADERS  = {
    'Content-Type': 'application/x-amf',
    'User-Agent':   'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36',
    'Referer':      'http://195.142.119.165:9120/eService',
}


def get_vessels(year: int, month: int, day: int) -> list:
    """Call selectBerthVessel(year, month, day); return BerthChartVO dicts."""
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
    except Exception as e:
        print(f'\n❌ {label or operation}: {e}')
        return None

    vessels = decode_response(r.content)
    fault   = find_fault(r.content)
    status  = '✅' if r.status_code == 200 and len(r.content) > 50 else '⚠️'
    print(f'\n{status} {label or operation}')
    print(f'   HTTP {r.status_code} | {len(r.content)} byte')
    if vessels:
        print(f'   🚢 {len(vessels)} gemi:')
        for v in vessels[:6]:
            info = {k: val for k, val in v.items()
                    if k != '__cls' and val not in (None, '', 0, 0.0)}
            print(f'      {info}')
    elif fault:
        print(f'   ⚠️  Hata: {fault}')
    else:
        _, relevant = parse_amf_strings(r.content)
        if relevant:
            print(f'   📌 İlgili stringler: {relevant[:10]}')
        else:
            print(f'   (boş/tanınmayan yanıt)')
    return r

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    today = date.today()
    y, m, d = today.year, today.month, today.day
    ds = today.strftime('%Y%m%d')
    print('=== BlazeDS AMF Client (externalizable) ===')
    print(f'Endpoint: {ENDPOINT}')
    print(f'Tarih: {today}\n')

    tests = [
        ('selectBerthVessel', [ENC_INT(y), ENC_INT(m), ENC_INT(d)],
            'selectBerthVessel(int y,m,d)'),
        ('selectBerthVessel', [ENC_DBL(y), ENC_DBL(m), ENC_DBL(d)],
            'selectBerthVessel(num y,m,d)'),
        ('selectBerthVessel', [ENC_STR(str(y)), ENC_STR(f'{m:02d}'), ENC_STR(f'{d:02d}')],
            'selectBerthVessel(str y,m,d)'),
        ('selectBerthVessel', [ENC_STR(ds)],
            'selectBerthVessel("YYYYMMDD")'),
        ('selectBerthVessel', [ENC_INT(y), ENC_INT(m), ENC_INT(d), ENC_STR('')],
            'selectBerthVessel(int y,m,d,"")'),
        ('selectBerthVessel', [],
            'selectBerthVessel()'),
        ('selectBerth', [ENC_INT(y), ENC_INT(m), ENC_INT(d)],
            'selectBerth(int y,m,d)'),
        ('selectBerthBitt', [ENC_INT(y), ENC_INT(m), ENC_INT(d)],
            'selectBerthBitt(int y,m,d)'),
        ('getBerthDirection', [],
            'getBerthDirection()'),
    ]

    found = []
    for op, params, label in tests:
        r = call(op, params, label)
        if r and decode_response(r.content):
            found.append((label, len(decode_response(r.content))))

    print('\n' + '=' * 50)
    if found:
        print(f'✅ {len(found)} operasyonda gemi verisi bulundu!')
        for label, n in found:
            print(f'   {label}  → {n} gemi')
    else:
        print('ℹ️  Gemi verisi yok. Yukarıdaki hata mesajlarına bakın.')
