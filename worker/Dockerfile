# aninews 합성 워커 — ffmpeg + 폰트(한·중·일 Noto CJK, 베트남어 등 라틴 Noto/DejaVu,
# 자막 프리셋용 나눔 손글씨(펜·붓)·명조·고딕).
FROM node:20-slim

# ffmpeg(자막 번인엔 fontconfig 필요) + CJK 폰트 + 라틴 폰트(베트남어 성조 부호용)
# + fonts-nanum(NanumPen 손글씨·NanumBrush 붓·NanumMyeongjo·NanumGothic — 자막 스타일 다양화).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-core fonts-dejavu-core fonts-nanum fontconfig \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

CMD ["node", "index.mjs"]
