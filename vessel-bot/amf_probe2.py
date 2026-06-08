"""
Argument-signature probe for berthChartDestination.selectBerthVessel.

Legacy AMF0 remoting (target="dest.op", strict-array body) routes to the
service, but "Cannot invoke method 'selectBerthVessel'" => the argument
shape is wrong. This fires many arg variants and dumps the FULL server
fault (code/message/details/rootCause) so we can read the real cause.

Run:  python3 amf_probe2.py
"""

import struct
from datetime import date, datetime

import amf_client as a

today = date.today()
Y, M, D = today.year, today.month, today.day
DS  = today.strftime('%Y%m%d')      # 20260608
DSH = today.strftime('%Y-%m-%d')    # 2026-06-08
DEST = 'berthChartDestination'


# ── AMF0 argument encoders ────────────────────────────────────────────────────

def amf0_number(n):  return bytes([0x00]) + struct.pack('>d', float(n))
def amf0_string(s):  b = s.encode(); return bytes([0x02]) + struct.pack('>H', len(b)) + b
def amf0_null():     return bytes([0x05])

def amf0_date(dt):
    ms = dt.timestamp() * 1000.0
    return bytes([0x0B]) + struct.pack('>d', ms) + struct.pack('>h', 0)

def amf0_strict_array(items):
    return bytes([0x0A]) + struct.pack('>I', len(items)) + b''.join(items)


def envelope(target, response, body, version=0):
    buf  = struct.pack('>H', version) + struct.pack('>H', 0) + struct.pack('>H', 1)
    buf += a.amf0_str(target) + a.amf0_str(response) + struct.pack('>i', -1)
    return buf + body


# ── Full fault dump ───────────────────────────────────────────────────────────

def dump(content):
    """Return (vessels, fault_dict_or_None, target)."""
    vessels = a.decode_response(content)
    fault = None
    target = ''
    try:
        for t, val in a.decode_envelope(content):
            target = t
            if isinstance(val, dict) and not (a.VESSEL_KEYS & set(val.keys())):
                fault = {k: v for k, v in val.items() if k != '__cls'}
    except Exception as e:
        fault = {'_decode_error': str(e)}
    return vessels, fault, target


# ── Variants ──────────────────────────────────────────────────────────────────

METHOD = 'selectBerthVessel'

VARIANTS = [
    ('() boş',                       []),
    ('("20260608")',                 [amf0_string(DS)]),
    ('(20260608 num)',               [amf0_number(int(DS))]),
    ('("2026-06-08")',               [amf0_string(DSH)]),
    ('("2026","06","08")',           [amf0_string(str(Y)), amf0_string(f'{M:02d}'), amf0_string(f'{D:02d}')]),
    ('(2026,6,8 num)',               [amf0_number(Y), amf0_number(M), amf0_number(D)]),
    ('("20260608","20260608")',      [amf0_string(DS), amf0_string(DS)]),
    ('("20260608","")',              [amf0_string(DS), amf0_string('')]),
    ('(Date)',                       [amf0_date(datetime(Y, M, D))]),
    ('("20260608",null)',            [amf0_string(DS), amf0_null()]),
    ('("20260608","1A-01")',         [amf0_string(DS), amf0_string('1A-01')]),
    ('(num,num,num,"") ',            [amf0_number(Y), amf0_number(M), amf0_number(D), amf0_string('')]),
]


def run():
    print('=== selectBerthVessel argüman taraması ===')
    print(f'Endpoint: {a.ENDPOINT}')
    print(f'Tarih: {today}\n')

    hits = []
    for i, (label, args) in enumerate(VARIANTS):
        body = amf0_strict_array(args)
        data = envelope(f'{DEST}.{METHOD}', f'/{i+1}', body, version=0)
        try:
            r = a.requests.post(a.ENDPOINT, data=data, headers=a.HEADERS, timeout=15)
        except Exception as e:
            print(f'❌ {label}: {e}\n'); continue

        vessels, fault, target = dump(r.content)
        mark = '🚢' if vessels else '⚠️'
        print(f'{mark} {METHOD}{label}   [{len(r.content)}b, target={target}]')
        if vessels:
            print(f'   {len(vessels)} GEMI!')
            for v in vessels[:4]:
                info = {k: val for k, val in v.items()
                        if k != '__cls' and val not in (None, '', 0, 0.0)}
                print(f'      {info}')
            hits.append(label)
        elif fault:
            for k in ('code', 'message', 'description', 'details', 'rootCause'):
                if fault.get(k):
                    print(f'   {k}: {str(fault[k])[:200]}')
        else:
            _, rel = a.parse_amf_strings(r.content)
            allstr = a.re.findall(r'[\x20-\x7e]{4,}', r.content.decode('latin-1'))
            print(f'   stringler: {allstr[:8]}')
        print()

    print('=' * 55)
    if hits:
        print('✅ ÇALIŞAN ARGÜMAN ŞEKLİ:')
        for h in hits: print(f'   selectBerthVessel{h}')
    else:
        print('Hiçbiri gemi döndürmedi — message/details satırlarına bak.')


if __name__ == '__main__':
    run()
