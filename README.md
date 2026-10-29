# Color Hunter · 컬러 헌터

주변에서 목표 색을 찾아 스마트폰으로 찍는 **팀 대항 파티 웹게임**입니다. 설치 없이 QR로 참가하고, 사진은 휴대폰 안에서 분석하며, 점수는 서버가 다시 계산합니다.

```
color-hunter/
├─ shared/   게임 규칙 (색 변환, CIEDE2000, 점수, 팔레트, 팀, 순위, 메시지 형식) + 단위 테스트
├─ server/   실시간 게임 서버 — Cloudflare Workers + Durable Objects (방 하나 = DO 하나)
├─ web/      Next.js(App Router) + TypeScript + Tailwind, 정적 사이트(out/)로 빌드
└─ tests/    서버 통합 테스트, 브라우저 E2E(가짜 카메라), 재시작 복구 확인
```

## 1. 구조와 기술 선택

| 요청 스택 | 실제 선택 | 이유 |
|---|---|---|
| Firebase Auth 익명 로그인 | 방마다 서버가 발급하는 128bit 토큰(호스트·플레이어 분리) | 계정 없이도 새로고침·재접속 시 같은 사람으로 복구됨 |
| Firestore + Cloud Functions | **Cloudflare Durable Objects** | ① Firebase 무료(Spark)에서는 Cloud Functions를 쓸 수 없어 서버 측 점수 검증이 어려움 ② 30명 방에서 실시간 리스너를 쓰면 읽기가 인원 수만큼 늘어나 하루 무료 읽기(5만 건)가 금방 바닥남 ③ DO는 방마다 단일 스레드 서버라 마감·중복 확인·점수 반영이 자연스럽게 원자적 ④ 기존 잠만보가 이미 쓰는 인프라·계정(`*.dlwjd.workers.dev`) |
| Firestore Security Rules | 서버가 모든 상태 변경을 직접 처리 (클라이언트는 "요청"만 보냄) | 클라이언트는 DB에 직접 쓸 수 없어 규칙 우회가 원천적으로 불가 |
| Vercel | **GitHub Pages** | 기존 잠만보와 같은 방식, 상업 이용 제한 없음 |
| Zustand | `useSyncExternalStore` + 연결 클래스 하나 | 상태가 "서버가 보내는 방 스냅샷" 하나뿐이라 라이브러리가 필요 없음 |

**진행 방식**: 클라이언트 → `{t:'submit', round, pixels}` 같은 요청 → 방 DO가 검증·계산·저장 → 모든 참가자에게 방 스냅샷을 보냄. 라운드 전환(카운트다운 3초 → 사냥 → 결과 8초 → 다음)은 **DO 알람(서버 시계)**으로 진행되고, 클라이언트는 ping/pong으로 서버 시각과의 차이를 보정해서 타이머를 그립니다.

## 2. 로컬 실행

필요: Node 20+ (테스트는 Node 24에서 확인)

```bash
npm install
cp server/.dev.vars.example server/.dev.vars     # 로컬 비밀 값(개발용)
npm run dev:server                              # 게임 서버 http://localhost:8787
npm run dev:web                                 # 웹 http://localhost:3000
```

- PC 브라우저 하나에서 방을 만들고, **다른 브라우저 창(시크릿 창)**으로 `/play/?code=방코드`에 들어가면 혼자서도 흐름을 볼 수 있습니다. `localhost`는 보안 주소로 취급되어 PC 웹캠이 동작합니다.
- **휴대폰 실기기 테스트**: 브라우저는 HTTPS에서만 카메라를 허용합니다. 같은 와이파이의 `http://192.168.x.x:3000`에서는 카메라가 막히므로, 배포된 주소(아래 4장)나 HTTPS 터널(예: `npx cloudflared tunnel --url http://localhost:3000` — 게임 서버 8787도 따로 터널 필요)을 사용하세요.

## 3. 테스트

```bash
npm test                    # 단위 테스트 55개 (색 변환, CIEDE2000 표준 데이터, 점수 경계값, 팔레트, 팀, 동점 규칙)
npm run dev:server          # (다른 터미널) 아래 테스트 전에 서버 실행
npm run test:server         # 실제 서버에 웹소켓 여러 개로 접속하는 통합 테스트 4묶음
npm run build && npm run test:e2e   # Edge/Chromium 실브라우저 E2E (가짜 카메라)
```

## 4. 배포 (GitHub Pages + Cloudflare)

| 역할 | 어디에 | 주소 |
|---|---|---|
| 화면 | GitHub Pages (`.github/workflows/pages.yml`이 main에 push할 때마다 자동 배포) | `https://dlwjdskfcl.github.io/color-hunter/` |
| 실시간 서버 | Cloudflare Workers | `https://color-hunter.dlwjd.workers.dev` |

### 4-1. 게임 서버 (처음 한 번)
```powershell
cd C:\Users\dlwjdskfcl\dev\color-hunter\server
npx wrangler deploy
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"   # 무작위 문자열 하나 만들기
npx wrangler secret put ROOM_CODE_SECRET                          # 위 문자열을 붙여 넣기
```
`https://color-hunter.dlwjd.workers.dev/api/health`에서 `{"ok":true,...}`가 보이면 정상입니다.
`wrangler deploy`가 알려 준 주소가 다르면(계정 서브도메인이 다를 때) GitHub 저장소 Settings → Secrets and variables → Actions → **Variables**에 `SERVER_URL`로 그 주소를 넣으세요.

### 4-2. 화면 (처음 한 번)
1. GitHub에서 **Public** 저장소 `color-hunter`를 만듭니다. (무료 계정의 GitHub Pages는 공개 저장소에서만 됩니다. 코드에 비밀 값은 없습니다.)
2. 올리기
   ```powershell
   cd C:\Users\dlwjdskfcl\dev\color-hunter
   git add .
   git commit -m "Color Hunter"
   git branch -M main
   git remote add origin https://github.com/dlwjdskfcl/color-hunter.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages → Source: GitHub Actions** 선택
4. **Actions** 탭에서 "Deploy web to GitHub Pages"가 초록색이 되면 `https://dlwjdskfcl.github.io/color-hunter/` 접속

이후에는 코드를 고쳐 `git push`만 하면 화면이 자동으로 다시 배포됩니다. 서버를 고쳤을 때는 `server` 폴더에서 `npx wrangler deploy`를 다시 실행합니다.

### 4-3. 기존 잠만보 메뉴에 연결
잠만보 화면에 `https://dlwjdskfcl.github.io/color-hunter/` 링크만 걸면 됩니다. 같은 `dlwjdskfcl.github.io` 주소라 서버 허용 목록(`ALLOWED_ORIGINS`)도 이미 맞습니다.

## 5. 무료 사용량 (실측)

`tests/usage.mjs`로 **30명 · 10라운드** 한 판을 실제 서버에서 끝까지 돌려 잰 값입니다.

| 항목 | 무료 한도 (하루, 한국 시간 오전 9시 초기화) | 한 판 사용량 | 하루 가능 판수 |
|---|---|---|---|
| 저장소 쓰기(행) | 100,000 | **96** (최적화 전 1,316) | 약 1,000판 |
| DO 요청 | 100,000 (웹소켓 메시지 20개 = 1요청) | 약 50 | 약 2,000판 |
| Workers 요청 | 100,000 | 수십 | 충분 |

줄인 방법
- 제출이 올 때마다 저장하지 않고 1.5초씩 모아서 한 번에 저장 (게임 진행은 메모리에서, 저장은 서버 재시작 복구용)
- 분석 영역 데이터는 메모리에만 두고 라운드 최고 기록 1장만 저장
- 방 정리 알람을 활동 때마다 다시 걸지 않음, '다시 플레이' 때 지난 기록 삭제 대신 게임 번호로 구분
- 하트비트는 서버를 깨우지 않는 자동 응답, 시간 보정은 접속 때 2회만

알아 둘 것
- **무료 플랜은 한도를 넘어도 그날 요청이 실패할 뿐 자동 결제되지 않습니다.** 유료 플랜으로 직접 바꿀 때만 비용이 생깁니다.
- 판이 끝날 때마다 서버 로그에 `game_finished … storageWrites`가 남습니다. Cloudflare 대시보드 → Workers → color-hunter → Logs에서 실제 사용량을 볼 수 있습니다.
- 사진은 서버로 보내지 않습니다(32×32 색 정보 3KB만 전송).
- 한도 수치는 작성 시점 기준입니다. Cloudflare 공식 요금 문서에서 최신 값을 확인하세요.

## 6. 보안

- **호스트 권한**: 방을 만든 브라우저에만 저장되는 호스트 토큰. 모든 호스트 명령은 서버가 소켓의 역할을 확인 (`not_host` 테스트됨)
- **점수 조작 방지**: 클라이언트는 점수를 보내지 않습니다. 32×32 분석 영역 픽셀을 보내면 서버가 같은 알고리즘으로 대표색·ΔE·시간 보너스(서버 수신 시각 기준)를 계산
- **중복·재전송**: 플레이어·라운드당 1건만 반영. 같은 요청을 다시 보내면 기존 결과를 돌려줌
- **지각 제출**: 서버 시각으로 마감 이후 도착하면 무효 (`too_late`)
- **원자성**: DO는 한 번에 한 요청만 처리(입력 게이트)하므로 마감 확인→중복 확인→계산→저장 사이에 다른 제출이 끼어들 수 없음
- **방 코드 추측**: 6자리 중 마지막 1자리는 서버 비밀 값(HMAC)으로 만든 검증 문자. 무작위 코드는 DO를 깨우기 전에 Worker에서 404 (추측 31배 어려움 + 비용 절감)
- **기타**: 허용 Origin만 웹소켓·방 생성 가능, IP당 방 생성 제한, 소켓당 초당 메시지 제한, 메시지 크기 제한, 닉네임·팀 이름 제어문자 제거, 강퇴 토큰 무효화
- 비밀 값은 `ROOM_CODE_SECRET` 하나이며 `wrangler secret`에만 저장. 웹 코드에는 공개 가능한 주소만 있습니다.
- **한계**: 픽셀 데이터 자체를 위조하는 것(예: 개발자 도구로 목표색 픽셀을 직접 전송)은 막을 수 없습니다. 사진 원본을 서버에서 검사하지 않는 한 모든 브라우저 분석 방식의 공통 한계이며, 파티 게임 특성상 수용했습니다. 카메라가 없을 때 쓰는 "사진 찍기(파일)" 대체 경로도 갤러리 사진 선택이 가능합니다.

## 7. 색 판정

- 분석 영역(기본 중앙, 촬영 후 끌어서 이동·크기 조절) → 32×32 축소 → Lab 변환 → 반사 하이라이트·검은 노이즈 제외 → 중앙값 근처 픽셀 평균 = 대표색
- 색 차이 = **CIEDE2000**. 유채색 목표는 밝기 가중치를 낮춰(kL=1.5) 그림자·노출 차이에 덜 민감, 무채색(검정·회색·흰색)은 밝기가 곧 색이므로 kL=1
- 점수 구간(ΔE 이하): 5→100, 10→80, 20→60, 35→40, 50→20, 초과→0 (`shared/src/scoring.ts`에서 함수로 분리)
- **명세와 다르게 조정한 점**: CIEDE2000은 큰 차이를 압축해서 빨강↔파랑도 ΔE≈44(20점)가 나옵니다. 그대로면 "아무거나 빨리 찍고 시간 보너스 받기"가 유리해지므로 **시간 보너스는 색상 60점 이상일 때만** 줍니다. 호스트가 '엄격'을 고르면 하위 구간이 30/40으로 좁아져 반대색은 0점입니다.
- 화면에 "카메라 색은 근사치" 안내가 있고, 결과에 색 이름·HEX·ΔE를 함께 표시합니다(색약 배려).

## 8. 테스트 결과

| 명세 항목 | 결과 | 방법 |
|---|---|---|
| 1 방 생성·QR | ✅ | E2E (QR 이미지에 참가 URL 포함 확인) |
| 2 QR 스캔 참가 | ⚠️ 부분 | QR과 같은 URL로 입장은 E2E 확인. **실제 휴대폰 카메라로 QR 스캔은 미확인** |
| 3 여러 기기 동시 입장 | ✅ | 서버 테스트(5명), E2E(브라우저 5개) |
| 4 팀 자동·수동 배정 | ✅ | 서버 테스트 + E2E |
| 5 시작·라운드 동기화 | ✅ | 모든 클라이언트가 같은 목표색·같은 서버 마감 시각 |
| 6 카메라 허용·거부 | ✅ (가짜 카메라) | 거부 안내 + 파일 대체 경로 확인 |
| 7 촬영·색 분석 | ✅ (가짜 카메라) | 색 격자 영상 촬영 → 영역 이동 → 서버 재계산 ΔE 0.2, 100점 |
| 8 점수 경계값 | ✅ | 단위 테스트 |
| 9 중복 제출 | ✅ | 서버 테스트 |
| 10 시간 초과 제출 | ✅ | 서버 테스트 (마감 후 `too_late`) |
| 11 실시간 팀 점수 | ✅ | 서버 테스트 + E2E |
| 12 호스트 새로고침 | ✅ | 서버 테스트 + E2E |
| 13 플레이어 새로고침 | ✅ | 서버 테스트 + E2E, **서버 재시작 후에도 복구**(`tests/restart-check.mjs`) |
| 14 종료·최종 순위 | ✅ | 동점 규칙 단위 테스트 + E2E |
| 15 보안·권한 | ✅ | 비호스트 명령, 위조 토큰, 강퇴 토큰, 잘못된 코드, 폭주 제한 |
| 16 세로 화면 | ⚠️ 부분 | 390×844 모바일 에뮬레이션 스크린샷 확인. **실제 iOS Safari·Android Chrome 미확인** |
| 17 무료 사용량 | ✅ 실측 | 30명·10라운드 한 판 저장소 쓰기 96행 (5장) |

**아직 확인하지 못한 것 (실기기 필요)**
- 실제 휴대폰 후면 카메라, 다양한 조명에서의 점수 체감, iOS Safari 카메라 권한 재요청 동작
- 실제 배포 환경(Cloudflare + GitHub Pages)에서의 동작 — 로컬에서 같은 하위 경로(/color-hunter)로 빌드한 E2E는 통과
- 화이트밸런스 자동 보정은 넣지 않았습니다(목표색이 화면을 채우면 오히려 왜곡되기 때문). 판정 관대함으로 대신 조절합니다.
