import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";
import { workflowSteps } from "./workflow";
import { procedureCaseExecutionNodes } from "./procedure-case-execution";

/**
 * Author-selected, explicit classification for the automatic 고장 및 서비스
 * 정보 summary derivation (인수점검 결과/현재 진단·조치 요약/다음 예정 작업)
 * — never inferred from memo text or related_workflow_step_id. GENERAL is
 * the safe default for both ordinary notes and every pre-existing row (see
 * record_kind's column-level DEFAULT below — no backfill UPDATE is ever
 * run; historical rows become GENERAL purely through that default).
 */
export const repairCaseWorkRecordKindEnum = pgEnum("repair_case_work_record_kind", [
  "GENERAL",
  "INTAKE_INSPECTION_RESULT",
  "DIAGNOSIS_REPAIR_SUMMARY",
  "NEXT_PLANNED_ACTION",
]);

/**
 * Phase 5C-2 — durable, append-oriented per-case work history ("작업 기록"),
 * distinct from procedure_case_execution_nodes.work_memo (the per-node,
 * overwritable "작업 메모" that Phase 5A already owns — never touched,
 * never backfilled, never synchronized with this table).
 *
 * 🔴 2026-10-02 — **고칠 수 있는 칸이 생겼다.** 그 전까지 이 자리에는 "there
 * is no update mutation for memo/author/created_at … ever" 라고 적혀 있었다.
 * 사용자 결정(「올리고 다시 쓰기」가 아니라 「글을 진짜로 고치기」)으로 그
 * 불변식이 바뀌었으므로, 다음 사람이 옛 문장을 믿고 잘못 고치지 않도록 지금
 * 사실을 그대로 적는다.
 *
 *  · **고칠 수 있는 것 — memo, record_kind 둘뿐.** 작성자 본인만, 그리고
 *    db/mutations/repair-case-work-records.ts 의 editWorkRecord 를 통해서만.
 *    고치기 전 값은 아래 repair_case_work_record_edits 에 한 줄씩 쌓인다 —
 *    덮어쓰기지만 흔적이 남지 않는 덮어쓰기는 아니다. record_kind 가 함께
 *    고쳐지는 까닭은 「고장 및 서비스 정보」 요약이 **그 구분의 가장 최근 유효
 *    기록**을 읽기 때문이다(구분을 못 고치면 고치기가 반쪽이 된다).
 *  · **여전히 못 고치는 것 — author_user_id, created_at,
 *    related_workflow_step_id, related_procedure_execution_node_id,
 *    client_request_id, 그리고 무효 처리 세 칸**
 *    (invalidated_at/invalidated_by/invalidation_reason). 누가 언제 썼는지와
 *    어떤 맥락에서 썼는지는 기록의 신분이라 바뀌지 않는다.
 *  · **이미 무효 처리된 기록은 고칠 수 없다** — editWorkRecord 가
 *    ALREADY_INVALIDATED 로 거절하고, UPDATE 의 WHERE 에도
 *    `invalidated_at IS NULL` 을 겹쳐 둔다(invalidateWorkRecord 와 같은 수법).
 *
 * 무효 처리는 그대로다: 한 번만, 되돌릴 수 없는 one-way invalidation
 * (invalidated_at/invalidated_by/invalidation_reason) — 같은 모듈의
 * invalidateWorkRecord 가 `WHERE invalidated_at IS NULL` 로 막아, 두 번
 * 무효 처리되거나 원래 사유가 조용히 덮이는 일이 없다. 무효 처리는 한 줄에
 * 대한 단 한 번의 사실이라 별도의 append-only 이벤트 표를 두지 않았다
 * (contrast status_change_histories/procedure_case_execution_history, which
 * log genuinely repeatable transitions) — 세 칸이면 전부 담긴다. 반대로
 * **고치기는 되풀이되는 일**이라 아래에 제 표를 두었다.
 *
 * related_workflow_step_id captures the actual workflow_steps.id active at
 * creation time (never inferred later from the case's current step, which
 * may have moved on) — nullable only for schema-level future-proofing;
 * repair_cases.current_workflow_step_id is NOT NULL/FK-enforced, so in
 * practice this is always populated for every row created against today's
 * schema.
 *
 * client_request_id is the idempotency guard for double-submit protection
 * (see the mutation's INSERT ... ON CONFLICT DO NOTHING + compare-on-conflict
 * design) — deliberately not a separate idempotency-keys table, since this
 * is a single-shape, single-insert operation.
 */
export const repairCaseWorkRecords = pgTable(
  "repair_case_work_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. Engineer work-
    // history/memo log that must outlive the case's own hard-delete; the
    // row's own memo/recordKind/workflowStepId permanently preserve what
    // was recorded regardless of this column going NULL. Existing rows are
    // untouched by this — only a future repair_cases hard-delete ever nulls
    // it. Same proven pattern as
    // repair_case_flowchart_edit_history.flowchart_id (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // 🔴 작성자 본인이 editWorkRecord 로 고칠 수 있는 두 칸 중 하나다
    // (2026-10-02). 고치기 전 값은 repair_case_work_record_edits 에 남는다.
    memo: text("memo").notNull(),
    // 🔴 memo 와 함께 고칠 수 있는 나머지 한 칸이다(모듈 머리 주석). 요약이
    // 「그 구분의 가장 최근 유효 기록」을 읽으므로 글만 고치면 반쪽이 된다.
    recordKind: repairCaseWorkRecordKindEnum("record_kind").notNull().default("GENERAL"),
    relatedWorkflowStepId: uuid("related_workflow_step_id").references(() => workflowSteps.id, {
      onDelete: "restrict",
    }),
    relatedProcedureExecutionNodeId: uuid("related_procedure_execution_node_id").references(
      () => procedureCaseExecutionNodes.id,
      { onDelete: "restrict" }
    ),
    // Client-minted UUID, one per compose attempt — see mutation module doc
    // comment for the full idempotency design.
    clientRequestId: uuid("client_request_id"),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedBy: uuid("invalidated_by").references(() => users.id, { onDelete: "restrict" }),
    invalidationReason: text("invalidation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("repair_case_work_records_memo_not_blank", sql`btrim(${table.memo}) <> ''`),
    // Exactly two valid states — never a partial invalidation. An explicit
    // OR of two fully-specified states (not a weaker chained-null-equality
    // check), so e.g. "reason set but invalidated_at NULL" is impossible.
    check(
      "repair_case_work_records_invalidation_all_or_nothing",
      sql`(${table.invalidatedAt} IS NULL AND ${table.invalidatedBy} IS NULL AND ${table.invalidationReason} IS NULL)
        OR (${table.invalidatedAt} IS NOT NULL AND ${table.invalidatedBy} IS NOT NULL AND ${table.invalidationReason} IS NOT NULL AND btrim(${table.invalidationReason}) <> '')`
    ),
    // Idempotency guard — see module doc comment. Partial so a NULL
    // client_request_id (never actually sent by the create mutation, but
    // schema-permitted) never collides with another NULL.
    uniqueIndex("repair_case_work_records_repair_case_client_request_unique")
      .on(table.repairCaseId, table.clientRequestId)
      .where(sql`client_request_id is not null`),
    // The one real query pattern: recent-N / paginated-full-history for one
    // case, newest first.
    index("repair_case_work_records_repair_case_id_created_at_idx").on(table.repairCaseId, table.createdAt),
    index("repair_case_work_records_author_user_id_idx").on(table.authorUserId),
    // Serves "latest non-invalidated record of a given kind for this case"
    // — the derived-summary read pattern (인수점검 결과/진단·조치 요약/다음
    // 예정 작업). Partial on invalidated_at IS NULL, same convention as the
    // procedure-execution-node index below.
    index("repair_case_work_records_repair_case_id_record_kind_created_at_idx")
      .on(table.repairCaseId, table.recordKind, table.createdAt)
      .where(sql`invalidated_at is null`),
    // Partial: supports "was this node referenced by a work record" lookups
    // cheaply; most rows have this NULL (plain memo, no node context).
    index("repair_case_work_records_procedure_execution_node_id_idx")
      .on(table.relatedProcedureExecutionNodeId)
      .where(sql`related_procedure_execution_node_id is not null`),
    // No index on related_workflow_step_id (no query filters by step) or on
    // invalidation state (the UI always reads the full per-case list and
    // renders invalidation inline — no filtered "valid only" query exists
    // in this phase) — avoiding speculative indexes.
  ]
);

/**
 * 작업 기록을 고친 이력(2026-10-02). 한 번 고칠 때마다 **고치기 전 값**이 여기
 * 한 줄로 쌓인다 — 본 표는 고쳐진 뒤의 값을 들고 있으므로, 둘을 합치면 그
 * 기록이 지나온 모든 판본이 된다.
 *
 * 🔴 **본 표에는 칸을 하나도 더하지 않았다.** 「이 기록이 고쳐졌는가」는 이
 * 표에 그 work_record_id 로 줄이 있는가로 안다(`edited_at`/`is_edited` 같은
 * 중복 칸을 본 표에 두면 두 자리가 어긋날 수 있다). 읽는 쪽은
 * db/queries/repair-case-work-records.ts 가 기록마다 따로 묻지 않고 한 번에
 * 긁어 온다 — 그래서 (work_record_id, edited_at) 색인 하나면 된다.
 *
 * 🔴 `ON DELETE CASCADE` 인 까닭: 작업 기록 없이 그 기록의 고친 이력만 남는
 * 것은 뜻이 없다 — 무엇을 고치기 전의 값인지 가리킬 대상이 사라진다. 지금
 * 작업 기록은 **지워지지 않는다**(무효 처리만 된다). 그러니 이 CASCADE 는
 * 평소에는 한 번도 도는 일이 없고, 언젠가 작업 기록 자체를 지우는 길이
 * 생겼을 때 고아 줄을 남기지 않기 위한 대비다. 본 표의 repair_case_id 가
 * ON DELETE SET NULL 인 것과는 다른 판단인데, 그쪽은 **접수 건이 사라져도
 * 기록 자체는 남아야 하는** 값이기 때문이다(그 줄의 memo/record_kind 가 그
 * 자체로 뜻을 갖는다). 반대로 이 표의 줄은 혼자서는 아무 뜻이 없다.
 *
 * edited_by 는 ON DELETE RESTRICT — 본 표의 author_user_id/invalidated_by 와
 * 같은 규칙이다(사람을 지워서 이력의 주체를 지울 수는 없다).
 */
export const repairCaseWorkRecordEdits = pgTable(
  "repair_case_work_record_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workRecordId: uuid("work_record_id")
      .notNull()
      .references(() => repairCaseWorkRecords.id, { onDelete: "cascade" }),
    /** 고치기 전의 글. 본 표의 memo 와 같은 규칙(빈 글은 애초에 저장될 수 없다). */
    previousMemo: text("previous_memo").notNull(),
    /** 고치기 전의 기록 구분. 구분을 안 바꾸고 글만 고쳐도 그때의 구분을 함께 남긴다 — 한 줄만 보고 그 시점의 기록을 통째로 되살릴 수 있어야 한다. */
    previousRecordKind: repairCaseWorkRecordKindEnum("previous_record_kind").notNull(),
    editedBy: uuid("edited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 유일한 조회 패턴: 이 기록의 고친 이력을 시간순으로. 읽는 쪽은 여러
    // 기록의 이력을 한 번에 긁으므로 선행 칼럼이 work_record_id 여야 한다.
    index("repair_case_work_record_edits_work_record_id_edited_at_idx").on(table.workRecordId, table.editedAt),
  ]
);
