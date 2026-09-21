"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
// 🔴 별칭(@/…)을 쓰지 않는다 — 가져다 쓰는 사이트마다 다르게 설정되어 있다
//    (../../../tsconfig.json 머리말). 형제 파일은 상대 경로로만 부른다.
import { LIST_CARD_GRID, ResponsiveList } from "../common/responsive-list";
import {
  MasterDataDeleteDialog,
  MasterDataPermanentDeleteDialog,
  MasterDataRestoreDialog,
} from "../common/master-data-trash-dialogs";
import MasterDataTrashRetentionBadge from "../common/master-data-trash-retention-badge";
import { MASTER_DATA_TRASH_RETENTION_DAYS } from "../common/master-data-trash-retention";
import {
  quoteKindLabels,
  quoteListAmountNote,
  type DeletedQuoteRow,
  type QuoteListItem,
} from "./quote-list-rows";

/**
 * ============================================================================
 * 견적서 목록 — 🔴 **두 사이트가 한 벌을 나눠 쓴다**
 * ============================================================================
 * 한 줄이 견적서 한 장이다. 같은 모델에서 여러 장이 나오므로(재견적·항목 조정)
 * 번호만으로도 모델명만으로도 어느 것인지 알 수 없고, 그래서 목록의 첫 칸이
 * **여섯을 붙인 한 줄**이다:
 *
 *     DSS 2026-077 ICD CFK300FH-IC2 WU8042 1612027 Bias Fwd Drop 발생
 *
 * 그 문자열은 여기서 만들지 않는다 — 서버가 조회하면서 만들어 내려보낸다
 * (각 사이트의 domain/quote-list.ts 의 buildQuoteSummaryLine). 검색을 붙이면 그
 * 대상도 같은 문자열이어야 하고, 표와 카드가 각자 join 하면 언젠가 한 곳만 순서가
 * 달라진다. ⚠️ 그 순서에서 **L/N 이 S/N 보다 앞**이다. 값 모양으로 짐작하지 말 것.
 *
 * ── 🔴 왜 이 화면이 공용 묶음(@dss/core)에 있나 ─────────────────────────
 * 이 화면을 **두 곳**이 그린다 — PO/내자 사이트의 [견적서] 목록과, A/S 관리
 * 시스템의 수리 건 상세 [견적서] 탭. 복사본을 두면 「금액·요약 줄이 갈라지는 날」이
 * 오고, 그날 사람은 같은 견적서의 **다른 금액**을 두 화면에서 보게 된다. 그 차이는
 * 한참 뒤에 드러난다(설계서 PO_DOMESTIC_SPLIT_DESIGN.md F절 5번).
 *
 * ── ⚠️ 지금은 두 벌이 잠깐 공존한다 ─────────────────────────────────────
 * 🔴 **A/S 는 아직 제 파일을 쓴다**(저쪽 `src/components/quotes/QuoteListScreen.tsx`).
 * 이 파일은 그것을 옮겨 온 것이고, 지금 부르는 쪽은 PO/내자 사이트 하나뿐이다.
 * A/S 를 이쪽으로 돌리는 것은 **조각 4(A/S 정리)**의 일이다 — 한 번에 둘을 바꾸면
 * 되돌릴 자리가 없어서, 새 사이트에서 먼저 돌려 보고 옮기기로 했다.
 * 그때까지 저쪽 파일을 고치면 이 파일도 함께 고칠 것. 조각 4 가 끝나면 저쪽
 * 파일은 **지워진다**(이 문단도 함께 지운다).
 *
 * ── 🔴 사이트마다 다른 것은 **슬롯**으로 받는다 ─────────────────────────
 * 이 화면은 원래 발행(`QuoteIssueButton`) · 첨부 표시(`QuoteFileBadges`) ·
 * 미리보기 · [새 견적서] 팝업을 **직접 import** 했다. 그대로 옮기면 그 사슬이
 * 통째로 따라온다 — 실측 99파일 23,433줄이고, 그 안에 엑셀 4,400줄과 첨부·발행·
 * 인쇄가 전부 들어 있다(설계서 G절이 조각 3c~3f 로 나눠 둔 것들이다).
 *
 * 그래서 **끌고 오는 대신 자리를 비워 두었다.** 목록의 뼈대(검색 · 탭 · 표/카드 ·
 * 휴지통 · 금액과 요약 줄)는 여기 있고, 조각마다 붙는 것은 부르는 쪽이 넣는다:
 *
 *     newQuoteControl    머리의 [새 견적서]            → 조각 3b (편집 폼)
 *     renderFileBadges   줄의 파일 딱지               → 조각 3d (첨부)
 *     renderRowActions   줄의 [미리보기]·[견적서 받기] → 조각 3c·3f
 *     notice             화면 위 한 자리의 알림        → 조각 3c (받기 결과)
 *     rowHref            줄을 눌러 여는 곳            → 조각 3b (수정 화면)
 *     intakeHref         인수번호를 눌러 가는 곳       → A/S 의 수리 건 상세
 *
 * **넘기지 않으면 그 자리는 그려지지 않는다**(주소 둘은 글자만 남는다). 그래서
 * 아직 그 화면이 없는 사이트에서도 목록이 온전히 뜬다. 조각이 하나 도착할 때마다
 * 부르는 쪽에 한 줄을 더하면 된다 — **이 파일은 그때 손대지 않는다.**
 *
 * ⚠️ 슬롯을 **표와 카드 두 곳 모두**에 같은 값으로 건다. 한쪽만 바꾸면 창 폭에
 * 따라(ResponsiveList 가 재서 고른다) 보이는 것이 달라진다.
 *
 * ── 표/카드 전환 ────────────────────────────────────────────────────────
 * ResponsiveList 가 정한다 — 폭을 실제로 재서 고르고, 사람이 한 번이라도 고르면
 * 그 선택이 이긴다. 여기서 브레이크포인트를 따로 두지 않는다.
 *
 * `stickyHeader` 는 넘기지 않는다(기본 꺼짐). 켜려면 부르는 쪽이 확정 높이를
 * 가진 세로 flex 상자여야 하는데 이 화면은 아니다 — 내자 정리만 그 조건을
 * 만족한다.
 *
 * ── 검색은 요약 줄 하나로 한다 ──────────────────────────────────────────
 * 칸별 필터를 두지 않았다. 사람이 찾는 방식이 "WU8042 짜리 그거"이지 "L/N 칸에
 * WU8042"가 아니고, 요약 줄에 이미 여섯이 다 들어 있다. 품명(subject)까지 함께
 * 훑는 것은 그것이 목록에 보이는 값이기 때문이다 — 보이는데 안 걸리면 검색이
 * 고장난 것으로 읽힌다.
 * ============================================================================
 */

const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

// null 은 금액을 알 수 없는 엑셀 전용 견적서다(quote-list-rows.ts 의 supplyAmount — 2026-09-15 Q2).
function formatAmount(value: number | null): string {
  if (value === null) return "—";
  return `₩${AMOUNT_FORMAT.format(Math.round(value))}`;
}

function formatDate(isoDate: string): string {
  // quote_date 는 date 칼럼이라 "2026-08-28" 꼴로 온다. new Date 로 돌리면
  // 시간대에 따라 하루가 밀리므로 글자를 그대로 나눈다.
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${year}. ${month}. ${day}.`;
}

/**
 * 휴지통의 세 조작 — 🔴 **부르는 쪽의 서버 액션을 받는다.**
 *
 * 이 묶음은 DB 에 접속하지 않는다(../../index.ts 머리말). 세션을 다시 읽고 권한을
 * 다시 보고 트랜잭션을 여는 일은 사이트의 몫이고, 여기는 그 결과(ok / message)만
 * 안다. 🔴 **화면이 감춘 것은 경계가 아니다** — 액션은 화면이 무엇을 그렸든
 * 상관없이 매번 처음부터 다시 검사한다.
 *
 * 🔴 두 사이트가 **같은 `dss_as` 를 본다.** 그래서 두 액션이 같은 일을 해야 한다 —
 * 견적서를 휴지통에 넣을 때 붙어 있던 결재 PDF · 수기 엑셀도 함께 가야 하고
 * (mutations/quote-trash.ts), 한쪽만 그것을 빠뜨리면 다른 쪽에서 되살린 견적서에
 * 파일이 따라오지 않는다.
 */
export type QuoteTrashActions = {
  deleteQuote: (input: {
    id: string;
    expectedVersion: number;
    reason: string | null;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  restoreQuote: (input: {
    id: string;
    expectedVersion: number;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  permanentlyDeleteQuote: (input: {
    id: string;
    expectedVersion: number;
    reason: string;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
};

export default function QuoteListScreen({
  rows,
  trashRows,
  canEdit,
  canDelete,
  trashActions,
  emptyMessage = "아직 만든 견적서가 없습니다.",
  rowHref,
  intakeHref,
  newQuoteControl = null,
  renderFileBadges,
  renderRowActions,
  notice = null,
}: {
  rows: QuoteListItem[];
  /** 휴지통. 지울 수 없는 사람에게는 빈 배열이 온다 — 못 여는 탭의 내용을 실어 보내지 않는다. */
  trashRows: DeletedQuoteRow[];
  /**
   * 고칠 수 있는 사람인가. 지금 이 값이 정하는 것은 **머리의 [새 견적서] 자리를
   * 그릴지**뿐이다(newQuoteControl). 줄마다의 단추가 권한으로 갈리는 것은 그 단추를
   * 넣는 쪽이 정한다 — 그것이 조각마다 다르기 때문이다.
   */
  canEdit: boolean;
  /** 휴지통 탭과 줄마다의 [삭제]를 그릴지. */
  canDelete: boolean;
  trashActions: QuoteTrashActions;
  /** 한 장도 없을 때의 안내. 기본값이 지금까지의 그 문장이다. */
  emptyMessage?: string;
  /**
   * 줄(요약 줄)을 눌러 여는 곳. **넘기지 않거나 null 을 돌려주면 링크가 아니라
   * 글자만** 그린다 — 수정 화면이 아직 없는 사이트(조각 3b 전)에서 없는 주소로
   * 보내지 않기 위해서다.
   *
   * ⚠️ 표와 카드 **두 곳 모두** 이 함수로 주소를 만든다 — 한쪽만 바꾸면 창 폭에
   * 따라 가는 곳이 달라진다.
   */
  rowHref?: (row: QuoteListItem) => string | null;
  /**
   * 인수번호를 눌러 가는 곳(수리 건 상세). **넘기지 않거나 null 이면 글자만.**
   *
   * 🔴 수리 건 상세는 A/S 관리 시스템의 화면이다 — PO/내자 사이트에는 없다. 사이트를
   * 건너가는 링크를 이 화면이 제 손으로 지어내지 않는다(주소를 어디서 얻을지는 배포
   * 설정의 일이다). 그래서 **부르는 쪽이 알면 주고, 모르면 글자로 남는다.**
   */
  intakeHref?: (row: QuoteListItem) => string | null;
  /**
   * 머리의 [새 견적서] 자리. `canEdit` 일 때만 그린다. 단추와 그것이 여는 팝업의
   * 상태는 **넣는 쪽이 소유한다** — 팝업(NewQuoteDialog)이 편집 폼 조각(3b)의 것이라
   * 이 화면이 알 필요가 없다.
   */
  newQuoteControl?: ReactNode;
  /** 줄마다의 파일 딱지(엑셀 전용 · 결재 PDF · 엑셀 없음). 첨부 조각(3d)의 것이다. */
  renderFileBadges?: (row: QuoteListItem) => ReactNode;
  /** 줄마다의 단추([미리보기 · PDF] · [견적서 받기]). 인쇄·발행 조각(3c·3f)의 것이다. */
  renderRowActions?: (row: QuoteListItem) => ReactNode;
  /**
   * 화면 위 한 자리의 알림. [견적서 받기] 결과(조각 3c)가 여기에 뜬다 — 줄마다
   * 단추가 있어 결과를 단추 곁에 두면 표 칸이 늘고, 카드와 표가 서로 다른 자리에
   * 알리게 된다.
   */
  notice?: ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);

  /**
   * 확인 창은 이 저장소의 표준 창을 쓴다(../common/master-data-trash-dialogs).
   * 고객사·제품 모델·내자 정리가 쓰는 바로 그 창이라, 지우는 일의 생김새가 화면마다
   * 달라지지 않는다. 보관 문구(retentionNote)는 **넘기지 않는다** — 2026-09-11 부터
   * 견적서도 다른 휴지통과 같은 규칙(15일 보관 → 자동 완전 삭제)이라 기본 문장이
   * 사실이다(mutations/quote-trash.ts 머리말). 되살리기 창의 문장만 우리 것을
   * 넘긴다 — 기본 문장의 "접수·편집 화면에서 다시 고를 수 있다"는 견적서에 맞지 않는다.
   *
   * 창은 자기 상태를 갖지 않는다. 열림 여부·사유·전송 중·오류는 전부 여기가
   * 소유한다(그 파일의 원칙 그대로). 사유 칸 하나를 보내기 창과 완전 삭제 창이
   * 함께 쓴다 — 두 창은 동시에 열리지 않고, 열 때마다 비운다.
   */
  const [deleteTarget, setDeleteTarget] = useState<QuoteListItem | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DeletedQuoteRow | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<DeletedQuoteRow | null>(null);
  const [reason, setReason] = useState("");

  function openDelete(row: QuoteListItem) {
    setDeleteTarget(row);
    setReason("");
    setTrashError(null);
  }

  function openPurge(row: DeletedQuoteRow) {
    setPurgeTarget(row);
    setReason("");
    setTrashError(null);
  }

  // 앞선 조작(예: 실패한 완전 삭제)의 오류가 되살리기 창에 남아 보이지 않게 비운다.
  function openRestore(row: DeletedQuoteRow) {
    setRestoreTarget(row);
    setTrashError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    setTrashError(null);
    const result = await trashActions.deleteQuote({
      id: deleteTarget.id,
      expectedVersion: deleteTarget.version,
      reason: reason.trim() === "" ? null : reason.trim(),
    });
    setBusyId(null);
    if (!result.ok) {
      setTrashError(result.message);
      return;
    }
    setDeleteTarget(null);
    router.refresh();
  }

  async function confirmRestore() {
    if (!restoreTarget || busyId) return;
    setBusyId(restoreTarget.id);
    setTrashError(null);
    const result = await trashActions.restoreQuote({
      id: restoreTarget.id,
      expectedVersion: restoreTarget.version,
    });
    setBusyId(null);
    if (!result.ok) {
      setTrashError(result.message);
      return;
    }
    setRestoreTarget(null);
    router.refresh();
  }

  async function confirmPurge() {
    // 사유가 비어 있으면 창의 단추가 이미 꺼져 있다. 서버 액션도 다시 막는다.
    if (!purgeTarget || busyId || reason.trim() === "") return;
    setBusyId(purgeTarget.id);
    setTrashError(null);
    const result = await trashActions.permanentlyDeleteQuote({
      id: purgeTarget.id,
      expectedVersion: purgeTarget.version,
      reason: reason.trim(),
    });
    setBusyId(null);
    if (!result.ok) {
      setTrashError(result.message);
      return;
    }
    setPurgeTarget(null);
    router.refresh();
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter(
      (row) =>
        row.summaryLine.toLowerCase().includes(needle) ||
        row.subject.toLowerCase().includes(needle)
    );
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">견적서</h1>
        {/* [새 견적서] 자리. 🔴 넣는 쪽이 없으면 아무것도 그리지 않는다 — 없는 화면으로
            가는 단추를 세우지 않기 위해서다(파일 머리말의 '슬롯'). */}
        {canEdit && newQuoteControl}
      </div>

      {/* 탭 자체가 삭제 권한이 있는 세션에만 그려진다 — 볼 수 없는 휴지통의
          존재를 알릴 이유가 없다(고객사 관리와 같은 판단). */}
      {canDelete && (
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={
              tab === "active"
                ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }
          >
            사용중 ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("trash")}
            className={
              tab === "trash"
                ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }
          >
            휴지통 ({trashRows.length})
          </button>
        </div>
      )}

      {trashError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {trashError}
        </p>
      )}

      {/* 화면 위 한 자리의 알림([견적서 받기] 결과 등 — 파일 머리말의 '슬롯'). */}
      {notice}

      {tab === "trash" ? (
        <QuoteTrashList
          rows={trashRows}
          busyId={busyId}
          busyAction={busyId === null ? null : purgeTarget?.id === busyId ? "purge" : "restore"}
          onRestore={openRestore}
          onPermanentDelete={openPurge}
        />
      ) : (
      <>
      <label className="flex flex-col gap-1 text-xs">
        <span className="sr-only">견적서 검색</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="견적서번호 · 고객사 · 모델명 · L/N · S/N · 신고증상 · 품명"
          className="w-full max-w-xl rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {emptyMessage}
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          검색과 일치하는 견적서가 없습니다.
        </p>
      ) : (
        <ResponsiveList
          listId="quotes"
          meta={
            <span className="mr-auto text-xs text-zinc-500 dark:text-zinc-400">
              {filtered.length}건{filtered.length !== rows.length && ` / 전체 ${rows.length}건`}
            </span>
          }
          measureKey={[filtered.length, canEdit]}
          table={
            <QuoteTable
              rows={filtered}
              rowHref={rowHref}
              intakeHref={intakeHref}
              canDelete={canDelete}
              busyId={busyId}
              onDelete={openDelete}
              renderFileBadges={renderFileBadges}
              renderRowActions={renderRowActions}
            />
          }
          cards={
            <QuoteCardList
              rows={filtered}
              rowHref={rowHref}
              intakeHref={intakeHref}
              canDelete={canDelete}
              busyId={busyId}
              onDelete={openDelete}
              renderFileBadges={renderFileBadges}
              renderRowActions={renderRowActions}
            />
          }
        />
      )}
      </>
      )}

      <MasterDataDeleteDialog
        isOpen={deleteTarget !== null}
        entityLabel="견적서"
        names={deleteTarget ? [deleteTarget.summaryLine] : []}
        cascadeNote={
          <>
            휴지통에 있는 동안에는 견적서 파일도 나오지 않습니다. 부품 줄과 금액은 그대로 남고,
            되살리면 함께 돌아옵니다.
          </>
        }
        reason={reason}
        isSubmitting={busyId !== null}
        submitError={trashError}
        onReasonChange={setReason}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <MasterDataRestoreDialog
        isOpen={restoreTarget !== null}
        entityLabel="견적서"
        names={restoreTarget ? [restoreTarget.summaryLine] : []}
        restoreNote={<>복원하면 견적서 목록에 다시 나타나고, 견적서 파일도 다시 받을 수 있습니다.</>}
        cascadeNote={
          <>같은 발행번호의 견적서가 이미 있으면 되살릴 수 없습니다.</>
        }
        isSubmitting={busyId !== null}
        submitError={trashError}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setRestoreTarget(null)}
      />

      {/* 완전 삭제. 딸려 가는 것은 mutations/quote-trash.ts 머리말의 '딸린 것' 그대로다 —
          부품 줄·작업 내역·고른 수리 작업은 함께 지워지고(CASCADE), 내자 정리 줄은
          남아 연결만 풀린다(SET NULL). */}
      <MasterDataPermanentDeleteDialog
        isOpen={purgeTarget !== null}
        entityLabel="견적서"
        names={purgeTarget ? [purgeTarget.summaryLine] : []}
        cascadeNote={
          <>
            부품 줄 · 작업 내역 · 고른 수리 작업도 함께 지워집니다. 이 견적서를 연결해 둔 내자 정리 줄은
            지워지지 않고 연결만 풀립니다 — 그 줄에는 손으로 적어 둔 견적서번호 · 금액이 보입니다.
          </>
        }
        reason={reason}
        isSubmitting={busyId !== null}
        submitError={trashError}
        onReasonChange={setReason}
        onConfirm={() => void confirmPurge()}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>
  );
}

/**
 * 휴지통. 줄마다 보관 만료 배지와 [되살리기] · [완전 삭제] 가 선다 — 다른 휴지통
 * (고객사·내자 정리)과 같은 루틴이다(2026-09-11 사용자 결정, mutations/quote-trash.ts).
 * 누르면 공용 확인 창이 열리고(부르는 쪽이 소유한다), 브라우저 기본 확인창은 쓰지
 * 않는다.
 *
 * 배지는 지운 시각이 있을 때만 그린다 — 없는 줄은 정상 경로로는 생기지 않지만,
 * 지어낸 시각으로 배지를 그리면 거짓말이 된다(내자 정리 휴지통과 같은 판단).
 * 배지의 "만료됨"은 정리 스크립트가 다음 회차에 지울 대상이라는 뜻이다 — 둘이 같은
 * 판정 함수를 쓴다(../common/master-data-trash-retention-badge.tsx).
 */
function QuoteTrashList({
  rows,
  busyId,
  busyAction,
  onRestore,
  onPermanentDelete,
}: {
  rows: DeletedQuoteRow[];
  busyId: string | null;
  /** 지금 도는 조작이 무엇인가 — 단추 글자를 알맞게 바꾸려고 받는다. */
  busyAction: "restore" | "purge" | null;
  onRestore: (row: DeletedQuoteRow) => void;
  onPermanentDelete: (row: DeletedQuoteRow) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        삭제한 지 {MASTER_DATA_TRASH_RETENTION_DAYS}일이 지나면 자동으로 완전히 삭제됩니다. 그
        전에는 언제든 되살릴 수 있습니다.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          휴지통이 비어 있습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-zinc-900 dark:text-zinc-50">
                  <span>{row.summaryLine}</span>
                  {row.deletedAt !== null && <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {row.subject}
                  {row.deletedAt && ` · ${formatDeletedAt(row.deletedAt)} 삭제`}
                  {row.deleteReason && ` · 사유: ${row.deleteReason}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onRestore(row)}
                  disabled={busyId !== null}
                  className="rounded-md border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
                >
                  {busyId === row.id && busyAction === "restore" ? "되살리는 중…" : "되살리기"}
                </button>
                <button
                  type="button"
                  onClick={() => onPermanentDelete(row)}
                  disabled={busyId !== null}
                  className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                >
                  {busyId === row.id && busyAction === "purge" ? "완전 삭제 중…" : "완전 삭제"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDeletedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

type RowActionProps = {
  canDelete: boolean;
  busyId: string | null;
  onDelete: (row: QuoteListItem) => void;
};

/**
 * 조각마다 붙는 자리. ⚠️ 표와 카드 **두 곳 모두** 같은 값을 받는다 — 한쪽만 넘기면
 * 창 폭에 따라(ResponsiveList) 보이는 것이 달라진다.
 */
type RowSlotProps = {
  renderFileBadges?: (row: QuoteListItem) => ReactNode;
  renderRowActions?: (row: QuoteListItem) => ReactNode;
};

/** 줄 링크·인수번호 링크가 갈 곳. 위 QuoteListScreen 의 같은 이름 프롭 참조. */
type RowLinkProps = {
  rows: QuoteListItem[];
  rowHref?: (row: QuoteListItem) => string | null;
  intakeHref?: (row: QuoteListItem) => string | null;
};

function QuoteTable({
  rows,
  rowHref,
  intakeHref,
  canDelete,
  busyId,
  onDelete,
  renderFileBadges,
  renderRowActions,
}: RowLinkProps & RowActionProps & RowSlotProps) {
  return (
    <table className="w-full min-w-[56rem] border-collapse text-sm">
      <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        <tr>
          <th className="px-3 py-2 font-medium">발행일자</th>
          <th className="px-3 py-2 font-medium">견적서</th>
          <th className="px-3 py-2 font-medium">품명</th>
          <th className="px-3 py-2 font-medium">인수번호</th>
          <th className="px-3 py-2 text-right font-medium">공급가</th>
          <th className="px-3 py-2 font-medium"><span className="sr-only">견적서 파일</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className="border-t border-zinc-200 align-top dark:border-zinc-800"
          >
            <td className="whitespace-nowrap px-3 py-2 text-zinc-500 dark:text-zinc-400">
              {formatDate(row.quoteDate)}
            </td>
            <td className="px-3 py-2">
              <span className="flex flex-wrap items-center gap-1.5">
                <KindTag kind={row.kind} />
                {/* 엑셀 전용 · 결재 PDF · 엑셀 없음(2026-09-15 Q3) — 카드와 같은 슬롯이다. */}
                {renderFileBadges?.(row)}
                <SummaryLine row={row} rowHref={rowHref} className="font-medium" />
              </span>
            </td>
            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{row.subject}</td>
            <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-300">
              <IntakeLink row={row} intakeHref={intakeHref} />
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatAmount(row.supplyAmount)}
              <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">
                ({quoteListAmountNote(row)})
              </span>
            </td>
            <td className="whitespace-nowrap px-3 py-2">
              <div className="flex gap-1">
                {renderRowActions?.(row)}
                {canDelete && <DeleteButton row={row} busyId={busyId} onDelete={onDelete} />}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuoteCardList({
  rows,
  rowHref,
  intakeHref,
  canDelete,
  busyId,
  onDelete,
  renderFileBadges,
  renderRowActions,
}: RowLinkProps & RowActionProps & RowSlotProps) {
  return (
    <div className={LIST_CARD_GRID}>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <KindTag kind={row.kind} />
            {/* 표와 같은 슬롯 — 창 폭에 따라 표시가 달라지지 않게. flex-wrap 이라 좁으면 줄바꿈된다. */}
            {renderFileBadges?.(row)}
            <SummaryLine row={row} rowHref={rowHref} className="text-sm font-medium" />
          </span>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{row.subject}</p>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="flex gap-1">
              <dt>발행일자</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{formatDate(row.quoteDate)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>인수번호</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">
                <IntakeLink row={row} intakeHref={intakeHref} />
              </dd>
            </div>
          </dl>
          <p className="text-sm tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatAmount(row.supplyAmount)}
            <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">
              ({quoteListAmountNote(row)} · 부가세 별도)
            </span>
          </p>
          <div className="flex gap-1">
            {renderRowActions?.(row)}
            {canDelete && <DeleteButton row={row} busyId={busyId} onDelete={onDelete} />}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 요약 줄. **갈 곳을 아는 사이트에서만 링크가 된다** — 부르는 쪽이 `rowHref` 를
 * 넘기지 않았거나 null 을 돌려주면 같은 자리에 같은 글자를 링크 없이 그린다
 * (파일 머리말의 '슬롯'). 링크가 아닐 때 회색으로 죽이지 않는 까닭: 이 줄은 이
 * 목록에서 **어느 견적서인지 가리는 유일한 글자**라, 흐리면 목록을 못 읽는다.
 *
 * ⚠️ 표와 카드가 이 한 조각을 함께 쓴다. 두 곳이 각자 `<Link>` 를 적으면 언젠가
 * 한쪽만 주소가 바뀐다(A/S 에서 실제로 막으려던 그 고장이다).
 */
function SummaryLine({
  row,
  rowHref,
  className,
}: {
  row: QuoteListItem;
  rowHref?: (row: QuoteListItem) => string | null;
  className: string;
}) {
  const href = rowHref?.(row) ?? null;
  if (href === null) {
    return <span className={`${className} text-zinc-900 dark:text-zinc-50`}>{row.summaryLine}</span>;
  }
  return (
    <Link
      href={href}
      className={`${className} text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50`}
    >
      {row.summaryLine}
    </Link>
  );
}

function DeleteButton({
  row,
  busyId,
  onDelete,
}: {
  row: QuoteListItem;
  busyId: string | null;
  onDelete: (row: QuoteListItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onDelete(row)}
      disabled={busyId !== null}
      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      {busyId === row.id ? "지우는 중…" : "삭제"}
    </button>
  );
}

/** 내자인지 OH인지. 목록에서 두 종류가 섞여 보이므로 한눈에 갈려야 한다. */
function KindTag({ kind }: { kind: QuoteListItem["kind"] }) {
  const isOverhaul = kind === "OVERHAUL";
  return (
    <span
      className={
        isOverhaul
          ? "rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          : "rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      }
    >
      {quoteKindLabels[kind]}
    </span>
  );
}

/**
 * 연결이 살아 있고 **부르는 쪽이 갈 곳을 알면** 접수 건으로 건너가는 링크, 아니면
 * 글자만. 연결이 끊긴 장(접수 건을 영구 삭제한 경우)은 quotes.intake_number_text 에
 * 남은 번호를 보여 준다 — 사람이 보고 다시 이어 붙일 수 있는 유일한 단서다.
 */
function IntakeLink({
  row,
  intakeHref,
}: {
  row: QuoteListItem;
  intakeHref?: (row: QuoteListItem) => string | null;
}) {
  if (!row.intakeNumber) {
    return <span className="text-zinc-400 dark:text-zinc-500">—</span>;
  }
  if (!row.repairCaseId) {
    return <span title="연결된 접수 건이 없습니다">{row.intakeNumber}</span>;
  }
  const href = intakeHref?.(row) ?? null;
  if (href === null) {
    return <span>{row.intakeNumber}</span>;
  }
  return (
    <Link href={href} className="underline-offset-2 hover:underline">
      {row.intakeNumber}
    </Link>
  );
}
