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
import { domesticOrders } from "./domestic-orders";
import { repairCases } from "./repair-cases";
import { shipmentApprovalRoutes } from "./shipment-approval-routes";
import { users } from "./users";

/**
 * Two-value set matching the local-demo domain layer's ApprovalType exactly
 * (src/lib/domain/local/approval/approval-types.ts APPROVAL_TYPE_CODES) —
 * no new approval types invented here.
 *
 * ── 🔴 2026-11-06: **셋째 값이 붙었다. 접수 건의 것이 아니다.** ───────────
 * 'DOMESTIC_ORDER_FINAL_SHIPMENT' 는 **기타건**(내자 정리의 한 줄, domestic_orders)
 * 의 최종 출하 승인이다. 표 이름이 `repair_case_…` 인데 접수 건이 아닌 행이 들어오는
 * 것은 사용자 승인을 받은 설계다(2026-11-06, 「㉮ 그 표에 칸을 더한다」) — 결재선 ·
 * 지정 · 위임 · 사슬 잇기가 접수 건 출하 승인과 **글자 그대로 같은 규칙**이라 표를
 * 따로 두면 그 규칙이 두 벌이 된다.
 *
 * 🔴 **어느 쪽 행인지는 approval_type 으로 가린다** — repair_case_id 가 NULL 인지로
 * 가리면 안 된다. 그 칸은 접수 건을 영구 삭제하면 NULL 이 되므로(ON DELETE SET NULL)
 * 「접수 건 결재인데 NULL」인 행이 실제로 있다(2026-11-06 개발 DB 실측 76행 중 18행).
 * 아래 두 CHECK 가 타입과 주체 칸을 묶어 둔다.
 *
 * 🔴 **위 둘을 보는 조회는 한 줄도 바뀌지 않았다.** 그 조회들은 전부
 * `repair_case_id = ?` 로 좁히거나 repair_cases 와 INNER JOIN 하는데, 기타건 행은
 * repair_case_id 가 **언제나 NULL** 이라(아래 CHECK) 어느 쪽으로도 걸리지 않는다.
 * 값을 따로 둔 가장 큰 까닭이 그것이다 — 'FINAL_SHIPMENT' 를 그대로 쓰면 그 조회들이
 * 조용히 기타건 행을 집어 든다.
 */
export const approvalTypeEnum = pgEnum("repair_case_approval_type", [
  "REPAIR_INSPECTION",
  "FINAL_SHIPMENT",
  "DOMESTIC_ORDER_FINAL_SHIPMENT",
]);

/**
 * Deliberately narrower than the local-demo layer's four-value
 * StoredApprovalStatus (which also has CHANGES_REQUESTED): this task's
 * approved schema only calls for REQUESTED/APPROVED/REJECTED, and
 * CHANGES_REQUESTED is not "already supported" in the sense the task's
 * conditional CANCELLED note implies — so it is intentionally not carried
 * over. A rejected request can always be resubmitted (a fresh REQUESTED
 * row), which covers the same "send it back for changes" business need
 * without a distinct status. CANCELLED is likewise omitted (not already
 * supported anywhere today).
 */
export const approvalStatusEnum = pgEnum("repair_case_approval_status", [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
]);

/**
 * Immutable, append-style approval request/decision history — same
 * no-soft-delete convention as status_change_histories (an approval
 * decision is a historical fact, never edited or removed). One row per
 * request; a decision (approve/reject) updates that same row's decision
 * columns exactly once (enforced by the CHECK below plus the mutation
 * layer's re-check of status === 'REQUESTED' inside its transaction) —
 * this mirrors the local-demo layer's "at most one current record per
 * (repairCaseId, approvalType), decisions are terminal" model, except here
 * each request *is* its own row (append-only) rather than being mutated
 * back to PENDING on resubmission, so full request history is preserved
 * without a separate events table.
 *
 * `repair_case_version_at_request` snapshots repair_cases.version at
 * request time — resolveVerifiedApproval() (mutation layer) compares this
 * against the case's current version before letting an APPROVED row gate a
 * transition, so an approval granted against stale case state can never be
 * silently reused (task requirement: "Approval cannot be reused ... if the
 * business state changed materially").
 *
 * No customer/contact PII: only user ids/names (via join) and free-text
 * reasons an internal user typed about the repair, never customer contact
 * fields.
 */
export const repairCaseApprovals = pgTable(
  "repair_case_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. This table is
    // immutable/append-only approval history (검수/출하 승인) that must
    // outlive the case's own hard-delete; the row's own approvalType/status/
    // decision columns permanently preserve the decision regardless of this
    // column going NULL. Existing rows are untouched by this — only a
    // future repair_cases hard-delete ever nulls it. Same proven pattern as
    // repair_case_flowchart_edit_history.flowchart_id (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    // 「기타건」(내자 정리의 한 줄)의 결재일 때 그 줄 — 2026-11-06.
    //
    // 🔴 **위 repair_case_id 와 짝을 이루는 「주체」 칸이고, 둘은 함께 차지 않는다.**
    // 어느 쪽 결재인지는 approval_type 이 정하고(위 enum 주석), 아래 CHECK 둘이 타입과
    // 이 두 칸을 묶는다:
    //  · domestic_order_only_for_domestic_type — 이 칸은 기타건 결재에만 찬다.
    //  · domestic_type_has_no_repair_case      — 기타건 결재에는 접수 건이 없다.
    // 둘을 합치면 「둘 다 차 있는 행」은 존재할 수 없다.
    //
    // 🔴 **XOR(「둘 중 정확히 하나」)로 적지 않는다.** repair_case_id 는 접수 건을 영구
    // 삭제하면 NULL 이 되므로(바로 위 ON DELETE SET NULL) **둘 다 NULL 인 행이 이미
    // 있다** — 2026-11-06 개발 DB 실측으로 76행 중 18행이 그랬다. XOR 를 걸면 그 18행
    // 때문에 마이그레이션 자체가 적용되지 않고, 설령 지금 0건이라도 접수 건 영구 삭제
    // 경로(mutations/repair-cases-permanent-delete.ts)가 그날부터 막힌다.
    //
    // ON DELETE SET NULL — repair_case_id 와 같은 까닭이다. 이 표는 고쳐 쓰지 않는
    // 결재 이력이고, 기타건 줄이 영구 삭제돼도 「누가 언제 승인했나」는 남아야 한다
    // (domestic_orders 쪽도 접수 건을 그렇게 가리키고 있다).
    domesticOrderId: uuid("domestic_order_id").references(() => domesticOrders.id, {
      onDelete: "set null",
    }),
    approvalType: approvalTypeEnum("approval_type").notNull(),
    status: approvalStatusEnum("status").notNull().default("REQUESTED"),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestReason: text("request_reason"),
    // 「이 요청을 누가 처리할지」 — 요청할 때 지정한 사람.
    //
    // 🔴 **NULL 이 정상값이고, 뜻이 있다: 「지정 없음 = 자격 있는 사람 누구나
    // 처리」** — 이 칸이 생기기 전과 완전히 같은 동작이다. 그래서 NOT NULL 도
    // 기본값도 두지 않는다. 이미 쌓여 있는 승인 기록이 전부 NULL 로 남아 어제와
    // 똑같이 동작하는 것이 이 설계의 안전장치다. 지정은 어디까지나 선택이다
    // (「누구든 빨리 봐 주세요」인 경우가 실제로 있다).
    //
    // 지정이 있으면 그 사람만 처리할 수 있다(+ 최고관리자는 언제나 — 자리를
    // 비워 영영 막히는 것을 막는다). 판정은 화면·서버 액션·mutation·알림 조회가
    // 전부 같은 함수 하나를 본다: mayDecideAssignedApproval
    // (src/lib/auth/approval-assignment.ts).
    //
    // 승인 종류를 가리지 않는 이름인 것은 의도다. 최종 출하 승인의 순차 승인도
    // 이 칸으로 풀 예정이라(단계마다 요청 행 하나, 그 행의 지정된 사람이 그
    // 단계의 승인자) 「검수 전용」이 되면 안 된다.
    //
    // ON DELETE RESTRICT — 다른 사람 참조 칸들(requested_by/decided_by/
    // delegated_from)과 같다. 지정된 사람이 지워지면서 이 이력이 조용히
    // 뭉개지지 않게 한다.
    assignedApproverUserId: uuid("assigned_approver_user_id").references(
      () => users.id,
      { onDelete: "restrict" }
    ),
    // 「이 요청이 결재선(판)의 몇 번째 단계인가」 — 두 칸이 한 쌍이다.
    //
    // 🔴 **NULL 이 정상값이고, 뜻이 있다: 「결재선을 타지 않는 요청」** — 이
    // 칸들이 생기기 전과 완전히 같은 동작이다(최종 출하 승인은 「출하 대표」·
    // 위임 방식으로 처리, 검수 승인은 역할 자격으로 처리). 그래서 NOT NULL 도
    // 기본값도 두지 않는다. 이미 쌓여 있는 승인 기록이 전부 NULL 로 남아 어제와
    // 똑같이 동작하는 것이 이 설계의 안전장치다. 결재선 판이 하나도 없거나 단계
    // 0개인 판일 때도 NULL 이다(빈 판은 「절차를 쓰지 않겠다」는 정상적인 뜻이다).
    //
    // 값이 있으면 그 단계의 승인자(assigned_approver_user_id)만 처리할 수 있고
    // (+ 최고관리자), 대표·위임 판정은 건너뛴다 — 절차가 대표를 **대신한다**.
    // 승인되면 같은 판의 다음 단계 요청 행이 이어서 하나 만들어진다.
    //
    // 🔴 판을 **그때 그 판으로 붙잡아 두는** 칸이다. 관리자가 절차를 바꾸면 새
    // 판이 얹히지만(shipment_approval_routes 는 append-only), 이미 요청된 건은
    // 여기에 적힌 옛 판을 끝까지 따라간다. 요청 시점의 결재선을 복사해 굳히는
    // 표가 따로 필요 없는 이유다 — repair_case_version_at_request 가 접수 건
    // 상태에 대해 하는 것과 같은 종류의 고정이다.
    //
    // ON DELETE RESTRICT — 판이 지워지면서 이 이력이 「몇 번째 단계였는지 알 수
    // 없는 행」으로 남지 않게 한다(판은 실제로 지우지 않으므로 방어선이다).
    routeId: uuid("route_id").references(() => shipmentApprovalRoutes.id, {
      onDelete: "restrict",
    }),
    // 그 판 안에서 몇 번째 단계인가(1부터). route_id 와 **함께 있거나 함께
    // 없다** — 아래 CHECK 가 그것을 강제한다. 다음 단계를 찾을 때
    // (route_id, route_step_order + 1) 로 조회한다.
    routeStepOrder: integer("route_step_order"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    // 「**누구 자리**를 대신 누른 것인가」 — 결재한 사람이 자기 자격이 아니라
    // 남의 자리를 대신해 누른 경우, **그 원래 자리의 사람**이 여기 남는다.
    // 실제로 손을 댄 사람은 decided_by_user_id 에 그대로 남는다. 「B 가 A 를
    // 대신해 승인했다」는 두 칸을 **함께** 읽어야만 복원된다.
    //
    // 🔴 **이 한 칸에 위임 두 제도가 함께 적힌다**(2026-10-26, 결재선 단계
    // 위임이 실제 결재에 연결되면서). 고칠 일이 생기면 **어느 쪽 이야기인지
    // 먼저 가려라** — 가르는 것은 route_id 다:
    //  · 결재선을 **타지 않는** 행(route_id 가 NULL) → `shipment_approval_delegations`
    //    (「출하 대표」 권한을 통째로 맡기는 옛 표). 여기 적히는 사람은 그 순간
    //    자격이 살아 있던 **대표**다(users.is_shipment_representative).
    //  · 결재선을 **탄** 행(route_id 가 채워짐) → `approval_route_delegations`
    //    (결재선 **단계**를 기간으로 맡기는 표, 마이그레이션 0119). 여기 적히는
    //    사람은 그 단계의 결재권자, 곧 assigned_approver_user_id 와 같은 사람이다.
    // 두 경로는 **동시에 일어날 수 없다** — 결재선을 타는 행은 대표·위임 판정을
    // 아예 건너뛴다. 그래서 한 칸으로 충분하고, 어느 쪽이든 뜻은 같다. 갈림의
    // 전문은 mutations/repair-case-approvals.ts 머리말에 있다.
    //
    // 🔴 **최고관리자 비상구로 누른 것은 위임이 아니다** — 그때는 NULL 이다.
    // 섞어 적으면 「A 의 결재권을 받아 B 가 눌렀다」와 「막혀 있어 최고관리자가
    // 풀었다」가 기록에서 구별되지 않는다. 판정은 한 곳에만 있다
    // (auth/approval-assignment.ts 의 delegatedFromUserIdFor).
    //
    // 🔴 **최종 출하 승인에만 값이 있다.** 수리 검수 승인 행은 언제나 NULL 이고
    // 아래 CHECK(delegation_only_for_final_shipment)이 그것을 강제한다 — 검수는
    // 결재선을 탈 수 없어(route_only_for_final_shipment) 대신할 「단계」가 없고,
    // 「출하 대표」라는 개념도 그쪽에는 없다.
    delegatedFromUserId: uuid("delegated_from_user_id").references(
      () => users.id,
      { onDelete: "restrict" }
    ),
    /**
     * 요청하던 순간 **그 건의 낙관적 잠금 번호**. 그 뒤에 건이 바뀌면 이 승인은
     * 무효가 된다(resolveApprovalState 가 지금 번호와 견준다).
     *
     * 🔴 **이름은 `repair_case_…` 인데 기타건 행에는 `domestic_orders.version` 이
     * 들어간다**(2026-11-06). 칸 이름을 바꾸지 않은 것은 의도다 — 이 칸을 읽는
     * 모듈이 여덟이고, NOT NULL 칸 이름 바꾸기는 db:preflight 가 보지 못하는 종류의
     * 변경이라(표 이름 바꾸기를 피한 shipment_approval_routes 와 같은 판단) 지금 얻을
     * 것보다 잃을 것이 크다. **다음 사람은 이름이 아니라 approval_type 을 보고
     * 판단할 것.**
     *
     * 🔵 두 표 모두 version 은 **고칠 때마다 +1 되는 진짜 잠금 토큰**이다
     * (mutations/domestic-orders.ts 의 updateDomesticOrder 가 repair_cases 와 같은
     * 방식으로 올린다). 그래서 뜻이 그대로 선다: 「요청 뒤에 그 줄이 바뀌면 다시
     * 받아야 한다」.
     */
    repairCaseVersionAtRequest: integer(
      "repair_case_version_at_request"
    ).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // At most one active (still-REQUESTED) approval per case+type — the
    // mutation layer's transactional re-check is the primary guard, this
    // index is the DB-level backstop that makes a race condition impossible
    // rather than merely unlikely.
    uniqueIndex("repair_case_approvals_one_active_request")
      .on(table.repairCaseId, table.approvalType)
      .where(sql`status = 'REQUESTED'`),
    // 🔴 기타건 쪽의 **같은 보증**이다 — 한 내자 줄에 열려 있는 요청은 하나다.
    //
    // 색인을 따로 두는 것 말고 길이 없다: 위 색인의 첫 칸이 repair_case_id 인데
    // 기타건 행은 그 칸이 **언제나 NULL** 이고, Postgres 의 유니크 색인은 NULL 끼리
    // 겹치는 것으로 보지 않는다(그래서 위 색인은 기타건 행을 하나도 막지 않는다 —
    // 뒤집어 말하면 **기타건 행이 생겨도 수리 건 쪽 보증은 한 톨도 바뀌지 않는다**).
    //
    // approval_type 을 함께 넣는 것은 수리 건 쪽과 모양을 맞추기 위해서다. 지금은
    // 기타건 결재 종류가 하나뿐이라 없어도 같게 동작하지만, 종류가 늘면 그때
    // 「종류별로 하나」가 저절로 따라온다.
    uniqueIndex("repair_case_approvals_one_active_domestic_request")
      .on(table.domesticOrderId, table.approvalType)
      .where(sql`status = 'REQUESTED'`),
    index("repair_case_approvals_repair_case_id_idx").on(table.repairCaseId),
    // 기타건 상세의 [승인] 탭이 이 길로 그 줄의 결재 이력을 읽는다
    // (repair_case_id_idx 와 같은 자리).
    index("repair_case_approvals_domestic_order_id_idx").on(table.domesticOrderId),
    index("repair_case_approvals_requested_by_user_id_idx").on(
      table.requestedByUserId
    ),
    // 알림 종·배지가 "내게 지정된 결재"를 찾는 길 — 지정된 행만 걸러 읽는다.
    index("repair_case_approvals_assigned_approver_user_id_idx").on(
      table.assignedApproverUserId
    ),
    check(
      "repair_case_approvals_decision_metadata",
      sql`
        (status = 'REQUESTED' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'APPROVED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)
      `
    ),
    // 🔴 **이름 그대로 「최종 출하 승인에만」이다** — 2026-11-06 에 글자가 늘어난 것은
    // 뜻이 넓어져서가 아니라, **최종 출하 승인이 둘이 됐기 때문**이다(접수 건의 것과
    // 기타건의 것). 수리 검수 승인은 여전히 이 칸을 쓸 수 없다. 그래서 이름을 바꾸지
    // 않았다 — 이 이름은 코드·주석 여섯 곳에서 이 규칙을 가리키고 있다.
    //
    // 🔴 **`::text` 로 견주는 까닭 — 이것이 없으면 마이그레이션이 적용되지 않는다.**
    // drizzle 의 migrate 는 **밀린 마이그레이션 전부를 트랜잭션 하나**에 넣는다.
    // 그 안에서 `ALTER TYPE … ADD VALUE` 로 갓 더한 값을 enum 리터럴로 쓰면 Postgres 가
    // 거절한다(`unsafe use of new value "…" of enum type`). 파일을 둘로 쪼개도 소용이
    // 없다 — 트랜잭션이 하나다. 2026-11-06 에 실제로 그 오류로 멈췄고, 운영에서도
    // 똑같이 멈췄을 자리다(배포는 같은 명령을 쓴다).
    // 🔵 `enum → text` 변환은 immutable 이라 CHECK 에 쓸 수 있다.
    check(
      "repair_case_approvals_delegation_only_for_final_shipment",
      sql`delegated_from_user_id IS NULL OR approval_type::text IN ('FINAL_SHIPMENT', 'DOMESTIC_ORDER_FINAL_SHIPMENT')`
    ),
    // 결재선 두 칸은 한 쌍이다. 하나만 채워진 행은 「어느 판인지는 아는데 몇
    // 번째인지 모른다」(또는 그 반대)라서 다음 단계를 이을 수도, 지난 단계를
    // 설명할 수도 없다.
    check(
      "repair_case_approvals_route_columns_together",
      sql`(route_id IS NULL AND route_step_order IS NULL) OR (route_id IS NOT NULL AND route_step_order IS NOT NULL)`
    ),
    // 결재선은 최종 출하 승인에만 있다 — 검수 승인은 역할 자격으로 처리한다.
    // delegation_only_for_final_shipment 와 같은 모양의 방어선이고, 2026-11-06 에
    // 글자가 늘어난 까닭도 같다(최종 출하 승인이 둘이 됐다).
    //
    // 🔵 기타건 쪽은 더 좁다 — 결재선이 **유일한** 길이라 route_id 가 NULL 인 행은
    // 정상 경로로는 생기지 않는다. 그 좁힘은 DB 가 아니라 저장 경로가 지킨다
    // (mutations/domestic-order-approvals.ts 는 판이 없으면 요청을 거절한다) —
    // 여기서 NOT NULL 로 못 박으면 수리 건 쪽 행까지 함께 걸린다.
    // `::text` 인 까닭은 바로 위 CHECK 주석에 있다(갓 더한 enum 값은 같은 트랜잭션에서
    // 리터럴로 쓸 수 없다).
    check(
      "repair_case_approvals_route_only_for_final_shipment",
      sql`route_id IS NULL OR approval_type::text IN ('FINAL_SHIPMENT', 'DOMESTIC_ORDER_FINAL_SHIPMENT')`
    ),
    // ── 🔴 「주체」 칸 둘과 승인 종류를 묶는 CHECK 둘 (2026-11-06) ─────────
    // 합치면 「둘 다 차 있는 행은 없다」가 따라 나온다. 한 줄로 합치지 않고 둘로 둔
    // 것은 어긋났을 때 **어느 쪽이 틀렸는지 이름으로 알 수 있게** 하기 위해서다.
    //
    // 🔴 **XOR 가 아니다** — 「둘 다 NULL」은 정상이다. 까닭은 domestic_order_id 칸
    // 주석에 있다(영구 삭제된 접수 건의 결재 이력이 실제로 그 모양이다).
    // `::text` 인 까닭은 위 delegation CHECK 주석에 있다.
    check(
      "repair_case_approvals_domestic_order_only_for_domestic_type",
      sql`domestic_order_id IS NULL OR approval_type::text = 'DOMESTIC_ORDER_FINAL_SHIPMENT'`
    ),
    check(
      "repair_case_approvals_domestic_type_has_no_repair_case",
      sql`approval_type::text <> 'DOMESTIC_ORDER_FINAL_SHIPMENT' OR repair_case_id IS NULL`
    ),
  ]
);
