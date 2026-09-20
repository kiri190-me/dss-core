# @dss/core — 두 사이트가 함께 보는 DB 의 표 정의

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
| **질의(queries) · 서버 액션** | 각 사이트 | 지금은 그렇다. 나중에 두 사이트가 같은 읽기 질의를 쓰게 되면 그때 따로 의논한다 |

설계서 E-2절 그대로다. **칸을 더하거나 고치는 일은 언제나 A/S 에서 한다.**
스키마 파일 자체는 여기서 고치지만, 그에 딸린 마이그레이션 SQL 을 굽는 것은
A/S 저장소에서 `npm run db:generate` 로 한다.

---

## 2. 들어 있는 것

```
src/
  index.ts        schema 를 재수출한다
  schema/         Drizzle 표 정의 58파일
    index.ts      표 묶음 (사이트들은 이 묶음만 import 한다)
    users.ts  customers.ts  repair-cases.ts  quotes.ts  …
```

`drizzle-orm` 과 형제 파일(`./…`) 말고는 아무것도 import 하지 않는다.
그래서 A/S 밖에서도 혼자 컴파일된다 — `npm run typecheck` 가 그것을 지킨다.

**스키마 시험 5개는 A/S 에 남아 있다**(`legacy-import-state-set` ·
`legacy-report-number` · `manual-step-set` · `quote-approvals-safety` ·
`service-reports-parity`). A/S 의 시험 등록 검사가 최상위 `vendor/` 를
건너뛰므로, 여기로 옮기면 그 시험들이 A/S 회귀에서 안 돌게 된다.
안전망을 잃지 않으려고 일부러 두고 왔다.

---

## 3. 가져다 쓰는 길 — git 서브모듈

`vendor/dss-ui` 가 먼저 쓴 방식을 그대로 따른다. 그 방식이 뽑힌 까닭은
각 사이트의 Dockerfile 이 `COPY . .` 라 **저장소 폴더 안**에 있어야 이미지에
담기기 때문이다.

```bash
git submodule add <저장소 주소> vendor/dss-core
```

`tsconfig.json` 에 별칭 두 줄:

```jsonc
"paths": {
  "@/*": ["./src/*"],
  "@dss/core": ["./vendor/dss-core/src/index.ts"],
  "@dss/core/schema": ["./vendor/dss-core/src/schema/index.ts"]
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
타입이 미묘하게 달라져 붙는 자리에서만 깨진다.

---

## 4. 검사

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

시험(`*.test.ts`)은 이 묶음에 없다 — 2절 참조.
`prettier` 는 이 저장소들이 쓰는 도구가 아니다. 돌리지 말 것.
