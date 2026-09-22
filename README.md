# @dss/core — 두 사이트가 함께 보는 DB 의 표 정의와 화면 조각

A/S 관리 시스템(`RF_Service_System`)과 PO/내자 시스템(`dss-po`)은 **같은
데이터베이스 `dss_as` 를 함께 본다.** 그렇게 정해진 까닭은 설계서
`PO_DOMESTIC_SPLIT_DESIGN.md` 의 B-2 · D절에 있다 — 내자 목록 화면 하나가
`repair_cases` · `products` · `customers` · `quotes` 를 한 질의에 LEFT JOIN 하고,
수리건을 지우면 `ON DELETE SET NULL` 이 연결을 자동으로 푼다. DB 를 나누면
그 두 가지가 모두 깨진다.

같은 표를 두 앱이 본다면 **표의 정의(Drizzle 스키마)는 한 벌이어야 한다.**
손으로 베낀 복제본은 컴파일러가 지켜 주지 않는다. 한쪽에서 칸 이름을 바꿔도
다른 쪽은 아무 말 없이 지나가고, 어긋남은 운영에서 드러난다.
그래서 스키마를 이 묶음 하나에 두고 두 사이트가 서브모듈로 가져간다.

---

## 1. 🔴 이 묶음이 **갖지 않는** 것

| 안 갖는 것 | 누가 갖나 | 왜 |
|---|---|---|
| **마이그레이션** (`drizzle/`) | **A/S 가 소유** | 두 앱이 각자 마이그레이션을 만들면 같은 DB 에 서로 모르는 변경이 쌓인다 |
| **`drizzle.config.ts`** | **A/S 가 소유** | 위와 같다. 새 사이트에는 `db:generate` · `db:migrate` 스크립트를 **두지 않는다** |
| **DB 연결 · 환경변수** | 각 사이트 | 이 묶음은 네트워크를 타지 않는다 |
| **질의(queries) · 서버 액션** | 각 사이트 | 화면이 여기 있어도 그렇다. 세션을 읽고 권한을 보고 트랜잭션을 여는 일은 사이트의 몫이고, 화면은 그 액션을 **프롭으로 받는다**(4절) |
| **화면 틀 · 사이드바 · 인증** | 각 사이트 | 사이트마다 다르다. 여기 있는 것은 **한 화면 안에서 끝나는 조각**뿐이다 |

설계서 E-2절 그대로다. **칸을 더하거나 고치는 일은 언제나 A/S 에서 한다.**
스키마 파일 자체는 여기서 고치지만, 그에 딸린 마이그레이션 SQL 을 굽는 것은
A/S 저장소에서 `npm run db:generate` 로 한다.

---

## 2. 들어 있는 것

```
src/
  index.ts        schema 를 재수출한다 (서버 쪽)
  schema/         Drizzle 표 정의 58파일
    index.ts      표 묶음 (사이트들은 이 묶음만 import 한다)
    users.ts  customers.ts  repair-cases.ts  quotes.ts  …
  ui/             두 사이트가 **한 벌로 그리는** 화면 조각 (2026-09-21 ~)
    common/       여러 화면이 함께 쓰는 조각
      responsive-list.tsx                   표/카드 전환 — 목록의 단 하나의 기준
      useTableFitsWithoutOverflow.ts        그 판정이 쓰는 폭 재기
      master-data-trash-dialogs.tsx         지우기·되살리기·완전 삭제 확인 창
      master-data-trash-retention.ts        15일 보관 판정
      master-data-trash-retention-badge.tsx 「만료까지 N일」 배지
    inventory/
      part-picker.tsx        품명 칸에서 부품 마스터를 찾아 고르는 조각 한 벌
      part-picker-rows.ts    그 조각이 받는 줄의 모양(타입) 둘
      part-price-field.ts    단가를 입력 칸의 글자로 (순수 함수)
    quotes/
      quote-list-rows.ts     목록 한 줄의 모양(타입) · 종류 이름표 · 금액 곁말
      QuoteListScreen.tsx    견적서 목록 화면 한 벌
```

🔴 **부품 고르개는 견적서 것이 아니다**(2026-09-22 옮겨 왔다). 견적서 편집 폼의
「부품 비용」 표와 수리 건 상세의 「사용 부품」 칸이 **같은 조각**을 쓴다. A/S 안에만
두면 PO/내자가 그 칸을 붙이는 날 사본이 생기므로 먼저 이쪽으로 옮겼다 — A/S 가
이 묶음의 `ui/` 를 쓰는 **첫 파일**이기도 하다(조각 4 가 열 그 길을 202줄로 먼저
열어 본 것이다). 컴포넌트 이름은 `QuotePartSuggestionList` → `PartSuggestionList`
로 고쳤다. 지금 부르는 쪽은 A/S 둘뿐이고, **PO 에는 아직 붙이지 않았다.**

🔴 **왜 화면이 여기 있나** — 견적서 목록은 **두 곳**이 그린다: PO/내자 사이트의
[견적서] 목록과, A/S 관리 시스템의 수리 건 상세 [견적서] 탭. 복사본을 두면
「금액·요약 줄이 갈라지는 날」이 오고, 그날 사람은 같은 견적서의 **다른 금액**을
두 화면에서 보게 된다(설계서 F절 5번).

⚠️ **지금은 두 벌이 잠깐 공존한다.** A/S 는 아직 제 파일
(`src/components/quotes/QuoteListScreen.tsx` 와 `src/components/common/` 의 같은
이름 파일들)을 쓴다. A/S 를 이쪽으로 돌리는 것은 **조각 4(A/S 정리)**의 일이다 —
한 번에 둘을 바꾸면 되돌릴 자리가 없어서, 새 사이트에서 먼저 돌려 보고 옮기기로
했다. 그때까지 저쪽 파일을 고치면 이쪽도 함께 고칠 것.

`drizzle-orm` · `react` · `next` 와 형제 파일(`./…`) 말고는 아무것도 import 하지
않는다. 🔴 **별칭(`@/…`)을 쓰지 않는다** — 가져다 쓰는 사이트마다 다르게 설정되어
있어, 여기서 쓰면 그쪽에서 깨진다. 그래서 사이트 밖에서도 혼자 컴파일된다 —
`npm run typecheck` 가 그것을 지킨다.

🔴 `src/ui/` 는 **브라우저 묶음에 실린다.** 여기서 `../schema/` 를 import 하면
표 정의와 drizzle 이 통째로 따라 실린다 — 값이 겹치더라도(견적서 종류 목록 등)
글자로 다시 적고, 갈라지지 않게 지키는 일은 가져다 쓰는 사이트의 시험이 한다.

**스키마 시험 5개는 A/S 에 남아 있다**(`legacy-import-state-set` ·
`legacy-report-number` · `manual-step-set` · `quote-approvals-safety` ·
`service-reports-parity`). A/S 의 시험 등록 검사가 최상위 `vendor/` 를
건너뛰므로, 여기로 옮기면 그 시험들이 A/S 회귀에서 안 돌게 된다.
안전망을 잃지 않으려고 일부러 두고 왔다.

같은 까닭으로 **여기 있는 화면 조각의 시험도 가져다 쓰는 사이트에 둔다.**
`responsive-list` 는 PO 가(`dss-po/src/components/common/responsive-list.test.ts`),
부품 고르개는 A/S 가(`src/components/inventory/part-picker.test.tsx`) 돌린다 —
그 사이트에서 **실제로 도는 그 코드**를 보게 된다.

---

## 3. 가져다 쓰는 길 — git 서브모듈

`vendor/dss-ui` 가 먼저 쓴 방식을 그대로 따른다. 그 방식이 뽑힌 까닭은
각 사이트의 Dockerfile 이 `COPY . .` 라 **저장소 폴더 안**에 있어야 이미지에
담기기 때문이다.

```bash
git submodule add <저장소 주소> vendor/dss-core
```

`tsconfig.json` 에 별칭:

```jsonc
"paths": {
  "@/*": ["./src/*"],
  "@dss/core": ["./vendor/dss-core/src/index.ts"],
  "@dss/core/schema": ["./vendor/dss-core/src/schema/index.ts"],
  // 화면 조각은 **깊은 경로**로 하나씩 들여온다. 배럴(`index.ts`) 한 줄로 묶지
  // 않는 까닭: 이 묶음에는 `"use client"` 파일과 순수 함수가 섞여 있고, 배럴을
  // 두면 서버 화면이 순수 함수 하나를 부르려다 화면 조각 전부를 딸려 오게 된다.
  // 시험 러너(node --test)에서도 같은 일이 생겨, 쓰지도 않는 `next/navigation`
  // 을 읽다 터진다.
  "@dss/core/ui/*": ["./vendor/dss-core/src/ui/*"]
}
```

`eslint.config.mjs` 의 `ignores` 에 한 줄:

```js
ignores: ["vendor/dss-core/**"],
```

서브모듈의 소스는 사이트의 Next 컴파일러가 제 앱 코드처럼 컴파일한다 —
`transpilePackages` 도 빌드 산출물도 필요 없다.

🔴 **`drizzle-orm` 버전은 두 사이트와 이 묶음이 같아야 한다.** 지금은
`^0.45.2`(`RF_Service_System/package.json` 에서 읽어 맞췄다). 어긋나면
타입이 미묘하게 달라져 붙는 자리에서만 깨진다. `react` · `react-dom` · `next`
도 같은 이유로 peerDependencies 에 적어 두었다 — 여기 devDependencies 에 든 것은
**이 묶음 혼자 타입 검사를 돌리기 위한 것**이고, 실제로 실리는 것은 사이트의 것이다.

---

## 4. 🔴 화면 조각이 사이트에서 갈리는 것 — **슬롯**으로 받는다

`QuoteListScreen` 은 원래 발행 · 첨부 표시 · 미리보기 · [새 견적서] 팝업을 직접
import 했다. 그대로 옮기면 그 사슬이 통째로 따라온다(실측 99파일 23,433줄 — 그 안에
엑셀 4,400줄과 첨부·발행·인쇄가 다 들어 있다). 그래서 **끌고 오는 대신 자리를 비워
두었다**:

| 프롭 | 무엇 | 언제 채워지나 |
|---|---|---|
| `trashActions` | 휴지통 세 서버 액션 | **필수** — 사이트가 준다 |
| `rowHref` | 줄을 눌러 여는 곳 | 편집 폼(3b) |
| `intakeHref` | 인수번호로 가는 곳 | A/S 의 수리 건 상세 |
| `newQuoteControl` | 머리의 [새 견적서] | 편집 폼(3b) |
| `renderFileBadges` | 줄의 파일 딱지 | 첨부(3d) |
| `renderRowActions` | 줄의 [미리보기]·[받기] | 발행·인쇄(3c·3f) |
| `notice` | 화면 위 한 자리의 알림 | 발행(3c) |

**넘기지 않으면 그 자리는 그려지지 않는다**(주소 둘은 링크 없이 글자만 남는다).
조각이 하나 도착할 때마다 부르는 쪽에 한 줄을 더하면 되고, **이 묶음은 그때
손대지 않는다.**

---

## 5. 검사

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

시험(`*.test.ts`)은 이 묶음에 없다 — 2절 참조.
`prettier` 는 이 저장소들이 쓰는 도구가 아니다. 돌리지 말 것.
