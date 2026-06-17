# aninews-maker21 worker

ffmpeg 합성과 fal 장시간 폴링을 처리하는 **별도 상시 서버**. Vercel 서버리스
60초·메모리 한계를 넘는 작업 전용. Render/Railway/Fly 등에 배포한다.

- Next 앱과 **같은 Redis** 를 본다 (`lib/jobQueue.ts` 가 적재한 `jobq:*` 리스트).
- 큐를 `BRPOP` 으로 소비 → 작업 실행 → 결과를 Blob 에 올리고 Job 상태 갱신.
- ffmpeg 바이너리가 있는 런타임 필요 (Docker 이미지에 ffmpeg 포함).

## 잡 종류
| type | 하는 일 |
|------|---------|
| `video`    | fal image-to-video 제출·폴링 → 클립 URL |
| `compose`  | 클립 이어붙이기 + 보이스오버 + BGM (음성에 느슨하게 맞춤, 워핑 금지) |
| `subtitle` | 자막 번인 (한글 폰트 등록, 타이밍=TTS 타임스탬프) |

## 환경변수
Next 앱과 공유: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`,
`FAL_KEY`, `WORKER_SHARED_SECRET`. (별도 package.json/tsconfig 로 독립 빌드 예정.)
