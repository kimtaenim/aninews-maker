import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// 비로그인 접근 차단. /login 과 인증 API(/api/auth/*)는 공개. 그 외 페이지·API는
// 세션 필요(특히 비용 발생 API 보호). edge 에서 jose 로 JWT 만 검증(bcrypt 미사용).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const email = token ? await verifySessionToken(token) : null;
  if (email) return NextResponse.next();

  // API 는 401 JSON, 페이지는 /login 으로 리다이렉트(+ next 파라미터).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // 정적 자산(_next, 이미지/미디어, favicon)은 미들웨어 제외.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|mp4|mp3|woff2?)$).*)",
  ],
};
