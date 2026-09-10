// 댓글 → DM 자동응답 웹훅 서버 (Zen Enso Mua / mua___st 인스타그램)
//
// 흐름: 인스타 댓글이 달리면 메타가 이 서버로 POST /webhook 신호를 보낸다
//   → 댓글 글자 안에 우리가 정한 "키워드"가 있는지 본다
//   → 있으면 그 사람에게만 보이는 비공개 DM(private reply)을 자동으로 보낸다
//
// 근거(2026-09-10 공식 문서 직접 확인, 상상으로 쓴 코드 아님):
//   - 댓글 웹훅 페이로드 구조: https://developers.facebook.com/docs/instagram-platform/webhooks/examples/
//   - 검증 핸드셰이크(hub.mode/hub.verify_token/hub.challenge): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
//   - 서명 검증(X-Hub-Signature-256, SHA256, App Secret): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
//   - 비공개 답장 API(POST /<IG_USER_ID>/messages, recipient.comment_id): https://developers.facebook.com/documentation/instagram-platform/private-replies
//
// ⚠ 공식 문서가 밝힌 제한 사항 (코드가 아니라 메타 쪽 규칙이라 못 바꿈):
//   - 댓글이 달린 지 7일 안에만 답장 가능(라이브 방송 댓글은 방송 중에만)
//   - 한 댓글당 비공개 답장은 딱 1번만 보낼 수 있음
//   - 상대가 먼저 우리 DM에 답장해야 그 다음부터 24시간 안에 후속 메시지 가능
//   - 인스타 계정이 "공개(퍼블릭)" 상태여야 댓글 알림 자체를 받을 수 있음

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

// 서명 검증을 하려면 "가공 전 원본 바이트"가 필요해서, JSON 파싱과 동시에 rawBody를 저장해둔다
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const {
  VERIFY_TOKEN,      // 메타 앱 대시보드에 내가 직접 정해서 입력하는 문자열 (아무 값이나 정해도 됨, 양쪽이 같으면 됨)
  APP_SECRET,        // 메타 앱 대시보드 > 설정 > 기본 설정에 있는 "앱 시크릿 코드"
  IG_USER_ID,         // mua___st 계정의 인스타그램 전문가 계정 ID (Meta 콘솔 Instagram API 설정 화면에서 확인)
  IG_ACCESS_TOKEN,    // 이미 발급받은 IGAAP... 토큰
  PORT = 3000,
} = process.env;

for (const [name, value] of Object.entries({ VERIFY_TOKEN, APP_SECRET, IG_USER_ID, IG_ACCESS_TOKEN })) {
  if (!value) {
    console.warn(`⚠ 환경변수 ${name} 이(가) 비어 있음 — .env 파일을 채운 뒤 다시 실행하세요`);
  }
}

// 키워드 → 보낼 메시지 매핑. 게시물마다 다른 키워드를 쓰고 싶으면 이 파일만 고치면 됨(코드 수정 불필요)
const TRIGGERS_PATH = path.join(__dirname, 'triggers.json');
function loadTriggers() {
  try {
    return JSON.parse(fs.readFileSync(TRIGGERS_PATH, 'utf8'));
  } catch (e) {
    console.error('triggers.json 을 읽지 못함:', e.message);
    return {};
  }
}

// ── 1) 웹훅 등록 검증 (메타가 최초 1회, GET으로 확인하러 옴) ─────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ 웹훅 검증 성공');
    return res.status(200).send(challenge);
  }
  console.warn('❌ 웹훅 검증 실패 — 토큰 불일치');
  return res.sendStatus(403);
});

// ── 2) 실제 이벤트 수신 (댓글이 달릴 때마다 메타가 POST로 보내줌) ────────────
app.post('/webhook', async (req, res) => {
  // 메타는 5초 안에 200 응답을 못 받으면 재전송을 시작한다 → 먼저 200으로 응답하고, 처리는 뒤에서 한다
  res.sendStatus(200);

  if (!verifySignature(req)) {
    console.warn('❌ 서명 검증 실패 — 메타가 아닌 곳에서 온 요청일 수 있어 무시함');
    return;
  }

  const body = req.body;
  if (body.object !== 'instagram') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      await handleComment(change.value);
    }
  }
});

function verifySignature(req) {
  const signature = req.get('X-Hub-Signature-256');
  if (!signature || !req.rawBody) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  // 타이밍 공격 방지를 위해 crypto.timingSafeEqual 사용
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleComment(commentValue) {
  const commentId = commentValue.comment_id || commentValue.id;
  const text = (commentValue.text || '').trim();
  const from = commentValue.from || {};

  console.log(`💬 새 댓글 [${from.username || from.id || '알수없음'}]: "${text}"`);

  const triggers = loadTriggers();
  const matchedKeyword = Object.keys(triggers).find((keyword) =>
    text.toLowerCase().includes(keyword.toLowerCase())
  );

  if (!matchedKeyword) {
    console.log('  → 등록된 키워드 없음, 그냥 지나감');
    return;
  }

  const replyMessage = triggers[matchedKeyword];
  console.log(`  → 키워드 "${matchedKeyword}" 매칭됨 → 비공개 답장 발송 시도`);

  try {
    const result = await sendPrivateReply(commentId, replyMessage);
    console.log('  ✅ 비공개 답장 발송 성공:', result);
  } catch (err) {
    // 문서에 명시된 제한(7일 지남 / 이미 1번 보냄)에 걸리면 여기로 옴 — 정상적인 실패 케이스
    console.error('  ❌ 비공개 답장 발송 실패:', err.message);
  }
}

async function sendPrivateReply(commentId, text) {
  const url = `https://graph.instagram.com/v21.0/${IG_USER_ID}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${IG_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error?.message || `HTTP ${resp.status}`);
  }
  return data;
}

// 서버가 살아있는지 확인용 (배포 후 브라우저로 열어보면 됨)
app.get('/', (_req, res) => res.send('OK - IG 댓글→DM 웹훅 서버 작동 중'));


// ── 테스트용: 샘플 이미지 제공 (실전 확인 끝나면 지워도 됨) ──
app.get('/sample.jpg', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public_sample.jpg'));
});

// ── 테스트용: 샘플 게시물 1장 발행 (실전 확인 끝나면 지울 것) ──
// VERIFY_TOKEN을 key로 재사용 — 아무나 못 누르게 막는 용도, 테스트 전용 라우트라 간단하게
app.get('/admin/publish-test', async (req, res) => {
    if (req.query.key !== VERIFY_TOKEN) return res.sendStatus(403);
    try {
          const imageUrl = `https://${req.get('host')}/sample.jpg`;
          const caption = '웹훅 연결 테스트용 게시물입니다. 댓글에 "지원금"이라고 달아보세요!';

          const createResp = await fetch(`https://graph.instagram.com/v21.0/${IG_USER_ID}/media`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${IG_ACCESS_TOKEN}` },
                  body: JSON.stringify({ image_url: imageUrl, caption }),
          });
          const createData = await createResp.json();
          if (!createResp.ok) {
                  throw new Error('컨테이너 생성 실패: ' + (createData.error?.message || JSON.stringify(createData)));
          }

          // 인스타 서버가 image_url에서 사진을 다 가져갈 때까지 기다림 (바로 발행하면 "Media ID is not available" 에러남)
          let statusCode = 'IN_PROGRESS';
          for (let i = 0; i < 15 && statusCode === 'IN_PROGRESS'; i++) {
                  await new Promise((r) => setTimeout(r, 2000));
                  const statusResp = await fetch(
                            `https://graph.instagram.com/v21.0/${createData.id}?fields=status_code&access_token=${IG_ACCESS_TOKEN}`
                          );
                  const statusData = await statusResp.json();
                  statusCode = statusData.status_code;
          }
          if (statusCode !== 'FINISHED') {
                  throw new Error('이미지 준비 실패 (상태: ' + statusCode + ')');
          }

          const publishResp = await fetch(`https://graph.instagram.com/v21.0/${IG_USER_ID}/media_publish`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${IG_ACCESS_TOKEN}` },
                  body: JSON.stringify({ creation_id: createData.id }),
          });
          const publishData = await publishResp.json();
          if (!publishResp.ok) {
                        throw new Error(
                                  '발행 실패: ' +
                                    (publishData.error?.message || JSON.stringify(publishData)) +
                                    ' | debug: creationId=' + createData.id + ' finalStatus=' + statusCode
                                );
          }

          res.json({ success: true, mediaId: publishData.id });
    } catch (err) {
          res.status(500).json({ success: false, error: err.message });
    }
});
app.listen(PORT, () => {
  console.log(`🚀 웹훅 서버 실행 중 — 포트 ${PORT}`);
});
