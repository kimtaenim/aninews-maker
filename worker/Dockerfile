# aninews 합성 워커 — ffmpeg + 폰트(한·중·일 Noto CJK, 베트남어 등 라틴 Noto/DejaVu).
FROM node:20-slim

# ffmpeg(자막 번인엔 fontconfig 필요) + CJK 폰트 + 라틴 폰트(베트남어 성조 부호용).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-core fonts-dejavu-core fontconfig \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

CMD ["node", "index.mjs"]
