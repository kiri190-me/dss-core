/**
 * ============================================================================
 * 견적서 목록 한 줄의 모양 — 두 사이트가 **같은 글자로** 본다
 * ============================================================================
 * A/S 관리 시스템과 PO/내자 시스템은 같은 `dss_as` 의 `quotes` 를 본다. 목록
 * 화면이 한 벌(./QuoteListScreen.tsx)이므로, **그 화면이 받는 줄의 모양**도 한
 * 벌이어야 한다 — 두 사이트의 조회가 각자 제 타입을 들고 있으면 한쪽만 칸이
 * 늘거나 이름이 바뀐 날 컴파일러가 아무 말도 하지 않는다.
 *
 * 🔴 **여기에는 조회가 없다.** 값을 실제로 읽어 오는 일(`listQuotes` ·
 * `listDeletedQuotes`)은 각 사이트가 갖는다 — 이 묶음은 DB 에 접속하지 않는다
 * (../../index.ts 머리말). 여기 있는 것은 **읽어 온 값의 모양**과 화면이 그것을
 * 글자로 바꾸는 규칙뿐이다.
 *
 * ⚠️ 조각 4 전까지 **A/S 는 제 파일을 계속 쓴다**(저쪽
 * `src/lib/db/queries/quotes.ts` 의 같은 이름 타입). 두 벌이 잠깐 공존하는
 * 까닭은 ./QuoteListScreen.tsx 머리말에 적어 두었다.
 * ============================================================================
 */

/**
 * ============================================================================
 * DB 에 들어 있을 수 있는 견적서 종류
 * ============================================================================
 * 🔴 `../../schema/quotes.ts` 의 `quoteKindEnum` 과 **같은 셋이어야 한다.**
 * 저쪽을 직접 읽지 않는 까닭은 하나다 — 그 파일은 drizzle 의 pg-core 를 끌고
 * 오고, 이 파일은 **브라우저 묶음에 실리는** 화면이 쓴다. 표 정의를 화면 묶음에
 * 실어 보낼 이유가 없다.
 *
 * 그래서 값이 갈라질 수 있다. 갈라지지 않게 지키는 자리는 가져다 쓰는 사이트의
 * 시험이다(dss-po 의 `src/lib/validation/quote-input.ts` 가 이 목록을 그대로
 * 재수출하고, 그 사이트의 시험이 스키마 이넘과 맞춰 본다).
 *
 * 🔴 앱이 **다루는** 종류(QUOTE_KINDS — 새 견적서 팝업·수정 화면이 고르게 하는
 * 것)와는 다른 목록이다. 여기 있는 것은 **DB 가 내줄 수 있는 것 전부**다. 목록은
 * 있는 것을 보여 주는 자리라, 앱이 아직 다루지 못하는 종류를 만나도 둘 중 하나로
 * 접지 않는다 — 접으면 그 견적서가 남의 딱지를 달고 목록에 앉는다.
 * ============================================================================
 */
export const STORED_QUOTE_KINDS = ["DOMESTIC", "OVERHAUL", "CABLE"] as const;
export type StoredQuoteKind = (typeof STORED_QUOTE_KINDS)[number];

/**
 * 종류마다의 이름표. **DB 에 있을 수 있는 값을 전부 덮는다**(Record<StoredQuoteKind>) —
 * 목록이 읽어 온 값을 그대로 그리기 때문이다. 이름이 없으면 그 줄을 「종류를 알 수
 * 없음」으로 그리거나 둘 중 하나로 접어야 한다.
 */
export const quoteKindLabels: Record<StoredQuoteKind, string> = {
  DOMESTIC: "내자 견적서",
  OVERHAUL: "OH 견적서",
  CABLE: "케이블 견적서",
};

/**
 * 목록 한 줄. 🔴 **글자 하나까지 A/S 의 `QuoteListItem` 과 같다** — 같은 표를
 * 읽는 두 조회가 같은 모양을 내놓아야 한 화면이 둘을 함께 받을 수 있다.
 */
export type QuoteListItem = {
  id: string;
  /**
   * 🔴 **DB 가 내주는 값을 그대로 받는다**(StoredQuoteKind — 앱이 다루는 QuoteKind 가
   * 아니다). 위 STORED_QUOTE_KINDS 머리말 참조.
   */
  kind: StoredQuoteKind;
  /** 수정 폼이 저장할 때 되돌려 보낼 값. 목록에 그리지는 않는다(휴지통 조작도 이 값을 댄다). */
  version: number;
  quoteNumber: string;
  quoteDate: string;
  customerName: string;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  faultDescription: string | null;
  subject: string;
  /**
   * 접수 건으로 건너가는 링크. 연결이 없으면 null 이고, 그때는
   * intakeNumberText 만 글자로 남는다.
   */
  repairCaseId: string | null;
  intakeNumber: string | null;
  /** 목록 한 줄. 서버에서 만들어 내려보낸다 — 검색이 붙어도 같은 문자열을 본다. */
  summaryLine: string;
  /**
   * 공급가(부가세 별도). 일반 견적서는 부품 줄 합 + 작업비, **엑셀 전용 견적서는 손으로
   * 적은 공급가액**이다(2026-09-15 Q2).
   *
   * `null` 은 「금액을 알 수 없다」— 엑셀 전용인데 공급가액이 비어 있는 장이다(검증이 필수로
   * 받아 정상 경로로는 생기지 않는다). 화면은 「—」로 그린다. 0 으로 접지 않는다 — 0 은
   * 「무상 견적」이라는 실제 값이다.
   */
  supplyAmount: number | null;
  itemCount: number;
  /** 엑셀 전용 견적서인가(2026-09-15 Q2) — 품목 없이 손으로 만든 엑셀이 곧 보낸 문서다. */
  isExcelOnly: boolean;
  /**
   * 결재 PDF 칸 · 수기 엑셀 칸에 지금 파일이 붙어 있는가(휴지통 것은 세지 않는다).
   *
   * ⚠️ 이 두 값은 **첨부 조각(3d)이 오기 전에도** 줄에 실린다 — 화면의 파일 표시
   * 슬롯(renderFileBadges)이 쓴다. 슬롯을 넘기지 않은 사이트에서는 값이 실려 오되
   * 그려지지 않는다.
   */
  hasSignedPdf: boolean;
  hasExcel: boolean;
};

/**
 * 휴지통 한 줄. 🔴 A/S 의 `DeletedQuoteRow` 와 같다.
 *
 * 부품 줄을 읽지 않는다 — 휴지통은 "무엇을 지웠는가"를 알아보고 되살리는 자리라
 * 금액까지 필요하지 않고, 목록 한 줄이면 어느 견적서인지 가려진다.
 */
export type DeletedQuoteRow = {
  id: string;
  version: number;
  quoteNumber: string;
  quoteDate: string;
  summaryLine: string;
  subject: string;
  deletedAt: string | null;
  deleteReason: string | null;
};

/**
 * 금액 옆의 곁말 — 「수기 공급가액」이냐 「n품목」이냐.
 *
 * 🔴 A/S 에서는 이 두 줄이 `components/quotes/quote-attachment-files.ts`(489줄) 안에
 * 있다. 그 파일은 첨부 조회 · 이미지 축소 · 칸 교체까지 들고 있어 **첨부 조각(3d)의
 * 것**이고, 목록이 그것을 끌고 오면 조각 하나가 통째로 따라온다. 목록이 실제로 쓰는
 * 것은 이 두 줄뿐이라 여기로 옮겨 적었다 — 조각 3d 에서 저 파일이 올 때 **이 함수를
 * 다시 만들지 말고 여기 것을 부를 것.**
 */
export function quoteListAmountNote(row: { isExcelOnly: boolean; itemCount: number }): string {
  return row.isExcelOnly ? "수기 공급가액" : `${row.itemCount}품목`;
}
