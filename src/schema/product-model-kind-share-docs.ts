import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productModelKindEnum } from "./product-models";
import { users } from "./users";

/**
 * ============================================================================
 * 제품 종류별 **사내 공유폴더 가리킴** — 파일을 받아 두지 않고 자리만 적는다
 * ============================================================================
 * 이 표의 한 줄은 「제너레이터의 공통 서류는 사내 공유폴더의 **저기** 있다」는
 * 가리킴 하나다. **파일 내용도, 파일 사본도 들어오지 않는다.** 실물은 사람이
 * 수년째 손으로 쓰는 공유폴더에 그대로 있고, 우리는 그 자리를 적어 둘 뿐이다.
 *
 *   \\192.168.0.222\2_as센터\1. 수리 관련\2. 인수시 서류\2. MB 인수시 체크시트
 *   └───────────── 루트(설정값) ─────────────┘└──── 이 표가 담는 것 ────┘
 *
 * 사용자 요구(2026-10-07): 「[제품 모델 관리]의 종류별 [공통서류]를 업로드 하는 곳에
 * 파일 경로를 입력해서 파일을 직접 열 수 있도록 … 이 때 지정되는 파일은 업로드 되는게
 * 아니라, 수리건 상세에서도 바로 파일을 열 수 있도록」 · 「파일 뿐 아니라 폴더도」.
 *
 * 🔴 **이 단계는 표를 만드는 데까지다.** 이 줄을 채우는 화면 · 읽는 통로 · 여는 단추는
 * 다음 조각이다. 지금 이 표를 읽거나 쓰는 코드는 저장소에 한 줄도 없다.
 *
 * ── 🔴 왜 attachments 에 얹지 않았나 ─────────────────────────────────────
 * attachments 는 **받아 둔 바이트**의 표다. 그 머리말 65–75 줄이 stored_path 의 뜻을
 * 「저장 루트(UPLOADS_DIR) 기준 상대 경로」로 못 박아 두었고, 그 약속 위에 내려받기
 * 라우트 · 백업 스크립트(scripts/backup-attachments.ts) · SHA-256 대조가 얹혀 있다.
 * 공유폴더 경로를 그 칸에 넣으면 그 셋이 전부 **없는 파일을 가리키며 거짓을 말한다.**
 * 게다가 stored_path · mime_type · file_size · checksum_sha256 **넷이 NOT NULL** 인데,
 * 바이트를 받지 않는 가리킴은 그 넷 중 어느 것도 참값으로 채울 수 없다 — 「0 바이트 ·
 * application/octet-stream · 빈 해시」를 넣는 순간 그 표의 모든 집계가 오염된다.
 * 「받은 파일인가 · 가리킴인가」를 가르는 칸도 없다.
 *
 * 그래서 표를 따로 만든다. **대가는 알고 치른다**: attachments 에 얹었다면 공짜로
 * 따라왔을 백업 · 휴지통 · 감사 · 중복 판단을 이 표는 **제 몫으로 따로 본다**(백업은
 * 애초에 할 것이 없다 — 바이트가 없다. 휴지통은 아래 참조. 감사는 audit_logs 다).
 *
 * ── 루트는 여기 담지 않는다 ─────────────────────────────────────────────
 * attachments.stored_path 와 **똑같은 까닭**이다(그 파일 머리말 65–75): 루트를 행마다
 * 적으면 서류함을 옮기는 날 이 표의 모든 행을 UPDATE 해야 한다. 루트는 설정값 하나로
 * 두고, 행에는 그 아래의 자리만 적는다. 그 루트를 정하는 것은 **같은 날의 다른
 * 조각**이다 — A/S 쪽 storage/repair-docs-archive.ts 의 `REPAIR_DOCS_ARCHIVE_DIR`
 * (서버가 읽는 경로)과 `REPAIR_DOCS_ARCHIVE_UNC_ROOT`(사람 PC 의 탐색기가 보는 주소)
 * 쌍이고, 견적서 · 연락서 서류함이 이미 쓰는 모양 그대로다(QUOTE_ARCHIVE_DIR ·
 * CONTACT_FOLDER_ARCHIVE_DIR …). 🔴 저쪽 이름이 바뀌면 이 주석도 함께 고친다.
 *
 * 🔴 **마디 구분은 `/` 하나뿐이고, 역슬래시는 CHECK 가 막는다.** 이 저장소가 이미
 * 그렇게 쓴다 — .env.example 의 CUSTOMER_PORTAL_ARCHIVE_SUBPATH 설명이 「도우미의 루트를
 * 기준으로 한 상대 경로를 구분자 `/` 로 적습니다」이다. 윈도우도 `/` 를 받아들이고,
 * 운영(NAS·컨테이너)은 리눅스라 `/` 가 유일한 구분자다.
 *
 * ── 🔴 주인이 행이 아니라 분류다 ────────────────────────────────────────
 * product_model_kind 에는 FK 가 없다. attachments.product_model_kind(2026-10-06)와 같은
 * 모양이고 같은 까닭이다 — 가리키는 것이 다른 표의 행이 아니라 enum 값이라 사라질
 * 주인 행이 애초에 없다. enum 도 **새로 만들지 않고** product-models.ts 의
 * productModelKindEnum 을 그대로 가져다 쓴다(이 저장소의 관례 — quotes ·
 * repair_task_catalog · repair_labor_settings · power_test_tasks · attachments 가 이미
 * 같은 enum 을 재사용한다). 종류가 늘어나는 날 한 곳만 고치면 전부 따라온다.
 *
 * ── 🔴 휴지통(소프트 삭제 4칸)을 두지 않는다 ────────────────────────────
 * DATABASE_DESIGN.md #8 의 기본은 소프트 삭제이고, 여기서는 **일부러 예외로 둔다.**
 * 예외를 두는 것 자체는 이 저장소에 이미 있는 길이다 — audit_logs · idempotency_keys ·
 * workflow_versions · notification_acknowledgements 가 각자의 까닭을 적고 비켜 섰다.
 * 이 표의 까닭은 넷이다:
 *   1. **지워도 없어지는 것이 없다.** 이 줄은 업무 사실이 아니라 **가리킴**이다. 줄을
 *      지워도 공유폴더의 실물은 한 바이트도 움직이지 않는다(이 표를 쓰는 코드에는
 *      파일을 지우는 길이 영영 없다 — storage/share-folder-fs.ts 쪽 관례와 같다).
 *      되돌리는 일은 「파일을 되찾는 일」이 아니라 **경로 한 줄을 다시 적는 일**이다.
 *      attachments 가 휴지통을 두는 까닭(「복원이 파일을 되찾는 일이 아니라 플래그를
 *      되돌리는 일이어야 한다」)이 여기서는 성립하지 않는다.
 *   2. **잘못 지운 것을 되찾을 자료는 이미 남는다.** 감사 로그는 target_entity 가 그냥
 *      text 라 새 표를 적는 데 마이그레이션이 필요 없고, previous_value(jsonb)에 지워진
 *      줄이 통째로 들어간다. 보관은 3년이다(SECURITY_POLICY.md). 🔴 **그러므로 다음
 *      조각은 이 표의 삭제를 감사 로그에 반드시 남겨야 한다** — 그것이 유일한 흔적이다.
 *   3. **휴지통을 두면 유니크가 부분 인덱스가 되고, 되살리기가 충돌한다.** 지워 둔 줄과
 *      같은 경로를 새로 등록한 뒤 지운 줄을 되살리면 같은 종류에 같은 경로가 둘이 된다.
 *      그 모순을 막는 규칙을 화면이 또 져야 한다 — 다시 적으면 되는 한 줄을 지키려고.
 *   4. 되돌리기 비용이 작다(경로 한 줄). 15일 보관 배지 · 완전삭제 · 되살리기 세 통로를
 *      그 값에 맞춰 만드는 것은 득보다 품이 크다.
 * 🔴 **뒤집기 쉽다.** 나중에 휴지통이 필요해지면 4칸을 더하고 아래 유니크 인덱스에
 * `WHERE is_deleted = false` 를 붙이는 마이그레이션 하나다(제약을 **푸는** 쪽이라
 * 기존 자료가 걸리지 않는다). 지금 두지 않는다고 길이 막히지는 않는다.
 *
 * ── 🔴 경로는 DB 가 한 번 더 본다 (울타리의 마지막 한 겹) ───────────────
 * 이 칸의 값은 언젠가 **루트에 이어 붙여 OS 에 넘어간다.** 경로를 거슬러 오르는 값
 * (`..`)이나 절대 경로(`C:/…` · `\\서버\…`)가 들어오면 서류함 밖이 열린다. 진짜 울타리는
 * 앱 쪽(storage/share-folder-fs.ts 의 assertInsideShareFolderRoot)이고, 아래 CHECK 는
 * **마지막 한 겹**이다 — 통로가 늘어나도 표에 들어온 값만은 모양이 지켜진다.
 * 금지 글자는 이 저장소가 이미 쓰는 표를 그대로 따른다(domain/share-folder-naming.ts 의
 * FORBIDDEN_IN_NAME: `\ / : * ? " < > |` 와 제어문자) — 거기서 `/` 만 빼면 된다.
 * 마디 구분자이기 때문이다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * 공유폴더의 폴더 이름에는 고객사명이 섞여 있다(`3. 업체별 수리품현황` 아래가 그렇다).
 * relative_path 와 label 은 그래서 고객 정보가 될 수 있다 — 로그나 오류 문구로 그대로
 * 내보내지 않는다(연락서 · 견적서 저장 모듈이 「사유에 경로를 담지 않는다」로 지키는 것과
 * 같은 규칙이다).
 * ============================================================================
 */

/**
 * 가리키는 것이 **파일 하나인가, 폴더 하나인가.**
 *
 * 🔴 **이번에 새로 만드는 유일한 enum 이다**(product_model_kind 는 있는 것을 쓴다).
 * 값이 둘뿐이라 boolean(`is_folder`)으로도 적을 수 있었지만 쓰지 않았다 — 「참이면
 * 폴더」는 읽는 자리마다 다시 해석해야 하고, 셋째 종류(바로가기 · 웹주소 같은 것)가
 * 생기는 날 칸을 통째로 바꿔야 한다. 이 저장소는 상태·유형을 대문자 코드로 적는다
 * (DATABASE_DESIGN.md #6).
 *
 * 이름에 `product_model_kind` 를 붙이지 않은 까닭: 이 두 값은 제품 종류와 아무 관계가
 * 없다. 나중에 다른 주인(고객사별 · 모델별)이 같은 가리킴을 갖게 되면 두 값짜리 타입을
 * 또 만들지 않고 이것을 그대로 쓴다 — productModelKindEnum 을 다섯 표가 함께 쓰는 것과
 * 같은 결이다.
 */
export const shareDocEntryKindEnum = pgEnum("share_doc_entry_kind", ["FILE", "FOLDER"]);

export const productModelKindShareDocs = pgTable(
  "product_model_kind_share_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 어느 종류의 공통 서류인가. **NOT NULL** — 주인 없는 가리킴은 뜻이 없다
     * (attachments 쪽 같은 이름의 칸이 NULL 을 허용하는 것과 여기가 다르다. 저쪽은
     * 주인이 넷 중 하나라 비어 있는 것이 정상이고, 이 표는 주인이 이것 하나뿐이다).
     * FK 가 없는 까닭은 머리말 참조.
     */
    productModelKind: productModelKindEnum("product_model_kind").notNull(),
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
     * 종류 안에서 유니크로 묶지 않는다 — 묶으면 두 줄의 차례를 맞바꾸는 일이 임시값을
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
     * 🔴 **같은 종류에 같은 자리를 두 번 담지 않는다.**
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
     * 앞 칸이 product_model_kind 라, 「한 종류의 줄」을 찾는 조회도 이 인덱스로 닿는다.
     */
    uniqueIndex("product_model_kind_share_docs_kind_path_unique").on(
      table.productModelKind,
      sql`lower(regexp_replace(btrim(normalize(${table.relativePath}, NFC)), '\\s+', ' ', 'g'))`
    ),
    /**
     * 이 표의 조회는 사실상 하나다 — 「이 종류의 줄을 차례대로」(제품 모델 관리의 공통
     * 서류 칸과, 수리 건 상세에서 그 건의 종류로 여는 칸). 그 ORDER BY 를 그대로 적은
     * 인덱스다. 줄 수가 종류당 몇 줄이라 성능 때문이 아니라 **읽는 순서를 표에 적어
     * 두려고** 둔다 — 위 유니크와 앞 칸이 같지만, 접은 경로 뒤에 차례가 오는 그 인덱스로는
     * 정렬을 받을 수 없다.
     */
    index("product_model_kind_share_docs_kind_order_idx").on(
      table.productModelKind,
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
      "product_model_kind_share_docs_relative_path_shape",
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
      "product_model_kind_share_docs_label_not_blank",
      sql`${table.label} IS NULL OR char_length(btrim(${table.label})) BETWEEN 1 AND 200`
    ),
  ]
);
