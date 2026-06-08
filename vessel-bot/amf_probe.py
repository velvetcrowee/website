"""
Multi-strategy AMF probe for the OPUS Terminal berth service.

The server is an OLD BlazeDS: it rejects IExternalizable messages
(class not Externalizable) and also won't route a sealed-trait
RemotingMessage (destination ends up null -> legacy fallback).

This script fires several distinct wire strategies in one run and
prints the server's fault/answer for each, so we can see which the
server actually accepts.

Run:  python3 amf_probe.py
"""

import struct, uuid, requests
from datetime import date

import amf_client as a   # reuse primitives + decoder

Y, M, D = 2026, 6, 8
today = date.today()
Y, M, D = today.year, today.month, today.day

DEST = 'berthChartDestination'
OP   = 'selectBerthVessel'


# ── AMF0 primitives ───────────────────────────────────────────────────────────

def amf0_number(n):       return bytes([0x00]) + struct.pack('>d', float(n))
def amf0_string(s):       b = s.encode(); return bytes([0x02]) + struct.pack('>H', len(b)) + b
def amf0_null():          return bytes([0x05])

def amf0_strict_array(items):
    return bytes([0x0A]) + struct.pack('>I', len(items)) + b''.join(items)


# ── Envelope ──────────────────────────────────────────────────────────────────

def envelope(target, response, body, version=0):
    buf  = struct.pack('>H', version)
    buf += struct.pack('>H', 0)          # 0 headers
    buf += struct.pack('>H', 1)          # 1 body
    buf += a.amf0_str(target)
    buf += a.amf0_str(response)
    buf += struct.pack('>i', -1)
    buf += body
    return buf


# ── Sealed-trait (non-ext) RemotingMessage, optionally dynamic ────────────────

def sealed_remoting(dest, op, body_items, dynamic=False, with_source=False):
    traits = ['destination', 'operation', 'body', 'headers', 'messageId',
              'timestamp', 'timeToLive', 'clientId', 'correlationId']
    vals = [a.ENC_STR(dest), a.ENC_STR(op), a.ENC_ARRAY(body_items),
            a.ENC_ANON_OBJ(), a.ENC_STR(str(uuid.uuid4()).upper()),
            a.ENC_DBL(0), a.ENC_DBL(0), a.ENC_NULL(), a.ENC_STR('')]
    if with_source:
        traits.append('source'); vals.append(a.ENC_STR(dest))
    n = len(traits)
    flag = (n << 4) | 3
    if dynamic:
        flag |= 8
    out = bytes([0x0A]) + a.u29(flag) + a._s('flex.messaging.messages.RemotingMessage')
    for t in traits: out += a._s(t)
    for v in vals:   out += v
    if dynamic:
        out += a._s('')      # end of dynamic members
    return out


# ── Strategies ────────────────────────────────────────────────────────────────

def s_legacy_amf0_full():
    body = bytes([0x11]) + a.ENC_ARRAY([a.ENC_INT(Y), a.ENC_INT(M), a.ENC_INT(D)])
    return envelope(f'{DEST}.{OP}', '/1', body, version=0), 'Legacy target="dest.op", AMF3 array body'

def s_legacy_amf0_pure():
    body = amf0_strict_array([amf0_number(Y), amf0_number(M), amf0_number(D)])
    return envelope(f'{DEST}.{OP}', '/1', body, version=0), 'Legacy target="dest.op", AMF0 array body'

def s_legacy_method_only():
    body = amf0_strict_array([amf0_number(Y), amf0_number(M), amf0_number(D)])
    return envelope(OP, '/2', body, version=0), 'Legacy target="op only", AMF0 array body'

def s_legacy_amf3_v3():
    body = bytes([0x11]) + a.ENC_ARRAY([a.ENC_INT(Y), a.ENC_INT(M), a.ENC_INT(D)])
    return envelope(f'{DEST}.{OP}', '/3', body, version=3), 'Legacy target="dest.op", v3 envelope, AMF3 body'

def s_sealed_null():
    body = bytes([0x11]) + sealed_remoting(DEST, OP, [a.ENC_INT(Y), a.ENC_INT(M), a.ENC_INT(D)])
    return envelope('null', '/4', body, version=3), 'Sealed RemotingMessage, target=null'

def s_sealed_dynamic():
    body = bytes([0x11]) + sealed_remoting(DEST, OP, [a.ENC_INT(Y), a.ENC_INT(M), a.ENC_INT(D)], dynamic=True)
    return envelope('null', '/5', body, version=3), 'Sealed DYNAMIC RemotingMessage, target=null'

def s_sealed_with_source():
    body = bytes([0x11]) + sealed_remoting(DEST, OP, [a.ENC_INT(Y), a.ENC_INT(M), a.ENC_INT(D)], with_source=True)
    return envelope('null', '/6', body, version=3), 'Sealed RemotingMessage + source, target=null'

def s_ext_message():
    body = bytes([0x11]) + a.make_remoting_msg(DEST, OP, [a.ENC_INT(Y), a.ENC_INT(M), a.ENC_INT(D)])
    return envelope('null', '/7', body, version=3), 'Externalizable RemotingMessage, target=null'


STRATEGIES = [
    s_legacy_amf0_pure,
    s_legacy_amf0_full,
    s_legacy_method_only,
    s_legacy_amf3_v3,
    s_sealed_null,
    s_sealed_dynamic,
    s_sealed_with_source,
    s_ext_message,
]


def run():
    print('=== AMF Strateji Taraması ===')
    print(f'Endpoint: {a.ENDPOINT}')
    print(f'Tarih: {today}  ({Y},{M},{D})\n')

    hits = []
    for fn in STRATEGIES:
        data, label = fn()
        try:
            r = requests.post(a.ENDPOINT, data=data, headers=a.HEADERS, timeout=15)
        except Exception as e:
            print(f'❌ {label}\n   bağlantı hatası: {e}\n')
            continue

        vessels = a.decode_response(r.content)
        fault   = a.find_fault(r.content)
        ok = '🚢' if vessels else ('⚠️' if fault else '·')
        print(f'{ok} {label}')
        print(f'   HTTP {r.status_code} | {len(r.content)} byte')
        if vessels:
            print(f'   {len(vessels)} gemi bulundu!')
            for v in vessels[:4]:
                info = {k: val for k, val in v.items()
                        if k != '__cls' and val not in (None, '', 0, 0.0)}
                print(f'      {info}')
            hits.append(label)
        elif fault:
            print(f'   Hata: {fault[:160]}')
        else:
            _, rel = a.parse_amf_strings(r.content)
            print(f'   stringler: {rel[:6] if rel else "(yok)"}')
        print()

    print('=' * 50)
    if hits:
        print('✅ ÇALIŞAN STRATEJİ(LER):')
        for h in hits: print(f'   {h}')
    else:
        print('Hiçbiri gemi döndürmedi. Hata mesajlarını paylaş.')


if __name__ == '__main__':
    run()
