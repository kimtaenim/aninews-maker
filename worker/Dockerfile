# aninews 합성 워커 — ffmpeg + 한글 폰트(Noto CJK) 포함.
FROM node:20-slim

# ffmpeg(자막 번인엔 fontconfig 빌드 필요 — Debian ffmpeg 는 포함) + 한글 폰트.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk fonts-noto-cjk-extra fontconfig \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

CMD ["node", "index.mjs"]
