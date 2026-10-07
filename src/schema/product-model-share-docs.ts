import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shareDocEntryKindEnum } from "./product-model-kind-share-docs";
import { productModels } from "./product-models";
import { users } from "./users";

/**
 * ============================================================================
 * 제품 **모델별** 사내 공유폴더 가리킴 — 파일을 받아 두지 않고 자리만 적는다
 * ============================================================================
 * 이 표의 한 줄은 「이 모델(예: MBK200-JS2)의 서류는 사내 공유폴더의 **저기** 있다」는
 * 가리킴 하나다. 종류별 표(product_model_kind_share_docs, 2026-10-07)와 담는 것이
 * 똑같고 **주인만 다르다** — 저쪽 주인은 분류(enum: 제너레이터 · 매쳐 …) 하나이고,
 * 이쪽 주인은 product_models 의 **행** 하나다.
 *
 * 사용자 요구(2026-10-07): 종류별로 가리켜 두는 것을 쓰고 나서, 「제품 모델 하나하나도
 * 같은 것을 갖게 해 달라」. 둘은 함께 쓴다 — 한 수리 건을 열면 그 제품의 **종류** 공통
 * 서류와 그 **모델** 서류가 나란히 보이는 그림이다.
 *
 * 🔴 **머리말의 나머지 까닭은 종류별 표와 글자 그대로 같다.**
 * `product-model-kind-share-docs.ts` 의 머리말을 읽어라 — 왜 attachments 에 얹지
 * 않았는지, 왜 루트를 행마다 담지 않는지, 왜 마디 구분이 `/` 하나뿐이고 역슬래시를
 * CHECK 가 막는지, 왜 휴지통(소프트 삭제 4칸)을 두지 않는지, 왜 DB 가 경로를 한 번 더
 * 보는지, 왜 relative_path 와 label 이 PII 인지. 여기서 되풀이하지 않는 것은 **두 벌이
 * 서로 어긋나는 것이 가장 나쁘기 때문**이다. 🔴 저쪽이 바뀌는 날 이 표도 함께 본다.
 *
 * ── 🔴 왜 종류별 표에 칸을 더하지 않고 표를 새로 만드나 ─────────────────
 * 한 표에 두 주인을 담으면 두 칸 모두 NULL 을 허용해야 하고(종류 줄은 모델이 비고, 모델
 * 줄은 종류가 빈다), 그러면 그 표의 핵심 약속인 「주인 없는 가리킴은 뜻이 없다」를
 * CHECK 로 다시 세워야 한다. 유니크의 범위도 주인마다 달라져 부분 인덱스 둘로 갈린다.
 * 읽는 쪽도 매번 「어느 주인의 줄인가」를 걸러야 한다. 주인이 하나뿐인 표 둘이
 * 그 전부보다 싸다 — 종류별 표의 `product_model_kind` 칸 주석이 「이 표는 주인이 이것
 * 하나뿐이다」로 못 박아 둔 것을 지키는 길이기도 하다.
 *
 * ── enum 은 새로 만들지 않는다 ──────────────────────────────────────────
 * `entry_kind` 는 종류별 표가 만든 `shareDocEntryKindEnum`(FILE · FOLDER)을 **그대로
 * 가져다 쓴다.** 앞사람이 그 enum 주석(L118-124)에 「나중에 다른 주인(고객사별 ·
 * 모델별)이 같은 가리킴을 갖게 되면 두 값짜리 타입을 또 만들지 않고 이것을 그대로
 * 쓴다」고 예고해 두었고, 이 표가 그 「모델별」이다.
 *
 * ── 🔴 이번 조각은 표까지다 ─────────────────────────────────────────────
 * 이 줄을 채우는 화면 · 읽는 통로 · 여는 단추는 다음 조각이다. 지금 이 표를 읽거나
 * 쓰는 코드는 저장소에 한 줄도 없다.
 * ============================================================================
 */

export const productModelShareDocs = pgTable(
  "product_model_share_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 어느 **모델**의 서류인가. **NOT NULL** — 주인 없는 가리킴은 뜻이 없다(종류별 표의
     * `product_model_kind` 칸 주석과 같은 까닭이다. 이 표도 주인이 이것 하나뿐이다).
     *
     * 🔴 **FK 가 있고, ON DELETE CASCADE 다** — 종류별 표와 여기가 갈린다. 저쪽 주인은
     * enum 값이라 사라질 주인 행이 애초에 없었고, 이쪽 주인은 **진짜로 지워지는 행**이다:
     *   · `src/lib/db/mutations/master-data-purge.ts` 의 `purgeExpiredProductModel` 이
     *     보관기간이 지난 모델을 `tx.delete(productModels)` 로 **영구 삭제**한다.
     *   · `scripts/run-nightly-purge.ps1` 이 **매일 밤** `purge:master-data` 를 부른다.
     * 그러므로 `restrict` 로 두면 가리킴 한 줄이 남아 있다는 이유로 그 **자동 삭제가
     * 조용히 실패**한다(사람이 보는 화면 없이 밤에 도는 일이라 아무도 모른다).
     * `set null` 도 아니다 — 주인 없는 가리킴은 뜻이 없고, 이 칸은 NOT NULL 이다.
     * 가리킴은 업무 사실이 아니라 **경로 한 줄**이므로(머리말), 주인이 사라지면 함께
     * 사라지는 것이 맞다. 공유폴더의 실물은 한 바이트도 움직이지 않는다.
     *
     * 🔴 **다음 조각의 숙제 — 지워지는 것을 감사 로그에 남겨라.** `cascade` 라서 지금은
     * 모델이 사라질 때 이 줄들이 **감사 기록 없이** 사라진다. 휴지통을 두지 않는 이 표에서
     * 감사 로그는 「잘못 지운 것을 되찾을 유일한 자료」다(종류별 표 머리말의 까닭 2).
     * `purgeExpiredProductModel` 이 모델을 지우기 전에 이 표의 줄을 세어 읽고
     * `insertAuditLog` 로 적도록 보강해야 한다 — 그 함수가 딸린 장비(`products`)를
     * 다루는 방식과 **같게**. 이번 조각에서는 하지 않는다(표가 아직 DB 에 없어 시험을
     * 돌릴 수 없다). 마이그레이션을 적용한 다음 조각의 일이다.
     */
    productModelId: uuid("product_model_id")
      .notNull()
      .references(() => productModels.id, { onDelete: "cascade" }),
    /**
     * 파일인가 폴더인가. 기본값을 두지 않는다 — 어느 쪽인지는 등록하는 사람이 아는
     * 사실이고, 기본값을 두면 「모르면 파일」이 되어 폴더가 파일로 열리려 한다.
     *
     * 여는 쪽의 동작이 갈리므로 꼭 필요하다(파일은 그 프로그램으로 열고, 폴더는
     * 탐색기로 연다). 실물이 사라지거나 파일↔폴더가 바뀌었는지는 DB 가 알 수 없다 —
     * 여는 순간 통로가 보고 알린다. 이 칸은 **등록할 때의 사람의 말**이다.
     */
    entryKind: shareDocEntryKindEnum("entry_kind").notNull(),
    /**
     * 공유폴더 루트 기준 **상대 경로**(예: `2. 인수시 서류/2. MB 인수시 체크시트`).
     * 절대 경로 금지 · 마디 구분은 `/` · 앞뒤 슬래시 없음 — 머리말과 아래 CHECK 참조.
     *
     * 🔴 **들어온 글자 그대로 담는다**(다듬어 담지 않는다). 공유폴더의 실제 이름에는
     * 공백이 두 칸인 폴더도 있고, 그 이름으로 이어야 열린다 — 다듬은 이름으로 이으면
     * 없는 폴더가 된다. 이 저장소의 규칙 그대로다(domain/share-folder-naming.ts 머리말:
     * 「비교할 때만 다듬고, 경로를 이을 때는 디스크의 실제 이름을 쓴다」).
     * 다듬기는 **견줄 때만** 하고, 그 자리가 아래 유니크 인덱스다.
     */
    relativePath: text("relative_path").notNull(),
    /**
     * 사람이 붙인 이름. **비면(NULL) 화면이 경로의 마지막 마디를 쓴다** — 그래서
     * 빈 문자열은 들어오면 안 된다(NULL 과 `""` 가 같은 뜻인 칸은 읽는 자리마다
     * 다르게 해석된다). 아래 CHECK 가 그것을 막는다.
     */
    label: text("label"),
    /**
     * 화면 차례. NULL 이면 「정해 두지 않음」이고, 조회는 `ORDER BY display_order,
     * created_at` 으로 읽는다 — PostgreSQL 의 ASC 는 NULL 을 뒤로 보내므로(NULLS LAST)
     * 차례를 정한 줄이 먼저 오고 나머지가 등록 순으로 따라온다. 아래 인덱스가 그 순서
     * 그대로다.
     *
     * 모델 안에서 유니크로 묶지 않는다 — 묶으면 두 줄의 차례를 맞바꾸는 일이 임시값을
     * 거쳐야 하는 일이 된다(oh_part_template_items 가 그 유니크를 가진 표다). 같은 값이
     * 겹치면 created_at 이 가른다.
     */
    displayOrder: integer("display_order"),
    /**
     * 적어 둔 사람. RESTRICT — 이 저장소가 users 를 가리키는 기본 방식이고
     * (attachments.uploaded_by 와 같다), 사람이 비활성화되거나 퇴사해도 가리킴은
     * 계속 열린다. users 행을 실제로 지우는 일 자체를 막는다.
     */
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * 🔴 **같은 모델에 같은 자리를 두 번 담지 않는다.**
     *
     * 경로를 **어떻게 접어서 견주는가**(이 식의 뜻):
     *   · `normalize(…, NFC)` — 한글을 모아쓴 모양으로 맞춘다. 공유폴더는 NAS(리눅스)에
     *     있어 풀어쓴(NFD) 이름이 섞여 들어올 수 있다. 접지 않으면 눈에 똑같은 두 줄이
     *     나란히 선다. 이 저장소가 이미 쓰는 접기다(domain/share-folder-naming.ts 의
     *     normalizeShareFolderNameForCompare). 🔴 **담을 때가 아니라 견줄 때만** 접는
     *     것도 그 모듈의 규칙 그대로다 — 실측으로 이 서버(PostgreSQL 17)의 normalize 는
     *     immutable 이라 인덱스 식에 쓸 수 있다.
     *   · `btrim` + `regexp_replace('\s+', ' ')` — 앞뒤 공백과 연속 공백을 접는다.
     *   · `lower` — **대소문자를 접는다.** 사람이 탐색기(윈도우 SMB)로 쓰는 서류함이라
     *     `2. MB` 와 `2. mb` 는 같은 폴더다. 리눅스 파일시스템 자체는 둘을 가르지만, 그
     *     둘이 **동시에 존재하는 서류함**은 사람이 쓸 수 없는 서류함이다. 접지 않으면
     *     오타 하나가 「없는 폴더를 가리키는 둘째 줄」이 되어 조용히 남는다.
     *
     * 접는 식은 customers_normalized_name_unique · product_models_normalized_name_unique
     * 과 **같은 식**이다(앞에 normalize 한 겹만 더 있다). 한 벌로 맞춰 두면 나중에
     * 「우리가 이름을 어떻게 견주는가」를 한 곳에서 읽을 수 있다.
     *
     * 끝 슬래시는 여기서 접지 않는다 — **애초에 들어올 수 없다**(아래 모양 CHECK 가
     * 앞뒤 슬래시를 막는다). 접기와 막기 중 하나만 고르면 읽는 사람이 둘을 다 의심하지
     * 않아도 된다.
     *
     * 앞 칸이 product_model_id 라, 「한 모델의 줄」을 찾는 조회도 이 인덱스로 닿는다.
     */
    uniqueIndex("product_model_share_docs_model_path_unique").on(
      table.productModelId,
      sql`lower(regexp_replace(btrim(normalize(${table.relativePath}, NFC)), '\\s+', ' ', 'g'))`
    ),
    /**
     * 이 표의 조회는 사실상 하나다 — 「이 모델의 줄을 차례대로」(제품 모델 관리의 그 모델
     * 칸과, 수리 건 상세에서 그 건의 모델로 여는 칸). 그 ORDER BY 를 그대로 적은
     * 인덱스다. 줄 수가 모델당 몇 줄이라 성능 때문이 아니라 **읽는 순서를 표에 적어
     * 두려고** 둔다 — 위 유니크와 앞 칸이 같지만, 접은 경로 뒤에 차례가 오는 그 인덱스로는
     * 정렬을 받을 수 없다.
     */
    index("product_model_share_docs_model_order_idx").on(
      table.productModelId,
      table.displayOrder,
      table.createdAt
    ),
    /**
     * 🔴 경로의 **모양**. 머리말의 「울타리의 마지막 한 겹」이다. 여섯 줄이 각각
     * 막는 것:
     *   · 길이 1..400 — 빈 값과 터무니없는 값. (실제 한도는 OS 가 정한다 — 윈도우
     *     탐색기의 260 자는 루트까지 합한 길이라 DB 가 대신 셀 수 없다.)
     *   · `= btrim(…)` — 앞뒤 공백. 눈에 안 보이는 차이로 두 줄이 생기는 것을 막는다.
     *   · `strpos(…, chr(92)) = 0` — **역슬래시 금지.** 윈도우 경로(`2. MB\체크시트`)나
     *     UNC(`\\192.168.0.222\…`)를 그대로 붙여 넣은 값이 여기서 걸린다. 글자를
     *     `chr(92)` 로 적은 것은 일부러다 — 역슬래시는 TS → SQL 로 가는 동안 겹수가
     *     조용히 바뀐다.
     *   · `!~ '[|<>"?*:]'` — 윈도우가 이름에 허용하지 않는 글자(머리말의 FORBIDDEN_IN_NAME
     *     에서 `/` 와 역슬래시만 뺀 것). `:` 가 걸리므로 `C:/…` 같은 절대 경로도 여기서
     *     막힌다.
     *   · `!~ '[[:cntrl:]]'` — 제어문자(줄바꿈 · 탭 · 방향 뒤집기).
     *   · `!~ '(^/)|(/$)|(//)'` — 앞뒤 슬래시와 빈 마디.
     *   · `!~ '(^|/)[.]{1,2}(/|$)'` — `.` · `..` 마디. **경로를 거슬러 오르는 값이
     *     표에 들어오지 않는다.** 점으로 시작하는 이름(`.hidden`)은 그대로 통과한다.
     */
    check(
      "product_model_share_docs_relative_path_shape",
      sql`char_length(${table.relativePath}) BETWEEN 1 AND 400
        AND ${table.relativePath} = btrim(${table.relativePath})
        AND strpos(${table.relativePath}, chr(92)) = 0
        AND ${table.relativePath} !~ '[|<>"?*:]'
        AND ${table.relativePath} !~ '[[:cntrl:]]'
        AND ${table.relativePath} !~ '(^/)|(/$)|(//)'
        AND ${table.relativePath} !~ '(^|/)[.]{1,2}(/|$)'`
    ),
    /**
     * 이름을 적었다면 **빈 이름이 아니어야 한다**(공백만 적은 것도 빈 이름이다).
     * 비우고 싶으면 NULL 이다 — 그때 화면이 경로의 마지막 마디를 쓴다(label 칸 주석).
     */
    check(
      "product_model_share_docs_label_not_blank",
      sql`${table.label} IS NULL OR char_length(btrim(${table.label})) BETWEEN 1 AND 200`
    ),
  ]
);
