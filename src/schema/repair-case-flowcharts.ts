import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * Phase 5C-6A — a repair case's own engineer-authored diagnostic/work
 * flowcharts ("what did the engineer actually inspect, conclude, and do on
 * THIS specific case?"). Deliberately independent of procedure_templates:
 * this table, repair_case_flowchart_nodes/edges, and
 * repair_case_flowchart_edit_history own their data completely separately
 * from the procedure-template graph-editor tables — editing a case
 * flowchart must never be able to reach a TECHNICAL_TASK/FULL_SERVICE
 * template row. The Graph Editor Core (GraphCanvas + graph-editor-core lib)
 * is reused at the UI/algorithm level in a later checkpoint; no storage is
 * shared here.
 *
 * One repair case may own multiple flowcharts (e.g. "초기 진단", "RF 출력
 * 없음 진단", "최종 원인 분석") — repairCaseId is a plain FK, not unique.
 *
 * Soft-delete only applies at this table's level (whole-flowchart
 * lifecycle) — see repair-case-flowchart-nodes.ts/-edges.ts for why
 * individual nodes/edges are hard-deleted instead.
 */
export const repairCaseFlowcharts = pgTable(
  "repair_case_flowcharts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    // 고장 개소 태그(2026-11-19) — 「#우내, #우외」처럼 적어 두는 **값**이다.
    // 미리 정해 둔 목록이 아니라 적는 대로 생기므로 enum 도 마스터 표도 두지
    // 않는다. 같은 파일 묶음의 repair_case_flowchart_edges.route_points 와 같은
    // jsonb 쓰임 — 배열 하나가 통째로 한 칸의 값이고, 쪼개 조회할 일이 없다.
    //
    // 🔴 NULL 을 허용한다. 칸이 생기기 전에 만들어진 줄을 손대지 않는 편이
    // 안전하고(값을 채우는 마이그레이션이 없다), 읽는 쪽은 `?? []` 로 받는다.
    // 그래서 「아직 한 번도 안 적음(NULL)」과 「적었다 지움([])」이 값으로는
    // 갈리지만, 뜻은 둘 다 「태그 없음」으로만 쓴다.
    faultTags: jsonb("fault_tags").$type<string[]>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Last mutator — distinct from createdBy since a case's flowchart may be
    // edited by more than one assigned engineer over time.
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Optimistic-concurrency token for node/edge mutations, same convention
    // as procedure_templates.updated_at + touchTemplate: every node/edge
    // write under this flowchart must bump this column in the same
    // transaction (implemented in a later checkpoint's mutation layer).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8), same as
    // customers/end_users. A soft-deleted flowchart's nodes/edges/history
    // rows are never touched by this — they remain exactly as they were.
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("repair_case_flowcharts_repair_case_id_idx").on(table.repairCaseId),
    index("repair_case_flowcharts_repair_case_id_not_deleted_idx")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false`),
  ]
);
