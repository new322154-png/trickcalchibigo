"""캐릭터 표정 애니메이션 정리: 크기 맞춤 + 발 위치 맞춤 + 같은 캔버스 + 프레임 절반
사용: python3 scripts/prep-character.py '{"normal":["원본.webp",1],"smile":["원본2.webp",1.05]}' 출력폴더 [프레임간격=2]
  숫자 = 크기 배율 (표정마다 그려진 크기가 다를 때 머리 크기가 같아지게 조절)
import sys, json
from PIL import Image
import numpy as np
src = json.loads(sys.argv[1])   # {emotion: [file, scale]}
outdir = sys.argv[2]; step = int(sys.argv[3]) if len(sys.argv) > 3 else 2
data = {}
for emo, (f, s) in src.items():
    im = Image.open(f); frames = []; durs = []
    for i in range(getattr(im, 'n_frames', 1)):
        im.seek(i); fr = im.convert('RGBA')
        if s != 1: fr = fr.resize((round(fr.width * s), round(fr.height * s)), Image.LANCZOS)
        frames.append(fr)
    # 모든 프레임을 합친 영역
    A = np.zeros((frames[0].height, frames[0].width), bool)
    for fr in frames: A |= np.array(fr.getchannel('A')) > 8
    ys, xs = np.nonzero(A); top, bot, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    # 몸 중심: 아래쪽 20% (발·구름) 의 가로 중심
    band = A[bot - (bot - top) // 5: bot + 1]; bx = np.nonzero(band.any(0))[0]
    cx = (bx.min() + bx.max()) / 2
    data[emo] = dict(frames=frames, top=top, bot=bot, left=left, right=right, cx=cx)
# 공통 캔버스: 몸 중심에서 좌우 최대 거리, 발에서 위로 최대 높이
half = max(max(d['cx'] - d['left'], d['right'] - d['cx']) for d in data.values()) + 12
H = max(d['bot'] - d['top'] for d in data.values()) + 24
W = int(half * 2)
print('canvas', W, H)
for emo, d in data.items():
    out = []
    for fr in d['frames'][::step]:
        c = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        c.alpha_composite(fr, (int(round(W / 2 - d['cx'])), int(H - 8 - d['bot'])))
        out.append(c)
    p = f"{outdir}/{emo}.webp"
    if len(out) == 1: out[0].save(p, 'WEBP', quality=88, method=5)
    else: out[0].save(p, 'WEBP', save_all=True, append_images=out[1:], duration=20 * step, loop=0, quality=72, method=6, minimize_size=True, alpha_quality=80)
    # 첫 프레임 png 도 (아이콘·미리보기용)
    out[0].save(f"{outdir}/_{emo}_first.png")
    import os; print(emo, len(out), 'frames', os.path.getsize(p) // 1024, 'KB')
