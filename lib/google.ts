// ============================================================================
// Google Drive 업로드 — OAuth(드라이브 file 스코프) + 완성 영상 업로드.
// 사용자별로 refresh token 을 Redis 에 저장(gdrive:{email}). drive.file 스코프라
// 앱이 만든 파일만 접근 → 구글 앱 심사 불필요.
// ============================================================================

import { getRedis } from "./redis";

// 앱이 만든 파일만 접근하는 최소 권한 스코프(심사 불필요).
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_KEY = (email: string) => `gdrive:${email.toLowerCase()}`;
const FOLDER_NAME = "ANINEWS";

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID missing in .env.local");
  return v;
}
function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET missing in .env.local");
  return v;
}

// 동의 화면 URL. access_type=offline + prompt=consent 로 refresh token 확보.
export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// 콜백 code → 토큰. refresh_token 을 저장한다.
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{ refreshToken?: string }> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error(`Google 토큰 교환 실패 (HTTP ${r.status})`);
  const data = (await r.json()) as { refresh_token?: string };
  return { refreshToken: data.refresh_token };
}

async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`Google 액세스 토큰 갱신 실패 (HTTP ${r.status})`);
  const data = (await r.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("액세스 토큰을 받지 못했어요 (재연결 필요)");
  return data.access_token;
}

// ── 토큰 저장소 ──────────────────────────────────────────────────────────────
export async function saveDriveToken(email: string, refreshToken: string): Promise<void> {
  await getRedis().set(TOKEN_KEY(email), { refreshToken });
}
export async function getDriveRefreshToken(email: string): Promise<string | null> {
  const v = await getRedis().get<{ refreshToken: string }>(TOKEN_KEY(email));
  return v?.refreshToken ?? null;
}
export async function isDriveConnected(email: string): Promise<boolean> {
  return !!(await getDriveRefreshToken(email));
}
export async function disconnectDrive(email: string): Promise<void> {
  await getRedis().del(TOKEN_KEY(email));
}

// ── 업로드 ───────────────────────────────────────────────────────────────────
// ANINEWS 폴더 id(없으면 생성).
async function ensureFolder(accessToken: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const list = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (list.ok) {
    const data = (await list.json()) as { files?: Array<{ id: string }> };
    if (data.files && data.files[0]) return data.files[0].id;
  }
  const create = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    }
  );
  if (!create.ok) throw new Error(`드라이브 폴더 생성 실패 (HTTP ${create.status})`);
  const folder = (await create.json()) as { id: string };
  return folder.id;
}

// 영상 bytes 를 ANINEWS 폴더에 resumable 업로드. 반환: 보기 링크.
export async function uploadVideoToDrive(args: {
  email: string;
  filename: string;
  bytes: Buffer;
  mimeType?: string;
}): Promise<{ fileId: string; link: string }> {
  const refreshToken = await getDriveRefreshToken(args.email);
  if (!refreshToken) throw new Error("Google 드라이브가 연결되지 않았어요 (먼저 연결)");
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const folderId = await ensureFolder(accessToken);
  const mimeType = args.mimeType ?? "video/mp4";

  // 1) resumable 세션 생성.
  const init = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify({ name: args.filename, parents: [folderId], mimeType }),
    }
  );
  if (!init.ok) throw new Error(`업로드 세션 생성 실패 (HTTP ${init.status})`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("업로드 URL 을 받지 못했어요");

  // 2) bytes 전송.
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": mimeType },
    body: new Uint8Array(args.bytes),
  });
  if (!put.ok) throw new Error(`드라이브 업로드 실패 (HTTP ${put.status})`);
  const file = (await put.json()) as { id: string };
  return { fileId: file.id, link: `https://drive.google.com/file/d/${file.id}/view` };
}
