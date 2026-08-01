// 롱폼 제목 생성기를 소재만 주고 돌려본다 — 저장 없음(프로젝트 안 건드림).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/try-longform-title.ts
import { generateLongformTitles } from "../lib/longformTitleGen";
import { titleViolations } from "../lib/longformTitleCheck";
import { promiseViolations } from "../lib/longformTitleCheck";

async function main() {
  const pkg = await generateLongformTitles({
    projectId: "dry-run",
    input: {
      type: "compilation",
      constituents: [
        {
          title: "메모리 반도체란?",
          topic:
            "삼성전자·SK하이닉스·마이크론 빅3가 메모리 시장을 이끈다. DRAM은 전원이 꺼지면 기억이 날아가고 플래시는 남는다. 랜덤 액세스가 장점. AI 시대로 시장이 뜨거워졌다.",
        },
        {
          title: "메모리 공급 대란",
          topic:
            "AI 데이터센터 때문에 DRAM 가격이 172% 폭등했다. DDR5는 두 배가 됐다. HP는 메모리 비용 직격탄을 맞았고 PC 시장이 10~11% 줄 전망. 빅테크는 값을 가리지 않고 긁어모은다.",
        },
        {
          title: "HBM이란?",
          topic:
            "HBM은 반도체를 시루떡처럼 쌓아 대역폭을 키운 메모리. SK하이닉스·삼성전자·마이크론이 세계 시장을 나눠 갖는다. HBM을 만드느라 범용 DRAM 생산이 줄어 DDR5 값이 올랐다.",
        },
      ],
      coreTopic: "HBM 쏠림이 일반 DRAM 값을 흔든 구조",
      viewerPayoff: "메모리 값이 왜 이렇게 움직였는지 한 번에 이해한다",
    },
  });

  console.log(`주 검색어: ${pkg.primaryKeyword} / 근거: ${pkg.keywordRationale}\n`);
  pkg.candidates.forEach((c, i) => {
    const v = titleViolations(c.title, pkg.primaryKeyword);
    console.log(`${i === pkg.recommendedIndex ? "★" : " "} ${c.title}`);
    console.log(`    썸네일: ${c.thumbnailText}`);
    if (v.length) console.log(`    ⚠ ${v.join(" / ")}`);
  });
  console.log(`\n추천: ${pkg.recommendation}`);
  console.log(`title_promise: ${pkg.titlePromise}`);
  const pv = promiseViolations(pkg.titlePromise);
  console.log(pv.length ? `  ⚠ ${pv.join(" / ")}` : "  ✓ 질문으로 적혔음");
  if (pkg.rejected.length) {
    console.log("\n탈락:");
    pkg.rejected.forEach((r) => console.log(`  - ${r.title} — ${r.reason}`));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
