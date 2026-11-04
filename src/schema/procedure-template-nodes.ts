import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { procedureTemplates } from "./procedure-templates";

/**
 * Closed 9-value set per this task's brief. CHECKLIST is the single
 * container node a large cell-anchored inspection form (e.g. (MB) 외관 및
 * 내부 검사) imports into — its sub-sections/items live in
 * procedure_checklist_sections/items, not as separate nodes.
 * TROUBLESHOOTING plays the same container role for a symptom matrix (e.g.
 * (MB) 수리) — see procedure_troubleshooting_entries. Escalation-to-
 * manufacturer nodes (Phase 1 report §2) are represented as an ordinary
 * CORRECTIVE_ACTION node — a distinct ESCALATION type was considered and
 * deliberately dropped to keep this enum matching exactly what this task
 * specified.
 */
export const procedureNodeTypeEnum = pgEnum("procedure_template_node_type", [
  "START",
  "TASK",
  "INSPECTION",
  "DECISION",
  "CORRECTIVE_ACTION",
  "CHECKLIST",
  "TROUBLESHOOTING",
  "DOCUMENT_REFERENCE",
  "END",
]);

/**
 * Immutable once the owning template is PUBLISHED/ARCHIVED — enforced by
 * the mutation layer (procedure-templates.ts), which re-checks the owning
 * template's status inside the same transaction before allowing any write
 * here, never trusting a UI-only guard.
 *
 * source_worksheet/source_shape_id/source_cell_range preserve exactly where
 * this node came from in the original workbook (this task's traceability
 * requirement) — populated for EXCEL_IMPORT templates, left null for
 * MANUAL ones.
 */
export const procedureTemplateNodes = pgTable(
  "procedure_template_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    // Stable within the template, independent of the DB id — e.g.
    // "sheet03-shape14". Uniqueness enforced below; the importer detects and
    // reports a collision as a "duplicate node code" validation issue
    // *before* attempting the insert (see the importer), so this index is a
    // defense-in-depth backstop, not the primary detection path.
    nodeCode: text("node_code").notNull(),
    nodeType: procedureNodeTypeEnum("node_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    objective: text("objective"),
    preparation: text("preparation"),
    toolsAndEquipment: text("tools_and_equipment"),
    safetyCaution: text("safety_caution"),
    instructions: text("instructions"),
    expectedNormalResult: text("expected_normal_result"),
    ngSymptoms: text("ng_symptoms"),
    recommendedCorrectiveAction: text("recommended_corrective_action"),
    acceptanceCriteria: text("acceptance_criteria"),
    workerMayAddNextTask: boolean("worker_may_add_next_task")
      .notNull()
      .default(true),
    /**
     * 2026-11-04 — END 노드에서 **다른 절차로 이어가기**(A/S 줄기 B ④).
     *
     * 🔴 비어 있는 것이 기본이고, 비어 있으면 지금까지와 한 치도 다르지 않게
     * 동작한다. 기존 END 행은 한 행도 안 바뀐다. 노드 종류 enum(위의 닫힌 9값)을
     * 늘리지 않으려고 칸으로 푼 것이다 — 열 번째 값을 더하면 갈래 수가 박힌
     * 코드·주석·시험 네 군데를 전부 따라 고쳐야 한다.
     *
     * 🔴 **담기는 값은 판 하나인데, 읽는 쪽은 계열로 푼다.** FK 가 걸려야 없는
     * 절차를 가리키는 일을 DB 가 막아 주므로 id 를 담는다. 그러나 실행할 때는
     * 이 id 를 그대로 열지 않고 그 행의 `code`(계열)를 읽어 **그 계열의 지금
     * 게시본**을 연다 — 절차는 계속 개정되고, 판을 콕 집어 두면 그 판이
     * [만료됨]으로 내려가는 날 이 절차를 가리키는 END 를 전부 손으로 다시
     * 지정해야 하기 때문이다. 푸는 규칙은 A/S 의
     * `src/lib/domain/procedure-next-procedure-link.ts` 한 곳에 있다.
     *
     * 🔴 END 가 **아닌** 노드에 값이 들어가면 안 된다. DB 는 그것을 막지 않는다 —
     * CHECK 로 적으면 drizzle 의 sql 템플릿이 상수를 바인딩 자리로 구워 돌릴 수
     * 없는 마이그레이션이 나온 전례가 있다. 막는 자리는 위 모듈과 쓰기 경로다.
     *
     * 🔴 `onDelete: "restrict"` 라서 **가리켜진 절차는 완전삭제가 거부된다.**
     * 그래서 A/S 의 삭제 판정(countProcedureTemplateReferences)이 이 칸을
     * **반드시 함께 세야** 한다 — 안 세면 휴지통에서 영영 안 사라지는 행이 생기고,
     * 오류도 안 나서 아무도 신고하지 않는다.
     */
    nextProcedureTemplateId: uuid("next_procedure_template_id").references(
      () => procedureTemplates.id,
      { onDelete: "restrict" }
    ),
    positionX: doublePrecision("position_x").notNull().default(0),
    positionY: doublePrecision("position_y").notNull().default(0),
    // Phase 4A editor — 사용자 배치 (user layout) override, entirely separate
    // from position_x/position_y so the original source-imported (or
    // parent-version-cloned) coordinates are never overwritten. Null means
    // "never repositioned by a reviewer yet"; a node with a null override
    // always falls back to position_x/position_y for rendering. Only ever
    // written by the editor's explicit "저장" (save layout) action — never
    // on every pointer movement, and never backfilled for existing nodes.
    userPositionX: doublePrecision("user_position_x"),
    userPositionY: doublePrecision("user_position_y"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceWorksheet: text("source_worksheet"),
    sourceShapeId: text("source_shape_id"),
    sourceCellRange: text("source_cell_range"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("procedure_template_nodes_template_code_unique").on(
      table.procedureTemplateId,
      table.nodeCode
    ),
    index("procedure_template_nodes_template_id_idx").on(
      table.procedureTemplateId
    ),
    // 🔴 역방향으로 센다 — "이 절차를 가리키는 END 가 있는가"를 삭제 판정이
    //    매번 물어야 하는데, 그 조회는 이 칸을 **조건**으로 쓴다(위 칸 주석).
    //    대부분의 행이 null 이라 부분 인덱스로 둔다.
    index("procedure_template_nodes_next_template_idx")
      .on(table.nextProcedureTemplateId)
      .where(sql`${table.nextProcedureTemplateId} IS NOT NULL`),
  ]
);
