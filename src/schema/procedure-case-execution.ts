import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { procedureTemplates, procedureTemplateCategoryEnum } from "./procedure-templates";
import { procedureTemplateNodes, procedureNodeTypeEnum } from "./procedure-template-nodes";
import { procedureTemplateEdges, procedureBranchTypeEnum } from "./procedure-template-edges";
import { users } from "./users";

/**
 * Phase 5A — repair-case procedure execution. Binds one repair case to one
 * exact, immutable PUBLISHED procedure_templates.id and lets an engineer
 * execute its nodes. See the Phase 5A plan for the full design rationale;
 * key points reflected in this schema:
 *
 *  - Reference-based binding only: procedure_case_executions.procedure_template_id
 *    and procedure_case_execution_nodes.procedure_template_node_id point at
 *    the exact immutable template/node rows — never copied content (no
 *    title/instructions/edges/checklist/troubleshooting duplication).
 *  - Deliberately trimmed enums: no FAILED/IMPOSSIBLE/CANCELLED node status,
 *    no EXECUTION_COMPLETED/EXECUTION_ABANDONED/NODE_FAILED/NODE_IMPOSSIBLE/
 *    NODE_CANCELLED action type, no reviewer/approval columns — all
 *    deferred until their exact behavior is approved in a later migration.
 *  - No execution-level status column: Phase 5A has no execution-completion
 *    or abandonment mutation, so `completed_at` stays a plain nullable
 *    column (always null in 5A) instead of adding a speculative enum.
 */
export const procedureCaseExecutionNodeStatusEnum = pgEnum("procedure_case_execution_node_status", [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "BLOCKED",
]);

/**
 * NODE_MEMO_UPDATED is the one action type beyond the originally-approved
 * set — the direct, non-speculative mechanism satisfying the work-memo
 * audit requirement (every memo change must be attributable and
 * reconstructable) — see the Phase 5A plan §9.
 */
export const procedureCaseExecutionActionTypeEnum = pgEnum("procedure_case_execution_action_type", [
  "EXECUTION_STARTED",
  "NODE_ADDED",
  "NODE_STARTED",
  "NODE_COMPLETED",
  "NODE_SKIPPED",
  "NODE_BLOCKED",
  "NODE_REOPENED",
  "NODE_MEMO_UPDATED",
]);

export const procedureCaseExecutions = pgTable(
  "procedure_case_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. This row (and
    // its child procedure_case_execution_nodes/procedure_case_execution_history
    // rows, neither of which reference repair_cases directly and are
    // therefore entirely unaffected by this column going NULL) represents
    // actual repair work performed and must outlive the case's own hard-
    // delete. Existing rows are untouched by this — only a future
    // repair_cases hard-delete ever nulls it. Multiple NULLs never collide
    // with the partial unique index below (Postgres unique indexes treat
    // every NULL as distinct). Same proven pattern as
    // repair_case_flowchart_edit_history.flowchart_id (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    // Phase 5C-5A — immutable snapshot of the bound template's category,
    // captured once at insert time by the mutation layer (never accepted
    // from the client, never independently chosen — always derived from
    // the live procedure_templates row the same transaction just locked
    // and verified PUBLISHED). Safe to snapshot permanently because a
    // template's category can never change after creation (no
    // conversion/switching UI exists or is planned — see
    // procedureTemplateCategoryEnum's own doc comment) and because a
    // PUBLISHED template's row is otherwise immutable already. This column
    // exists purely so the uniqueness index below can be category-aware
    // without a cross-table subquery, which Postgres partial unique
    // indexes cannot express.
    templateCategory: procedureTemplateCategoryEnum("template_category").notNull(),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    // Nullable, unused/always-null in Phase 5A — no execution-level
    // completion mutation exists yet. Kept as a plain column-add so a later
    // phase can start writing it without another migration for this table.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Optimistic concurrency token for the execution row itself (distinct
    // from each execution-node row's own version), same convention as
    // repair_cases.version.
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    // Phase 5C-5A — "one active execution per case" now applies only to
    // FULL_SERVICE (matching Phase 5A's original behavior exactly, since
    // every template that could ever be executed before this phase was
    // FULL_SERVICE-equivalent). TECHNICAL_TASK deliberately allows
    // multiple concurrent non-deleted rows per case — see
    // procedureTemplateCategoryEnum's own doc comment. Same partial-unique-
    // index technique DATABASE_DESIGN.md §7 already documents for
    // workflow_versions' "one active PUBLISHED version per template" rule
    // — not a new pattern.
    uniqueIndex("procedure_case_executions_one_active_full_service_per_case")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false and template_category = 'FULL_SERVICE'`),
    // Defense-in-depth: startProcedureExecution already unconditionally
    // rejects any is_reference_only template before this table is ever
    // written to (TEMPLATE_NOT_EXECUTABLE), and the CHECK on
    // procedure_templates ties REFERENCE to is_reference_only=true, so a
    // REFERENCE row can never legitimately reach this insert — this CHECK
    // costs nothing and closes the gap permanently at the DB level too, in
    // case a future code path ever forgets the application-layer check.
    check("procedure_case_executions_no_reference_execution", sql`template_category <> 'REFERENCE'`),
    index("procedure_case_executions_repair_case_id_idx").on(table.repairCaseId),
    index("procedure_case_executions_procedure_template_id_idx").on(table.procedureTemplateId),
  ]
);

export const procedureCaseExecutionNodes = pgTable(
  "procedure_case_execution_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => procedureCaseExecutions.id, { onDelete: "restrict" }),
    // Null means a case-specific extra task (no template counterpart) —
    // see extra_task_title/extra_task_instructions below.
    procedureTemplateNodeId: uuid("procedure_template_node_id").references(() => procedureTemplateNodes.id, {
      onDelete: "restrict",
    }),
    extraTaskTitle: text("extra_task_title"),
    extraTaskInstructions: text("extra_task_instructions"),
    /**
     * 추가 작업의 **노드 갈래**(2026-11-03, 조각 13). 템플릿에서 온 줄은 비어
     * 있고, 사례별 추가 작업일 때만 찬다 — 갈래를 읽는 쪽은 언제나
     * `템플릿 노드의 node_type ?? 이 칸` 차례로 본다.
     *
     * 🔴 **새 enum 을 만들지 않았다.** 절차 노드가 쓰는 그 enum
     * (procedure_template_node_type)을 그대로 재사용한다 — 화면에 적히는 이름도
     * (procedureNodeTypeLabels), 판단 노드인지 가리는 잣대도 한 벌이어야 한다.
     * 두 벌이 되면 같은 「판단」이 자리마다 다른 값으로 적히고, 그 어긋남은
     * 타입이 같아서 컴파일러가 아무 말도 안 한다.
     *
     * 🔵 비울 수 있게 둔 까닭: 이 칸이 생기기 전에 등록된 추가 작업이 그대로
     * 남아 있다(개발 DB 실측 기준으로도 몇 줄 있다). 기본값을 박아 채우면
     * 「사람이 고른 갈래」와 「시스템이 채운 값」이 영영 안 갈린다 — 비어 있는
     * 것이 곧 「갈래를 안 고르고 만든 옛 줄」이라는 사실이다.
     *
     * 🔴 쓰기 쪽은 START·DOCUMENT_REFERENCE 를 **거절한다**(쓸 수 있는 갈래는
     * EXTRA_TASK_NODE_TYPE_CODES 다). START 는 시스템이 자동으로 관리하는
     * 표식이고(assertNotSystemEntryNode), 참고 문서는 애초에 실행 행이 안 생기는
     * 갈래라 실행 행을 가진 참고 문서는 그 자체로 앞뒤가 안 맞는다.
     */
    extraTaskNodeType: procedureNodeTypeEnum("extra_task_node_type"),
    status: procedureCaseExecutionNodeStatusEnum("status").notNull().default("PENDING"),
    // DECISION nodes only — the edge the engineer chose when completing
    // this node. Must belong to the same template and originate from this
    // node (enforced at the mutation layer, same app-level-only-constraint
    // convention used throughout this codebase for cross-table rules).
    selectedOutgoingEdgeId: uuid("selected_outgoing_edge_id").references(() => procedureTemplateEdges.id, {
      onDelete: "restrict",
    }),
    // Node-specific assignment override — null means "use the case's
    // assigned engineer" (coalesce at read time, never copied). The only
    // Phase 5A write path is a self-claim on start.
    assignedEngineerId: uuid("assigned_engineer_id").references(() => users.id, { onDelete: "restrict" }),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Mutated only via updateExecutionNodeMemo, which also writes a
    // NODE_MEMO_UPDATED history row in the same transaction — this column
    // alone is not the audit trail, procedure_case_execution_history is.
    workMemo: text("work_memo"),
    lastActionReason: text("last_action_reason"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * 소프트 삭제 4컬럼 (DATABASE_DESIGN.md #8) — **추가 작업을 치우는 길**
     * (2026-11-03, 조각 13). 쓰기 쪽은 `procedure_template_node_id` 가 비어 있는
     * 줄(= 이 건에서 더한 작업)만 치운다. 템플릿에서 온 줄은 거절한다.
     *
     * ──────────────────────────────────────────────────────────────────
     * 🔴 왜 **진짜 삭제(DELETE)가 아닌가** — 그 길이 DB 에서 막혀 있다
     * ──────────────────────────────────────────────────────────────────
     * procedure_case_execution_history.execution_node_id 가 이 표를
     * `ON DELETE restrict` 로 가리킨다. 추가 작업은 만들어지는 순간
     * NODE_ADDED 이력 한 줄을 갖게 되므로(addExecutionExtraTask), **이력이 있는
     * 한 행을 지울 수 없다.** 지우려면 그 이력 줄을 먼저 지우거나 가리키는 곳을
     * 비워야 하는데, 둘 다 덧붙이기만 하는 감사 기록을 손대는 일이라 이
     * 저장소에서 하지 않는 일이다.
     *
     * 그래서 「치운다」를 행이 사라지는 일이 아니라 **안 보이게 하는 일**로
     * 적는다 — procedure_case_executions 가 [실행 그만두기]에 쓰는 것과 같은
     * 네 칸, 같은 규약이다.
     *
     * 🔴 **읽는 자리마다 걸러야 한다.** 이 네 칸은 WHERE 를 안 붙여도 아무
     * 오류를 내지 않으므로, 빠뜨리면 「지웠는데 그대로 있다」로만 드러난다.
     * 지금 거르는 자리는 여섯이다 — getExecutionDetail · getOtherExecutionsForCase ·
     * loadExecutionNodeOrFail · assessExecutionFinish 가 읽는 상태 목록 ·
     * 옮기기의 형제 조회 · 자동 전진의 형제 조회. 사람 배정 영향 조회
     * (user-deletion-impact · user-deletion)도 같은 잣대로 거른다.
     */
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    check(
      "procedure_case_execution_nodes_extra_task_needs_title",
      sql`${table.procedureTemplateNodeId} is not null or ${table.extraTaskTitle} is not null`
    ),
    uniqueIndex("procedure_case_execution_nodes_one_per_template_node")
      .on(table.executionId, table.procedureTemplateNodeId)
      .where(sql`procedure_template_node_id is not null`),
    index("procedure_case_execution_nodes_execution_id_idx").on(table.executionId),
    index("procedure_case_execution_nodes_status_idx").on(table.executionId, table.status),
  ]
);

/**
 * 이 **수리 건 하나**에서만 쓰는 간선(2026-11-03, 조각 13) — 「추가 작업 등록」
 * 창에서 사람이 그은 선이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 원본 절차는 한 글자도 안 바뀐다
 * ──────────────────────────────────────────────────────────────────────
 * 실행 중에 「이 작업 다음에 이것도 한다」가 생기는 것은 **그 건의 사정**이지
 * 절차 자체가 바뀐 것이 아니다. procedure_template_edges 에 쓰면 게시된 절차가
 * 바뀌어 **이미 돌고 있는 다른 건들**과 앞으로 시작할 모든 건이 함께 바뀐다 —
 * 게시된 절차의 노드·간선은 읽기 전용이라는 이 묶음의 규약(procedure_template_
 * nodes 머리말)과도 정면으로 어긋난다. 그래서 같은 모양의 표를 **실행 쪽에**
 * 따로 둔다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 칸 이름을 원본 간선 표에 맞춘다
 * ──────────────────────────────────────────────────────────────────────
 * from_node_id · to_node_id · branch_type · branch_label · sort_order 는
 * procedure_template_edges 와 **같은 이름**이다. 같은 뜻의 칸에 다른 이름을
 * 붙이면 두 표를 한 목록으로 합쳐 읽는 쪽(getExecutionDetail)이 칸마다 짝을
 * 다시 적어야 하고, 읽는 사람은 둘을 서로 다른 것으로 본다.
 *
 * 🔴 **다른 것이 하나 있다 — 양끝이 가리키는 표.** 원본은
 * procedure_template_nodes 를 가리키고, 여기는 procedure_case_execution_nodes
 * 를 가리킨다. 실행 노드여야 하는 까닭: 이 선이 이어 붙이는 「추가 작업」에는
 * 애초에 템플릿 노드가 없다. 양끝을 실행 노드로 두면 템플릿에서 온 작업과 더한
 * 작업을 **가리지 않고** 이을 수 있다.
 *
 * 🔵 branch_type·branch_label 은 **판단 노드용**이다. 판단이 아닌 작업에서
 * 나가는 선은 DEFAULT 한 줄이면 되고, 판단이면 「정상 / NG」처럼 갈래마다
 * 한 줄씩 긋는다 — 원본 절차의 쓰임과 같다.
 *
 * 🔴 condition_definition · source_connector_id · cloned_from_edge_id ·
 * user_route_points 는 **일부러 안 가져왔다.** 넷 다 원본 쪽의 사정이다
 * (엑셀에서 들여온 도형 연결자 · 판본 복제 추적 · 편집기에서 손으로 끈 경로점).
 * 실행 중에 그은 선에는 그런 것이 생길 길이 없고, 안 쓰는 칸을 미리 만들어
 * 두면 나중에 「이건 왜 늘 비어 있지」가 된다.
 *
 * 🔴 지우는 것은 **소프트 삭제**다 — 같은 창에서 「연결 제거」를 누르면
 * is_deleted 가 선다. 행을 지워도 되는 표이기는 하지만(이 표를 가리키는 곳이
 * 없다), 노드 쪽이 감사 이력 때문에 소프트 삭제인데 선만 진짜로 사라지면
 * 「그때 무엇이 이어져 있었나」를 되짚는 잣대가 한 창 안에서 둘이 된다.
 */
export const procedureCaseExecutionEdges = pgTable(
  "procedure_case_execution_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => procedureCaseExecutions.id, { onDelete: "restrict" }),
    // 🔴 procedure_case_execution_nodes.id 다 — 원본 간선 표의 같은 이름 칸이
    // 가리키는 procedure_template_nodes 가 아니다(위 머리말).
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => procedureCaseExecutionNodes.id, { onDelete: "restrict" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => procedureCaseExecutionNodes.id, { onDelete: "restrict" }),
    branchType: procedureBranchTypeEnum("branch_type").notNull(),
    branchLabel: text("branch_label"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // 소프트 삭제 4컬럼 (DATABASE_DESIGN.md #8) — 위 머리말의 까닭.
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    // 자기 자신으로 가는 선은 원본 편집기도 막는다(CreateEdgePanel 의 「자기
    // 자신으로의 분기는 지원하지 않습니다」). 쓰기 쪽이 먼저 거절하지만, 그
    // 검사를 잊는 길이 생겨도 여기서 한 번 더 막힌다.
    //
    // 🔴 글자를 템플릿 문자열 **안에** 적는다. 상수를 `${}` 자리로 끼우면
    // drizzle 이 바인딩 자리($1)로 구워서, 돌릴 수 없는 CHECK 가 만들어진다
    // (procedure_case_executions_no_reference_execution 이 같은 모양이다).
    check("procedure_case_execution_edges_no_self_loop", sql`from_node_id <> to_node_id`),
    index("procedure_case_execution_edges_execution_id_idx").on(table.executionId),
    index("procedure_case_execution_edges_from_node_id_idx").on(table.fromNodeId),
    index("procedure_case_execution_edges_to_node_id_idx").on(table.toNodeId),
  ]
);

export const procedureCaseExecutionHistory = pgTable(
  "procedure_case_execution_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => procedureCaseExecutions.id, { onDelete: "restrict" }),
    // Null for execution-level actions (EXECUTION_STARTED) — non-null for a
    // single node-scoped action.
    executionNodeId: uuid("execution_node_id").references(() => procedureCaseExecutionNodes.id, {
      onDelete: "restrict",
    }),
    actionType: procedureCaseExecutionActionTypeEnum("action_type").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("procedure_case_execution_history_execution_id_idx").on(table.executionId),
    index("procedure_case_execution_history_execution_node_id_idx").on(table.executionNodeId),
  ]
);
