# 인스타 댓글 → DM 자동응답 웹훅 서버

댓글에 정해둔 키워드(예: "지원금")가 달리면, 그 사람에게만 보이는 비공개 메시지(DM)를 자동으로 보내는 서버입니다.

## 오늘까지 한 일 (2026-09-10)
- [x] 페이스북 페이지가 필요한지 공식 문서로 확인 → **필요 없음**으로 확인됨 (아래 "페이스북 페이지, 왜 필요 없는지" 참고)
- [x] 서버 코드 작성 완료 (`server.js`)
- [ ] 메타 앱에 Webhooks 제품 등록 (다음 단계, 대표 컴퓨터 브라우저 필요)
- [ ] 실제 서버 배포 (다음 단계)
- [ ] 실전 테스트 — 진짜 댓글을 달아서 DM이 오는지 확인 (배포 후)

## 페이스북 페이지, 왜 필요 없는지
메타 공식 문서(Instagram Platform / Instagram API with Instagram Login)를 2026-09-10에 직접 확인했습니다.

> "This API setup does not require a Facebook Page to be linked to the Instagram professional account."

우리가 이미 쓰고 있는 방식(Instagram Login으로 발급받은 IGAAP 토큰)이 바로 이 "Instagram API with Instagram Login" 방식입니다. 그래서 페이스북 페이지를 새로 만들 필요가 없습니다. (참고: 페이스북 페이지가 필요한 경우는 옛날 방식인 "Facebook Login for Business"를 쓸 때뿐입니다.)

다만 문서에 이런 조건이 하나 있습니다.

> "The Instagram professional account that owns the media objects must be public to receive notifications for comments or @mentions."

→ mua___st 계정이 **공개(퍼블릭)** 상태여야 댓글 알림 자체를 받을 수 있습니다. 비공개 계정이면 웹훅 자체가 안 옵니다. (이미 공개 계정일 가능성이 높지만, 다음 대화에서 한 번 확인이 필요합니다.)

## 사용하는 API (전부 공식 문서 기준, 2026-09-10 확인)
- 댓글 웹훅 수신 형식: https://developers.facebook.com/docs/instagram-platform/webhooks/examples/
- 웹훅 등록 검증(핸드셰이크): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- 서명 검증(X-Hub-Signature-256): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- 비공개 답장 발송: https://developers.facebook.com/documentation/instagram-platform/private-replies

## 메타 쪽 제한사항 (우리가 바꿀 수 없는 규칙)
- 댓글이 달린 지 **7일 안에만** 비공개 답장 가능 (라이브 방송 댓글은 방송 중에만)
- 한 댓글당 비공개 답장은 **딱 1번만** 가능
- 상대가 먼저 우리 메시지에 답장해야, 그 다음부터 24시간 안에 후속 메시지를 보낼 수 있음
- 필요 권한(이미 발급 완료): `instagram_business_basic`, `instagram_business_manage_comments` — 어제 저녁 토큰 발급 시 이미 허용됨

## 다음에 해야 할 일 (순서대로)
1. mua___st 계정이 공개 계정인지 확인
2. 메타 앱(ZenEnsoMua SNS, 앱 ID 1460384025908418) 대시보드에서 **Webhooks** 제품 추가 → `comments` 필드 구독
   - 이 단계는 **서버가 실제로 인터넷에서 열려 있어야** 검증(핸드셰이크)이 통과됨 → 3번(배포)과 같이 진행해야 함
3. 서버를 실제로 배포 (인터넷에서 접속 가능한 주소가 필요함 — Render, Railway, Fly.io 같은 무료/저가 호스팅 옵션이 있음, 어느 걸 쓸지는 다음 대화에서 비교해서 정함)
4. `.env` 파일에 실제 값 채우기 (VERIFY_TOKEN은 내가 아무 문자열이나 정하면 됨, APP_SECRET·IG_USER_ID·IG_ACCESS_TOKEN은 메타 콘솔에서 그대로 복사)
5. `triggers.json`에 실제 쓸 키워드·답장 문구 확정
6. 진짜 댓글을 달아서 DM이 오는지 실전 테스트

## 로컬에서 실행하는 법 (테스트용)
```bash
npm install
cp .env.example .env   # 값 채운 뒤
npm start
```
서버는 3000번 포트에서 뜨지만, 메타가 접속하려면 인터넷에 열려 있는 주소가 필요합니다(로컬 PC만으로는 안 됨) — 그래서 3번(배포) 단계가 필요합니다.
