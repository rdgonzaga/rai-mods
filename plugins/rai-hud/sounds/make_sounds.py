"""Synthesizes rai-hud's sound effects into this folder.

Run `python make_sounds.py` to regenerate them after tweaking the notes below.
Soft sine and triangle voices with a decaying tail and a faint echo, kept quiet.
"""
import math
import os
import struct
import wave

RATE = 22050
HERE = os.path.dirname(os.path.abspath(__file__))
PEAK = 0.12


def tone(freq, ms, wave_='sine', slide=0.0, decay=6.0):
    """One note: a 10ms attack, then an exponential decay, optionally sliding in pitch."""
    n = int(RATE * ms / 1000)
    out = []
    phase = 0.0
    for i in range(n):
        f = freq + slide * (i / n)
        phase = (phase + f / RATE) % 1.0
        s = 4 * abs(phase - 0.5) - 1 if wave_ == 'triangle' else math.sin(2 * math.pi * phase)
        t = i / RATE
        env = min(1.0, t / 0.010) * math.exp(-decay * t) * min(1.0, (n - i) / (RATE * 0.01))
        out.append(s * env)
    return out


def rest(ms):
    return [0.0] * int(RATE * ms / 1000)


def echo(samples, ms=110, amount=0.3):
    """Adds one quieter copy of `samples`, `ms` later."""
    offset = int(RATE * ms / 1000)
    out = samples + [0.0] * offset
    for i, s in enumerate(samples):
        out[offset + i] += s * amount
    return out


def save(name, samples):
    loudest = max(abs(s) for s in samples) or 1.0
    path = os.path.join(HERE, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(s * PEAK / loudest * 32767)) for s in samples))
    print('wrote', path)


# Turn finished: two soft notes rising a fourth
save('done.wav', echo(tone(880, 120, decay=10) + tone(1175, 360, decay=7)))

# Guard alert: two gentle low-mid pulses, then a held third
pulse = tone(523, 160, decay=8) + rest(60)
save('alert.wav', echo(pulse + pulse + tone(659, 260, decay=6)))

# Level up: a triangle arpeggio with a long top note
arp = []
for f in [523, 659, 784, 1047]:
    arp += tone(f, 90, wave_='triangle', decay=9)
arp += tone(1319, 600, wave_='triangle', decay=4)
save('levelup.wav', echo(arp, ms=140, amount=0.35))

# Turn errored: a low falling sine
save('fail.wav', echo(tone(392, 180, slide=-60, decay=6) + tone(294, 380, slide=-40, decay=5)))
