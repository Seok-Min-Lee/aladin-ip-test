// Bookrume 알라딘 API 프록시 (Render.com)
// Cloudflare Workers 버전(cloudflare-worker/src/index.js)에서 이식.
// 차이점: Durable Object 대신 프로세스 메모리 카운터로 쿼터 추적 (설계문서 4.4절 참고).
// 외부 패키지 없이 Node 내장 http + fetch(Node 18+)만 사용.

const http = require("http");

const ALADIN_BASE = "https://www.aladin.co.kr/ttb/api";
const DAILY_LIMIT = 5000; // 알라딘 일반 API 일일 호출 한도
const PORT = process.env.PORT || 3000;
const ALADIN_TTBKEY = process.env.ALADIN_TTBKEY;

// ---- 쿼터 카운터 (메모리 기반) ----
// 주의: Render 무료 티어는 15분간 요청이 없으면 슬립되고, 다음 요청 시 새 프로세스로
// 재시작되므로 이 카운트는 자주 초기화될 수 있음. 개인용 MVP 규모(일일 사용량이
// 5,000회에 한참 못 미침)에서는 이 정도로 충분. 다수 사용자로 확장 시 Render 무료
// PostgreSQL 등으로 영속화 필요 (설계문서 4.4절 백로그).
let quotaDate = todayString();
let quotaCount = 0;

function todayString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC 기준)
}

function checkAndIncrement(limit) {
  const today = todayString();
  if (today !== quotaDate) {
    quotaDate = today;
    quotaCount = 0;
  }
  if (quotaCount >= limit) {
    return { allowed: false, count: quotaCount };
  }
  quotaCount += 1;
  return { allowed: true, count: quotaCount };
}

/** 알라딘 응답 끝에 붙는 비정상 trailing semicolon 등을 방어적으로 제거 */
function cleanJson(text) {
  return text.trim().replace(/;+$/, "");
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/**
 * 알라딘 API를 호출한다. 검색어/ISBN 등 사용자 콘텐츠는 여기서 로그로 남기지 않음
 * (개인정보처리방침 "검색어를 별도 저장하지 않습니다"와 일치, 설계문서 14장/4.4절).
 */
async function callAladin(path, params) {
  const url = new URL(`${ALADIN_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("ttbkey", ALADIN_TTBKEY);
  url.searchParams.set("output", "js");
  url.searchParams.set("Version", "20131101");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(8000), // 알라딘 응답 지연 대비 타임아웃
  });
  const text = await res.text();
  return cleanJson(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bookrume proxy OK");
    return;
  }

  // 1) 라우팅 + 파라미터 검증 먼저 — 잘못된 요청은 쿼터를 소모하지 않고 즉시 반려
  let aladinPath;
  let aladinParams;

  if (url.pathname === "/search") {
    const query = url.searchParams.get("query")?.trim();
    if (!query) {
      return sendJson(res, 400, { errorMessage: "검색어를 입력해주세요." });
    }
    aladinPath = "ItemSearch.aspx";
    aladinParams = {
      Query: query,
      QueryType: "Title",
      MaxResults: url.searchParams.get("maxResults") || "20",
      start: url.searchParams.get("start") || "1",
      SearchTarget: "Book",
    };
  } else if (url.pathname === "/lookup") {
    const isbn13 = url.searchParams.get("isbn13")?.trim();
    if (!isbn13 || !/^\d{13}$/.test(isbn13)) {
      return sendJson(res, 400, { errorMessage: "올바른 ISBN13이 필요해요." });
    }
    aladinPath = "ItemLookUp.aspx";
    aladinParams = {
      ItemId: isbn13,
      ItemIdType: "ISBN13",
      OptResult: url.searchParams.get("optResult") || "packing,itemPage",
    };
  } else {
    return sendJson(res, 404, { errorMessage: "Not found" });
  }

  if (!ALADIN_TTBKEY) {
    return sendJson(res, 500, { errorMessage: "서버에 ALADIN_TTBKEY가 설정되지 않았습니다." });
  }

  // 2) 유효한 요청만 쿼터 확인 + 증가
  const quota = checkAndIncrement(DAILY_LIMIT);
  if (!quota.allowed) {
    return sendJson(res, 429, { errorMessage: "오늘의 도서 정보 조회 한도를 다 썼어요. 내일 다시 시도해주세요." });
  }

  // 3) 알라딘 호출
  try {
    const body = await callAladin(aladinPath, aladinParams);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
  } catch (err) {
    sendJson(res, 502, { errorMessage: "알라딘 서버 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요." });
  }

  // 참고: CORS 헤더는 의도적으로 생략함 — MVP는 모바일 전용이라 불필요
});

server.listen(PORT, () => {
  console.log(`Bookrume proxy listening on port ${PORT}`);
});
