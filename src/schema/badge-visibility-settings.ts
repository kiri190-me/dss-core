import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 배지 표시 설정 — 어느 배지를 어느 자리에서 끌지
 * ============================================================================
 * 화면에 뜨는 작은 알약 모양 표식(배지)을 **자리별로** 끌 수 있게 하는 축의 저장
 * 자리다. 무엇을 끌 수 있는지(배지 15종 · 자리 7곳 · 실제로 뜨는 33쌍)와 한글
 * 이름 · 설명 문구 · 판정은 전부 A/S 쪽
 * `src/lib/domain/badge-visibility.ts` 에 있다. 여기 있는 것은 **기본값과 다른
 * 것만** 담아 두는 그릇 하나다.
 *
 * 칸 구성은 이 저장소의 「설정 표」 표준을 그대로 따른다 — role_permissions ·
 * notification_kind_settings · ui_theme_tokens 와 같이
 * `id / 키 / 값 / updated_by / updated_at` 다섯 칸뿐이다. created_at 도,
 * 소프트삭제 칸(is_deleted·deleted_at·deleted_by)도 두지 않는다. 설정은 "언제
 * 처음 생겼는가"가 의미를 갖지 않고(기본값으로 되돌리는 것이 곧 행 삭제다),
 * 지운 설정을 휴지통에서 되살릴 일도 없다 — 되돌리는 방법은 다시 저장하는 것이다.
 *
 * ── 🔴 행이 없으면 **보임**이다 ─────────────────────────────────────────
 * 표가 비어 있으면 이 기능이 없던 때와 **완전히 같이** 동작한다. 끈 것만 행이
 * 생기고, 다시 켜는 것은 그 행을 지우거나 is_visible 을 true 로 돌리는 일이다.
 * 마이그레이션을 적용하기 **전에도** 마찬가지다 — 읽는 쪽
 * (src/lib/db/queries/badge-visibility-settings.ts)이 42P01(표 없음)을 삼키고
 * "설정 없음"으로 답한다. 그래서 이 축은 어느 지점에서 멈춰도 화면이 지금과
 * 똑같고, 되돌릴 일이 없는 배포가 된다.
 *
 * ── 🔴 행을 미리 심지 않는다 ────────────────────────────────────────────
 * role_permissions · notification_*_settings · ui_theme_tokens 와 같다.
 * **빈 표가 정상 초기 상태**다. 설치 시점에 33행(= 실제로 뜨는 쌍 전부)을
 * true 로 채워 넣으면, 나중에 배지가 하나 늘거나 뜨는 자리가 바뀔 때 아무도 만진
 * 적 없는 옛 행이 그대로 남아 "코드가 정한 자리"와 "DB 에 적힌 자리"가 조용히
 * 갈라진다. 등록부에서 사라진 (배지, 자리)의 남은 행은 판정(isBadgeVisible)이
 * 무시한다.
 *
 * ── 왜 열 하나가 아니라 (배지, 자리) 행인가 ─────────────────────────────
 * 같은 배지가 자리마다 사정이 다르다. 예를 들어 「DB」 배지는 목록에서는 줄마다
 * 되풀이돼 눈에 거슬리지만 상세 머리말에서는 자료의 출처를 알려 주는 유일한
 * 표시다 — 배지 하나를 통째로 끄는 스위치만 두면 그 둘을 나눠 정할 수 없다.
 * ui_theme_tokens 가 (토큰, 스코프)로, notification_role_settings 가
 * (종류, 역할)로 하는 일과 같은 모양이다.
 *
 * ── badge_key · place_key 에 왜 enum 을 쓰지 않았나 ─────────────────────
 * role_permissions.area_key · notification_*_settings.kind_key ·
 * ui_theme_tokens.token_key 와 같은 판단이다. Postgres enum 은 값을 지우기
 * 어렵고(ALTER TYPE ... ADD VALUE 는 되돌릴 수 없다) 배지나 자리가 하나 늘 때마다
 * 마이그레이션이 필요해진다 — 그러면 "코드 배열 한 줄로 늘린다"는 이 구조의 값이
 * 반감된다. 유효성은 서버가 등록부로 본다.
 *
 * ── 허용 쌍(33)을 CHECK 로 못 박지 않는 이유 ────────────────────────────
 * 어느 배지가 어느 자리에 뜨는가의 판정이 **등록부에 있고 등록부는 코드**이기
 * 때문이다. 제약으로 옮겨 적으면 두 벌이 되고, 배지를 한 자리 더 그리는 날 코드와
 * DB 가 조용히 어긋난다. 그렇게 들어온 어긋난 행은 판정이 무시한다
 * (허용되지 않는 쌍은 언제나 "보임"으로 답한다).
 * ============================================================================
 */
export const badgeVisibilitySettings = pgTable(
  "badge_visibility_settings",
  {
    /**
     * 대리 키. (badge_key, place_key) 복합 기본키를 쓰지 않는 이유는
     * ui_theme_tokens · role_permissions 와 같다 — audit_logs.target_record_id 가
     * NOT NULL uuid 라, 기록을 남기려면 행마다 uuid 하나가 있어야 한다. 유일성은
     * 아래 유니크 인덱스가 그대로 지킨다.
     */
    id: uuid("id").primaryKey().defaultRandom(),
    /** 등록부의 배지 키. 예: "repairStatus" · "priority" · "overdue" */
    badgeKey: text("badge_key").notNull(),
    /** 그 배지가 그려지는 자리. 예: "repairCaseList" · "repairCaseDetailHeader" */
    placeKey: text("place_key").notNull(),
    /** 이 자리에서 이 배지를 보일지. 행이 없으면 보인다 — false 를 적은 행만 숨긴다. */
    isVisible: boolean("is_visible").notNull(),
    /** 누가 마지막으로 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("badge_visibility_settings_badge_place_unique").on(table.badgeKey, table.placeKey),
  ]
);
