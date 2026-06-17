# aninews-maker21

숏폼 뉴스 영상 자동 생성기 — RSS·URL·텍스트 → 스크립트(씬 배열) → 일관된 이미지 →
image-to-video → ffmpeg 합성(보이스오버·BGM·자막). 각 단계는 사람이 검수·승인해야
다음으로 넘어가며, 단계마다 Claude **StepChat**으로 미세조정한다.

cardnews-maker(`../cardnews-maker21`, repo: `kimtaenim/cardnews-maker`)의 구조·컨벤션·팔레트를
그대로 따른다: Next.js 16 App Router + TS, Tailwind v4, 민트/teal 액센트, config 기반 설계,
`lib/` 프로바이더 모듈 분리.

## 파이프라인 단계

| # | 단계 | 엔진 | 비고 |
|---|------|------|------|
| 1 | source   | rss-parser / fetch | RSS·URL·텍스트 (cardnews collect 이식) |
| 2 | script   | Claude | 씬 배열 JSON (narration+image_prompt+motion) + style_bible |
| 3 | keyframe | gpt-image-2 | 씬0 1장으로 스타일·인물·팔레트 확정 |
| 4 | images   | gpt-image-2 (edits) | 키프레임 레퍼런스로 씬별 생성·리롤, 9:16 |
| 5 | videos   | fal (Seedance, 교체가능) | 분 단위 비동기 → 제출·폴링 |
| 6 | voiceover| ElevenLabs | 선택, 타임스탬프=자막 타이밍 소스 |
| 7 | compose  | ffmpeg (**worker**) | 클립 이어붙이기 + VO + BGM, 오디오 워핑 금지 |
| 8 | subtitle | Claude 번역 + ffmpeg | 자막 번인, 한글 폰트 등록 |

각 단계 상태: `pending → generating → generated → approved`. 씬 단위 리롤 지원.

## 배포

- **Vercel**: 프런트 + 가벼운 API (소스/스크립트/이미지/StepChat/폴링).
- **별도 상시 서버** (`worker/`, Render/Railway/Fly): ffmpeg 합성 + fal 장시간 폴링.
  Vercel 서버리스 60초·메모리 한계를 넘으므로 분리. Redis 큐를 폴링한다.

## 시작

```bash
npm install
cp .env.local.example .env.local   # 키 채우기
npm run dev
```

자세한 스타일 프로필·config 는 `config/` 참고.
