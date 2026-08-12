// Render.com의 발신 IP가 알라딘 API에서 차단되는지 확인하기 위한 최소 테스트 서버.
// 외부 패키지 없이 Node 내장 http + fetch(Node 18+)만 사용.

const http = require("http");

const PORT = process.env.PORT || 3000;
const ALADIN_TTBKEY = process.env.ALADIN_TTBKEY;
const TEST_ISBN13 = "9791139729771"; // 이전에 packing 필드까지 확인됐던 테스트용 ISBN

const server = http.createServer(async (req, res) => {
  if (req.url === "/test") {
    if (!ALADIN_TTBKEY) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "ALADIN_TTBKEY 환경변수가 설정되지 않았습니다." }));
      return;
    }

    const url =
      `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx` +
      `?ttbkey=${encodeURIComponent(ALADIN_TTBKEY)}` +
      `&ItemId=${TEST_ISBN13}&ItemIdType=ISBN13&output=js&Version=20131101`;

    try {
      const aladinRes = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await aladinRes.text();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(text);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("OK - /test 로 접속해서 알라딘 IP 차단 여부를 확인하세요.");
});

server.listen(PORT, () => {
  console.log(`서버 시작됨: 포트 ${PORT}`);
});
