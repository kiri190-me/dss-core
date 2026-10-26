import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 결재선 **단계**를 대신 눌러 줄 사람 — 기간 기반 위임
 * ============================================================================
 * 승인 절차(`shipment_approval_routes` · `shipment_approval_route_steps`)를 쓰기
 * 시작하면 「누가 결재하는가」는 단계에 **박힌 사람 한 명**이 된다. 그 사람이 출장·
 * 휴가로 자리를 비우면 그 건은 **선다** — 지금 이 저장소에는 그 멈춤을 풀 길이
 * 하나도 없다. 이 표가 그 길이다.
 *
 * ── 🔴 `shipment_approval_delegations` 와 **다른 표**다. 헷갈리지 말 것 ────
 * 이름이 비슷하고 칸 모양까지 닮았지만, 둘은 **서로 다른 때에 쓰이고 지금은 한
 * 번도 함께 쓰이지 않는다.**
 *
 *   · `shipment_approval_delegations`(옛것)
 *     「출하 **대표**(users.is_shipment_representative)」의 권한을 통째로 맡긴다.
 *     🔴 **결재선을 안 짜 뒀을 때만 쓰인다.** 절차를 한 판이라도 저장하면
 *     `decideRepairCaseApproval` 이 `followsRoute` 분기로 빠지면서 **대표 판정도
 *     위임 판정도 아예 하지 않는다**(mutations/repair-case-approvals.ts 의 「결재선
 *     경로 — 대표·위임 판정을 하지 않는다」 주석). 그래서 그 표에 아무리 줄을
 *     넣어도 결재선을 쓰는 건은 꿈쩍도 하지 않는다.
 *
 *   · `approval_route_delegations`(이 표)
 *     **결재선의 한 단계**를 대신 누르게 한다. 「대표」라는 개념이 여기엔 없다 —
 *     단계에 적힌 사람(`shipment_approval_route_steps.approver_user_id`)이면 누구나
 *     맡기는 쪽이 될 수 있고, 맡는 쪽도 대표일 필요가 없다.
 *
 * 🔴 **옛 표를 이 표로 옮기지 않는다**(2026-10-26 사용자 결정). 둘은 쓰이는 조건이
 * 갈려 있어 한쪽을 지우면 다른 쪽 기능이 사라진다. 고칠 일이 생기면 **어느 쪽
 * 이야기인지 먼저 가린 뒤에** 손대라 — 이 주석을 적어 두는 까닭이 그것이다.
 *
 * ── 🔴 결재선은 한 글자도 건드리지 않는다 ───────────────────────────────
 * 위임은 `shipment_approval_route_steps` 를 고쳐 대리인을 끼워 넣는 방식이 **아니다.**
 * 그러면 「원래 누가 결재하게 돼 있었나」가 사라지고 휴가가 끝났을 때 되돌릴 근거도
 * 없어진다. 결재선은 그대로 두고 **누를 수 있는 사람만 늘린다** — 판정은 순수
 * 함수가 한다(src/lib/domain/approval-route-delegation.ts).
 *
 * ── 🔴 열쇠는 `users.id`(uuid) 다. 포털 번호가 아니다 ────────────────────
 * A/S 는 사람 표(`users`)의 **주인**이라 진짜 외래키를 걸 수 있고, 결재선 단계가
 * 가리키는 것도 `users.id` 다. 재고관리(dss-inventory)의 같은 기능은 남의 시스템
 * 사람을 가리켜야 해서 FK 없이 포털 번호(`sub`)를 쓰는데, **그 방식을 여기 베껴
 * 오지 마라** — 이 저장소에서는 조인 한 번이면 끝나는 것을 번호 맞추기로 바꾸는
 * 일이고, 두 열쇠를 섞으면 「코드는 맞고 값만 안 맞아」 조용히 0건이 된다.
 *
 * ── 겹치는 기간을 DB 로 막지 않는다 ─────────────────────────────────────
 * 같은 사람에게 기간이 겹치는 위임이 여럿 있어도 **정상이다.** 두 사람이 동시에
 * 자리를 비울 수도 있고, 한 사람에게 기간을 나눠 두 번 맡길 수도 있다. 겹침을
 * EXCLUDE 제약으로 막으려면 btree_gist 확장이 필요한데, 이 규모에서 얻을 것이 없다
 * (옛 표가 advisory lock 으로 처리한 것과 같은 판단). 대신 **판정 함수가 중복을
 * 걸러 낸다** — 겹친 줄이 둘이어도 결재권자 번호는 한 번만 돌아온다.
 *
 * ── 🔴 「자기 자신을 대리인으로」는 막지 않는다 ──────────────────────────
 * 관리자가 자기를 남의 대리인으로 세우는 것을 표 제약으로도 코드로도 막지 않는다
 * (2026-10-26 사용자 결정). 막을 자리는 `created_by_user_id` 가 남기는 **기록**이지
 * 제약이 아니다 — 누가 세웠는지가 줄마다 남으므로 나중에 전부 추려 볼 수 있다.
 * 🔵 아래 `different_users` CHECK 는 **다른 이야기**다. 그쪽은 「A 가 A 를 대신한다」는
 * 뜻이 없는 줄을 막는 것이고, 여기서 말하는 것은 「B 가 A→B 를 직접 만든다」이다.
 *
 * ── 줄은 지우지 않는다 ──────────────────────────────────────────────────
 * 되돌리기는 `revoked_at` 에 시각을 적는 것이다(옛 표의 status enum 과 달리 깃발
 * 칸을 따로 두지 않는다 — 시각 하나면 「되돌렸나」와 「언제」가 함께 답해진다).
 * 「만료」도 저장하지 않는다: 기간이 지났는지는 언제나 읽을 때 `now()` 와 견주어
 * 계산한다. 저장해 두면 언젠가 자료가 낡는다(옛 표가 EXPIRED 를 저장하지 않는
 * 까닭과 같다).
 * ============================================================================
 */
export const approvalRouteDelegations = pgTable(
  "approval_route_delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 결재권을 맡기는 사람 — **결재선 단계에 적힌 그 사람**이다.
     *
     * 🔴 「지금 어느 단계에 적혀 있나」는 여기 사본으로 두지 않는다. 결재선은 판을
     * 새로 얹으며 바뀌고(shipment-approval-routes.ts 머리말), 사본을 두면 판이 바뀐
     * 날부터 조용히 어긋난다. 위임은 **사람에게 걸린다** — 그가 어느 단계에 적혀
     * 있든 그 자리를 대신 누를 수 있다.
     *
     * RESTRICT 는 이 저장소의 사람 참조 관례다 — 사용자는 소프트삭제만 하므로 행이
     * 사라질 일이 없고, 실수로라도 하드 삭제가 시도되면 여기서 막힌다.
     */
    delegatorUserId: uuid("delegator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** 대신 눌러 줄 사람. 대표일 필요도, 어느 결재선에 적혀 있을 필요도 없다. */
    delegateUserId: uuid("delegate_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /**
     * 🔴 **이 순간은 포함하지 않는다**(반열린 구간 `[starts_at, ends_at)`). 「9월
     * 30일까지」를 적을 때 여기 들어가는 값은 **10월 1일 0시**다. 까닭은 판정 함수
     * 주석에 있다 — 잇대어 적은 두 위임이 한순간 둘 다 살아 있는 일을 막는다.
     */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /**
     * 사유. 선택 입력이라 **널 대신 빈 글자**다 — 「안 적었다」와 「모른다」를 가를
     * 일이 없는 칸이라, 읽는 쪽마다 `?? ""` 를 적게 만들지 않는다.
     */
    reason: text("reason").notNull().default(""),
    /**
     * 이 줄을 **만든** 사람. 본인이 스스로 맡긴 것인지 관리자가 대신 세운 것인지가
     * 여기 남는다 — `delegator_user_id` 와 같으면 본인, 다르면 남이 세운 것이다.
     * 🔴 「누가 세웠나」를 막는 제약은 두지 않는다(머리말). 이 칸은 그 대신이다.
     */
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * 되돌린 시각. 아직 살아 있으면 `NULL`.
     *
     * 🔴 **기간을 줄여 적는 것이 아니다.** 되돌려도 `ends_at` 은 그대로 남으므로,
     * 기간만 보고 판정하면 되돌린 뒤에도 계속 참이 된다. 판정 함수가 이 칸을 **먼저**
     * 보는 까닭이 그것이다.
     *
     * 🔴 아래 `revoked_by_user_id` 와 **짝이다** — 둘 다 적히거나 둘 다 비어 있다.
     * 아래 `revocation_metadata` CHECK 가 지킨다.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** 되돌린 사람. 🔴 위 `revoked_at` 과 짝이라 혼자 적힐 수 없다(아래 CHECK). */
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    // 「내가 지금 누구를 대신하나」 — 결재 판정·목록·종이 전부 이 모양으로 묻는다.
    // 대리인으로 좁히고(`delegate_user_id`), 되돌리지 않은 줄만 남기고(`revoked_at
    // IS NULL`), 아직 안 끝난 것만 본다(`ends_at > now()`). 칸 순서가 그 순서다.
    //
    // 🔵 `starts_at` 은 일부러 넣지 않았다 — 한 사람에게 걸린 위임은 많아야 몇 줄이라
    // 앞 셋으로 좁히고 나면 시작 시각은 읽은 뒤 걸러도 된다. 넣어 봐야 색인만 굵어진다.
    index("approval_route_delegations_delegate_active_idx").on(
      table.delegateUserId,
      table.revokedAt,
      table.endsAt
    ),
    // 끝이 시작보다 뒤여야 한다. 같아도 안 된다 — 끝을 포함하지 않으므로 `ends_at =
    // starts_at` 인 줄은 **단 한순간도 살아 있지 않은** 위임이 되고, 그런 줄은 만든
    // 사람이 「맡겨 뒀다」고 믿는데 아무 일도 일어나지 않는 가장 나쁜 모양이다.
    check("approval_route_delegations_valid_range", sql`ends_at > starts_at`),
    // 「A 가 A 를 대신한다」는 뜻이 없는 줄이다. 본인은 판정 함수가 언제나 목록
    // 맨 앞에 넣어 주므로(actingApproverUserIds), 이런 줄은 아무것도 늘리지 않는다.
    check(
      "approval_route_delegations_different_users",
      sql`delegate_user_id <> delegator_user_id`
    ),
    // 🔴 되돌림 두 칸은 **함께 적히거나 함께 비어 있다**(2026-10-26 사용자 승인).
    // 이름을 옛 표의 같은 제약(`shipment_approval_delegations_revocation_metadata`)과
    // 맞춘 것은 의도다 — 하는 일이 같으면 이름도 같아야 다음 사람이 둘을 한눈에 짝짓는다.
    //
    // 판정 함수는 `revoked_at` **한 칸만** 본다(domain/approval-route-delegation.ts).
    // 그래서 `revoked_by_user_id` 만 적히고 시각이 빈 줄이 들어오면 **되돌렸는데 계속
    // 살아 있는 위임**이 된다 — 오류도 경고도 나지 않고, 맡긴 사람이 「되돌렸다」고 믿는
    // 동안 대리인이 계속 누를 수 있다. 코드를 두 칸 다 보게 고치는 길도 있었지만,
    // 그러면 「둘이 어긋난 줄」이라는 상상 속 모양을 읽는 쪽마다 다시 처리해야 한다.
    // **DB 가 그런 줄을 아예 못 만들게 하는 쪽**이 한 자리에서 끝난다.
    //
    // 🔵 옛 표는 status enum 까지 끼워 세 값을 맞췄지만 이 표에는 깃발 칸이 없다 —
    // 「되돌렸나」는 시각 하나로 답해지므로 맞출 것이 두 칸뿐이다.
    check(
      "approval_route_delegations_revocation_metadata",
      sql`
        (revoked_at IS NULL AND revoked_by_user_id IS NULL)
        OR
        (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
      `
    ),
  ]
);
