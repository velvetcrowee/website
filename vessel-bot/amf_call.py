"""
Definitive caller for berthChartDestination.selectBerthVessel(fromDate, toDate).

The method takes 2 args (confirmed by server: "2 were expected").
2-arg calls return onResult. This dumps the FULL decoded result structure
and field names so we can map them to BerthEntry, and tries several date
ranges + formats to find one that returns ship rows.

Run:  python3 amf_call.py
"""

import struct
from datetime import date, timedelta

import amf_client as a

DEST, METHOD = 'berthChartDestination', 'selectBerthVessel'
today = date.today()


def amf0_string(s):
    b = s.encode(); return bytes([0x02]) + struct.pack('>H', len(b)) + b

def amf0_strict_array(items):
    return bytes([0x0A]) + struct.pack('>I', len(items)) + b''.join(items)

def envelope(target, resp, body, version=0):
    buf  = struct.pack('>H', version) + struct.pack('>H', 0) + struct.pack('>H', 1)
    buf += a.amf0_str(target) + a.amf0_str(resp) + struct.pack('>i', -1)
    return buf + body


def call2(arg1, arg2, resp='/1'):
    body = amf0_strict_array([amf0_string(arg1), amf0_string(arg2)])
    data = envelope(f'{DEST}.{METHOD}', resp, body, version=0)
    return a.requests.post(a.ENDPOINT, data=data, headers=a.HEADERS, timeout=15)


def pretty(v, ind=0, maxlist=10):
    pad = '  ' * ind
    if isinstance(v, dict):
        cls = v.get('__cls', '')
        if cls: print(f'{pad}<{cls}>')
        for k, val in v.items():
            if k == '__cls': continue
            if isinstance(val, (dict, list)):
                print(f'{pad}{k}:'); pretty(val, ind + 1, maxlist)
            else:
                print(f'{pad}{k}: {val!r}')
    elif isinstance(v, list):
        print(f'{pad}[{len(v)} öğe]')
        for i, item in enumerate(v[:maxlist]):
            print(f'{pad}#{i}:'); pretty(item, ind + 1, maxlist)
    else:
        print(f'{pad}{v!r}')


RANGES = [
    (today,                         today,                          'yyyyMMdd bugün'),
    (today,                         today + timedelta(days=7),      'yyyyMMdd +7g'),
    (today - timedelta(days=2),     today + timedelta(days=14),     'yyyyMMdd -2/+14g'),
]
FMTS = ['%Y%m%d', '%Y-%m-%d', '%d/%m/%Y']


def run():
    print('=== selectBerthVessel(fromDate, toDate) ===')
    print(f'Endpoint: {a.ENDPOINT}\n')

    best = None
    for d1, d2, label in RANGES:
        for fmt in FMTS:
            s1, s2 = d1.strftime(fmt), d2.strftime(fmt)
            try:
                r = call2(s1, s2)
            except Exception as e:
                print(f'❌ {label} [{fmt}]: {e}'); continue
            vessels = a.decode_response(r.content)
            tag = '🚢' if vessels else ('·' if r.content[-10:].find(b'onResult') or True else '·')
            print(f'{"🚢" if vessels else "·"} {label}  fmt={fmt}  "{s1}".."{s2}"  '
                  f'[{len(r.content)}b]  gemi={len(vessels)}')
            if vessels and best is None:
                best = (s1, s2, fmt, r.content)

    print('\n' + '=' * 55)
    # Full structural dump of the most informative response
    print('Yapı dökümü (ilk anlamlı yanıt):\n')
    if best:
        s1, s2, fmt, content = best
        print(f'>>> selectBerthVessel("{s1}","{s2}")  fmt={fmt}\n')
    else:
        # nothing parsed as vessels - dump today's raw response to inspect
        r = call2(today.strftime('%Y%m%d'), (today + timedelta(days=7)).strftime('%Y%m%d'))
        content = r.content
        print('Gemi çıkmadı; ham yanıt yapısı:\n')

    for t, val in a.decode_envelope(content):
        print(f'target: {t}')
        pretty(val)
    print('\nRAW HEX:')
    print(content.hex())


if __name__ == '__main__':
    run()
