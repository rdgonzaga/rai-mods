"""Synthesizes rai-hud's 8-bit sound effects into this folder.

Run `python make_sounds.py` to regenerate them after tweaking the notes below.
"""
import math
import os
import struct
import wave

RATE = 22050
HERE = os.path.dirname(os.path.abspath(__file__))


def tone(freq, ms, vol=0.35, duty=0.5, slide=0.0):
    """A square wave with a short attack and release, optionally sliding in pitch."""
    n = int(RATE * ms / 1000)
    out = []
    phase = 0.0
    for i in range(n):
        f = freq + slide * (i / n)
        phase = (phase + f / RATE) % 1.0
        sample = 1.0 if phase < duty else -1.0
        env = min(1.0, i / (RATE * 0.004), (n - i) / (RATE * 0.02))
        out.append(sample * vol * env)
    return out


def rest(ms):
    return [0.0] * int(RATE * ms / 1000)


def save(name, samples):
    path = os.path.join(HERE, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in samples))
    print('wrote', path)


# Turn finished: a bright two-note chirp
save('done.wav', tone(988, 70, duty=0.25) + tone(1319, 140, duty=0.25))

# Guard alert: two-tone siren, twice
siren = []
for _ in range(2):
    siren += tone(880, 110, vol=0.3, slide=440) + tone(1320, 110, vol=0.3, slide=-440)
save('alert.wav', siren)

# Level up: a rising arpeggio with a held top note
arp = []
for f in [523, 659, 784, 1047, 1319]:
    arp += tone(f, 60, duty=0.25)
arp += tone(1568, 260, duty=0.125)
save('levelup.wav', arp)

# Turn stopped or errored: a falling buzz
save('fail.wav', tone(330, 120, vol=0.3, slide=-110) + rest(30) + tone(220, 200, vol=0.3, slide=-80))
