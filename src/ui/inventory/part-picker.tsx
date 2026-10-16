"use client";

import type { PartPickerPriceRow, PartPickerRow } from "./part-picker-rows";
import {
  PART_FIELD_LABELS,
  partFieldEntries,
  partFieldValue,
  partFieldValueText,
} from "./part-picker-rows";
import { toPriceFieldValue } from "./part-price-field";

/**
 * ============================================================================
 * 품명 칸에서 부품 마스터를 찾아 고른다 (2026-09-17 사용자 요청)
 * ============================================================================
 * 「부품 비용」(케이블이면 「품목」) 표의 품명 칸은 지금까지 자유 글자였다. 부품
 * 마스터에 있는 부품도 사람이 이름을 다시 쳐야 했고, 그렇게 적힌 줄은 재고의 어느
 * 부품인지 시스템이 모른다(quote_items.part_id 가 NULL 로 남는다).
 *
 * ── 🔴 이 조각은 견적서 것이 아니다 ────────────────────────────────────────
 * 쓰는 화면이 둘이다 — 견적서 편집 폼의 「부품 비용」 표와, 수리 건 상세의 「사용
 * 부품」 칸. 로직에 견적서 종류도 양식도 `quote_items` 도 없다. 2026-09-22 에 A/S 의
 * `src/components/quotes/quote-part-picker.tsx` 에서 이 묶음으로 옮기고
 * `QuotePartSuggestionList` → `PartSuggestionList` 로 고쳤다 — A/S 안에만 두면
 * PO/내자가 같은 고르개를 붙이는 날 **사본이 생긴다**(README 53줄 부근의 그 위험).
 *
 * ── 🔴 **이 조각은 자료를 스스로 부르지 않는다** ────────────────────────────
 * 줄을 받아 거르고 그릴 뿐이다. 그 줄을 어디서 읽어 오는가는 **화면의 서버 쪽**이
 * 정한다 — 그래서 A/S 가 2026-10-16 에 제 부품 표에서 **재고 관리**(저쪽 API.md 2절)로
 * 갈아탈 때 이 파일은 거르는 칸 하나와 꼬리표만 늘었다. 부품 마스터를 재고 관리 하나로
 * 모으기로 한 2026-10-02 결정이 그 까닭이고, PO/내자는 아직 제 표에서 읽는다.
 *
 * ── 거르기는 **브라우저에서** 한다 ──────────────────────────────────────────
 * 부품 목록은 수백 줄 안쪽이다. 페이지가 목록을 통째로 한 번 내려보내고 여기서
 * 거른다 — 글자마다 서버를 부르면 느리고, 지운 글자만큼 응답이 엇갈려 도착한다.
 * 수리 건 상세의 부품 요청 칸(A/S components/inventory/PartRequestSection.tsx)이
 * 쓰는 방식 그대로다.
 *
 * ── 🔴 재고 · 소유구분 · 내부 비고는 여기 오지 않는다 ───────────────────────
 * 이 조각이 받는 줄(PartPickerRow)에는 그 칸이 **아예 없다.** 화면에서 안 그리는
 * 것으로는 모자란다 — 주는 쪽이 이미 실어 보낸 뒤이기 때문이다. 그래서 이 조각은
 * **id + 다섯 가지**(품명 · 품명2 · 고객사 품명 · 도번 · 교산 품번)만 안다. 떼어 내는
 * 자리는 주는 쪽이다 — A/S 는 받아 온 재고 관리의 부품에서 그 셋을 떼고 넘기고
 * (domain/inventory-gateway.ts 의 toPartPickerRows), PO/내자는 재고를 조인하지 않는
 * 가벼운 형제 조회를 따로 둔다.
 *
 * 단가도 같은 경계 안이다 — 「고르면 단가도 채운다」는 **단가만 담은 별도 목록**을 받고,
 * 그 목록에도 재고 · 소유구분 · 비고가 없다. 🔴 단가 칸이 **없는** 화면(수리 건의 사용
 * 부품)에는 그 목록을 아예 넘기지 않는다 — 금액이 나갈 자리가 아니다.
 *
 * ── 🔴 손으로 적는 길은 그대로다 ────────────────────────────────────────────
 * 마스터에 없는 부품 · 케이블 부속은 지금까지처럼 그냥 적으면 되고, 그 줄은 part_id
 * 없이 저장된다. 고른 값을 **어디에 적는지**는 폼이 정한다 — 제 표에서 읽는 사이트는
 * 고르면 붙이고 글자를 고치면 푼다(partId = null). 🔴 A/S 는 2026-10-16 부터 재고
 * 관리의 부품을 고르므로 **붙일 FK 가 없어** 언제나 비운다(partPickPatch 머리말).
 * ============================================================================
 */

/**
 * 한 번에 보여 줄 후보의 수. 목록을 다 뿌리면(글자 한 자에 수십 줄) 밑에 있는 줄을
 * 가려 버려 오히려 고르기 어렵다 — 좁혀 치라는 신호로 여기서 끊는다.
 */
export const MAX_PART_SUGGESTIONS = 8;

/**
 * ============================================================================
 * 고른 줄에 **어느 이름**을 적는가 — 🔴 쓰는 쪽이 정해 넘긴다 (2026-10-16)
 * ============================================================================
 * 이 고르개를 쓰는 화면이 셋이고, 그중 **견적서만** 고객사에 나간다. 2026-10-16 사용자
 * 요청은 「견적서에 노출되는 품명이 **고객사 품명**이 되게」였다 — 우리 품명과 고객사가
 * 부르는 이름이 다르기 때문이다.
 *
 * ── 🔴 그 사정을 이 조각 안에 박지 않는다 ──────────────────────────────────
 * 고르개는 PO/내자와 **한 벌**이다(이 파일 머리말). 「고객사 품명을 쓴다」를 여기 박으면
 * 그쪽이 포인터를 올리는 날 PO 의 품명이 통째로 바뀐다. 그래서 **무엇을 쓸지도, 막을지
 * 말지도 받는 값 하나**(`nameSource`)로 두고 **기본값은 지금까지 그대로**(`"part"`)다 —
 * 아무것도 넘기지 않는 사이트는 한 글자도 달라지지 않는다.
 *
 * ── 🔴 비어 있으면 **고를 수 없다**(견적서 쪽 결정) ────────────────────────
 * 고객사 품명이 없는 부품을 고르면 줄이 빈 이름으로 채워지거나, 우리 품명이 슬쩍 대신
 * 들어가 **고객사가 모르는 이름**이 서류에 찍힌다. 둘 다 아무도 눈치채지 못한다. 그래서
 * 그런 줄은 **고를 수 없게** 하고 까닭을 그 자리에 적는다.
 * 🔵 **목록에서 감추지는 않는다** — 「있는데 못 고른다」와 「아예 없다」는 다른 말이고, 뒤로
 *    읽히면 사람은 부품을 손으로 적어 버린다(채워 넣을 길이 바로 옆에 있는데도).
 * 🔵 채우는 길은 **부품 요청 칸**에 있다(A/S PartRequestSection) — 이 조각의 일이 아니다.
 * ============================================================================
 */
export type PartNameSource = "part" | "customer";

/** 고객사 품명이 비어 있어 고를 수 없는 줄에 적는 말. 🔴 **고치는 길을 아는 사람의 말투**다. */
export const CUSTOMER_PART_NAME_REQUIRED_MESSAGE = "고객사 품명을 설정해 주세요";

/**
 * 이 화면이 그 줄에 적을 **이름**. 없으면 빈 글자다.
 *
 * 🔴 **고객사 품명이 없을 때 우리 품명으로 때우지 않는다.** 때우면 고객사가 모르는 이름이
 *    견적서에 찍히고, 빈칸과 달리 **그럴듯해 보여서** 아무도 되묻지 않는다. 비면 빈 채로
 *    두고, 고르는 자리에서 막는다(아래 `canPickPartOption`).
 */
export function partPickName(option: PartPickerRow, nameSource: PartNameSource = "part"): string {
  return nameSource === "customer"
    ? partFieldValue(option.customerPartName)
    : partFieldValue(option.partName);
}

/**
 * 이 줄을 **고를 수 있는가**. 🔴 `partPickName` 으로 **재서** 답한다 — 두 곳에 규칙을 적으면
 * 언젠가 한쪽만 바뀌어, 고를 수는 있는데 빈 이름이 들어가는 줄이 생긴다.
 *
 * 🔵 기본(`"part"`)에서는 사실상 언제나 참이다 — 품명이 빈 줄은 주는 쪽이 이미 버린다.
 */
export function canPickPartOption(option: PartPickerRow, nameSource: PartNameSource = "part"): boolean {
  return partPickName(option, nameSource) !== "";
}

/**
 * 다섯 가지로 거른다 — **품명 · 품명2(규격) · 고객사 품명 · 도번 · 교산 품번**. 재고를
 * 찾는 자리가 서버에서 거르는 칸과 같다(재고 관리 API.md 2절의 `q`, 그리고 A/S 부품 요청
 * 칸의 `filterInventoryParts`). 같은 잣대라야 「재고에서 찾던 대로 치면 여기서도 나온다」가
 * 된다.
 *
 * 🔴 **고객사 품명은 2026-10-16 에 더했다.** 고객사에 나가는 서류에 쓰는 이름이라 사람이
 *    그 이름으로 찾는다 — 그런데 지금까지는 그 글자로 아무것도 안 나왔다. 줄에 그 칸이
 *    아예 없는 사이트(제 표에서 읽는 쪽)에서는 지금까지처럼 네 가지로 걸린다.
 *
 * 🔴 빈 글자면 **아무것도 돌려주지 않는다** — 칸을 누르자마자 목록이 통째로 펼쳐지면
 *    밑줄을 가린다. 사람이 무언가 친 뒤에만 후보가 뜬다.
 */
export function filterPartOptions(
  options: readonly PartPickerRow[],
  query: string
): PartPickerRow[] {
  const term = query.trim().toLowerCase();
  if (term === "") return [];
  const matched = options.filter(
    (option) =>
      option.partName.toLowerCase().includes(term) ||
      (option.partSpec ?? "").toLowerCase().includes(term) ||
      (option.customerPartName ?? "").toLowerCase().includes(term) ||
      (option.drawingNo ?? "").toLowerCase().includes(term) ||
      (option.kyosanPartNo ?? "").toLowerCase().includes(term)
  );
  return matched.slice(0, MAX_PART_SUGGESTIONS);
}

/**
 * ============================================================================
 * 고를 때 단가도 함께 채운다 (2026-09-17 사용자 요청) — 🔴 **주면** 채운다
 * ============================================================================
 * 단가에 필요한 것은 전부 **선택**이다. 안 주면 지금까지 그대로 품명과 연결 둘만
 * 채운다 — 수리 건 상세의 사용 부품 칸(A/S components/repair-cases/detail/edit/
 * UsedPartsEditForm.tsx)이 같은 고르개를 쓰는데, 거기에는 단가 칸이 없다. 이것을
 * 필수로 만들면 그 화면이 컴파일에서 깨진다.
 *
 * ── 🔴 금액이 고객사로 나가는 자리라 지키는 것 셋 ───────────────────────────
 *  ㉠ **적혀 있으면 덮지 않는다** — 사람이 조정해 둔 금액이 고른 순간 말없이 바뀌면,
 *     바뀐 줄 모르고 그대로 나간다. 빈칸일 때만 채운다.
 *  ㉡ **정하지 않은 것을 0 으로 채우지 않는다** — null 은 빈칸으로 두고, `"0"` 은
 *     0 으로 채운다(무상 부품이라는 실제 값이다. ./part-price-field.ts 머리말).
 *  ㉢ **O/H 줄에 일반 단가를 대신 쓰지 않는다** — O/H 단가가 없으면 안 채운다. 대신
 *     채우면 틀린 금액이 견적서에 박히고, 빈칸과 달리 아무도 눈치채지 못한다.
 * ============================================================================
 */
export type PartPickPriceContext = {
  /**
   * 단가가 적혀 있는 부품들(사이트의 queries/inventory.ts 의 getPartPickerUnitPrices).
   * **안 주면 단가를 채우지 않는다.** 여기 없는 부품은 "단가를 정하지 않았다"이다.
   */
  prices?: readonly PartPickerPriceRow[];
  /** 이 줄이 `2) OH 부품 비용` 칸으로 갈 줄인가 — 그러면 O/H 단가를 본다. */
  isOverhaulPart?: boolean;
  /** 지금 단가 칸에 적혀 있는 글자. 🔴 비어 있지 않으면 채우지 않는다. */
  currentUnitPrice?: string;
};

/**
 * 이 부품을 고른 줄의 단가 칸에 **넣을 글자**. 넣지 않을 때는 null 이다.
 *
 * null 을 돌려주는 경우 넷 — 셋은 일부러 그런 것이고 하나는 줄 데이터가 없는 것이다:
 *
 *  · 단가 칸에 이미 값이 있다(㉠ 덮지 않는다)
 *  · 단가 목록을 받지 못했다(고르개를 단가 없이 쓰는 화면)
 *  · 그 부품에 줄이 없다 = 일반 · O/H 둘 다 정하지 않았다(㉡)
 *  · 볼 쪽 단가가 null 이다 — 🔴 O/H 줄인데 O/H 단가가 없으면 **여기서 끝난다**.
 *    일반 단가로 넘어가지 않는다(㉢)
 */
export function partPickUnitPrice(partId: string, context: PartPickPriceContext = {}): string | null {
  const { prices, isOverhaulPart = false, currentUnitPrice = "" } = context;
  // ㉠ 사람이 적어 둔 금액이 먼저다. 목록을 보기도 전에 돌아선다.
  if (currentUnitPrice.trim() !== "") return null;
  if (!prices) return null;

  const row = prices.find((price) => price.partId === partId);
  if (!row) return null;

  // 🔴 줄의 출처가 아니라 **줄에 붙은 OH 표시**가 고른다 — 한 견적서 안에 두 종류가
  // 섞여 있고, 사람이 그 표시를 손으로 켜고 끈다(./part-price-field.ts 머리말).
  const price = isOverhaulPart ? row.overhaulUnitPrice : row.unitPrice;
  if (price === null) return null;

  const text = toPriceFieldValue(price);
  // toPriceFieldValue 는 숫자로 읽히지 않는 값을 빈 글자로 돌려준다. 빈 글자를 넣는 것은
  // 아무것도 안 하는 것과 같으니 애초에 안 넣는다("0" 은 "0" 으로 남는다 — ㉡).
  return text === "" ? null : text;
}

/**
 * 고른 부품을 줄에 적을 값. **품명과 재고 연결**은 언제나 채우고, 단가는 위 규칙에
 * 맞을 때만 얹는다. 수량과 규격 칸(케이블)은 건드리지 않는다.
 *
 * 🔴 `unitPrice` 키는 **채울 때만 생긴다.** 부르는 쪽이 이 값을 줄에 덮어쓰기로 붓기
 * 때문에(`{ ...row, ...patch }`), null 이나 빈 글자를 넣어 돌려주면 적혀 있던 금액이
 * 지워진다. 키가 없으면 그 칸은 손대지 않은 채로 남는다.
 *
 * 품명은 마스터의 품명 그대로다 — 부품 요청 칸이 장바구니에 담는 값과 같게 둔다
 * (A/S PartRequestSection 의 addToCart). 담긴 뒤에는 손으로 고칠 수 있고, 고치면 연결이
 * 풀린다(그 규칙은 폼의 onChange 에 있다).
 *
 * 🔴 **어느 이름을 적을지는 `nameSource` 가 정하고, 그 값은 쓰는 쪽이 넘긴다**(2026-10-16 —
 * 견적서만 `"customer"`). 안 넘기면 지금까지 그대로 우리 품명이다. 🔴 **고객사 품명이 빈 줄에
 * 이것을 부르면 빈 글자가 돌아온다** — 그런 줄은 목록에서 **고를 수 없게** 막혀 있어 여기까지
 * 오지 않는다(`canPickPartOption`). 막힌 줄을 억지로 넘기면 적어 둔 품명이 지워지므로, 두
 * 규칙은 언제나 같은 자(`partPickName`)로 잰다.
 *
 * 🔴 **`partId` 는 「고른 줄의 id」일 뿐, 「DB 에 적을 값」이 아니다.** 어디에 저장할지는
 * 폼이 정한다 — A/S 는 2026-10-16 부터 재고 관리의 부품을 고르는데, 그 부품에는 A/S 의
 * `parts.id` 가 **없어서** 이 값을 FK 칸에 넣지 않고 폼이 `partId: null` 로 덮어쓴다.
 * 제 표에서 읽는 사이트(PO/내자)는 지금까지처럼 그대로 적는다.
 */
export function partPickPatch(
  option: PartPickerRow,
  context: PartPickPriceContext = {},
  nameSource: PartNameSource = "part"
): { partNameText: string; partId: string; unitPrice?: string } {
  const picked = { partNameText: partPickName(option, nameSource), partId: option.id };
  const unitPrice = partPickUnitPrice(option.id, context);
  return unitPrice === null ? picked : { ...picked, unitPrice };
}

/**
 * 후보 한 줄의 **꼬리표** — 품명 말고 **무엇으로 찾았는지**가 보여야 같은 이름이 여럿일 때
 * 고를 수 있다. 비어 있는 칸은 자리만 차지하므로 빼고 잇는다(🔴 `-` 만 적힌 칸도 빈 칸이다 —
 * `partFieldValue`. `- · - · -` 가 줄을 채우면 정작 있는 값이 묻힌다).
 *
 * 🔴 **차례는 여기서 정하지 않는다** — `./part-picker-rows.ts` 의 `PART_FIELD_ORDER` 하나가
 *    쥔다(2026-10-16 요청 ③: 「어디서든 같은 순서」). 그래서 꼬리표에 남는 것은 **품명2 ·
 *    교산 품번 · 도번**이고, 그 차례도 그 목록이 정한 그대로다.
 *
 * 🔴 **고객사 품명과 품명은 여기 오지 않는다** — 둘은 줄의 **머리**라 아래 목록이 따로 그린다
 *    (고객사 품명은 제 줄에 이름표를 달고 맨 위, 품명은 그 다음 줄의 첫 글자). 같은 글자가 한
 *    줄에 두 번 나오면 어느 것이 적힐 이름인지 더 헷갈린다.
 *
 * 🔵 `nameSource` 는 이제 꼬리표를 가르지 않는다 — 두 모양이 같아졌다. 받는 자리만 남겨 둔다
 *    (가져다 쓰는 사이트가 넘기고 있을 수 있어, 지우면 그쪽이 컴파일에서 깨진다).
 */
export function partOptionDetail(option: PartPickerRow, _nameSource: PartNameSource = "part"): string {
  return partFieldValueText(partFieldEntries(option, { exclude: ["customerPartName", "partName"] }));
}

/**
 * 품명 칸 밑에 뜨는 후보 목록.
 *
 * 🔴 `onMouseDown` 에서 기본 동작을 막는다 — 막지 않으면 후보를 누르는 순간 입력 칸이
 *    먼저 포커스를 잃어(onBlur) 목록이 닫히고, 그러면 `onClick` 이 닿을 곳이 없어진다.
 *    「눌리지 않는 목록」이 되는 흔한 함정이라 여기서 못 박는다.
 *
 * 🔴 **줄의 생김새를 갈아엎지 않는다**(2026-10-16). 줄의 뼈대는 그대로 **품명 + 꼬리표** 한
 *    줄이고, 그 **위에 작은 줄 하나**가 더 붙을 뿐이다 — 「고객사 품명 · …」. 더하기만 한다.
 *
 * ── 🔴 고객사 품명이 **맨 위**에 온다 (2026-10-16 요청 ③) ──────────────────
 * 사용자 요청: 「어디서든 부품 검색 결과는 **고객사 품명 · 품명 · 품명2 · 교산 품번 · 도번**
 * 순서로.」 그래서 그 줄이 품명 줄 **위**에 선다. 차례를 적는 자리는 한 곳이다
 * (`./part-picker-rows.ts` 의 `PART_FIELD_ORDER`).
 *
 * 🔵 **그 칸이 없는 사이트(PO/내자)는 한 줄도 늘지 않는다** — 줄에 고객사 품명이 아예 없으면
 *    (`customerPartName` 은 선택이다) 이 줄은 그려지지 않는다. 그쪽에서 달라지는 것은 꼬리표
 *    안의 **교산 품번 · 도번 차례**뿐이고, 그것이 바로 ③ 이 맞추라고 한 그 차례다.
 *
 * 🔴 **까닭을 적는 것은 `"customer"` 화면뿐이다** — 거기서만 그 칸이 비면 **고를 수 없기**
 *    때문이다. 기본 화면에서는 비어도 고를 수 있으니 「없다」를 적을 까닭이 없다(적으면
 *    고르지 말라는 말로 읽힌다).
 */
export function PartSuggestionList({
  options,
  onPick,
  listLabel,
  nameSource = "part",
}: {
  options: readonly PartPickerRow[];
  onPick: (option: PartPickerRow) => void;
  /** 이 목록이 어느 줄의 것인가 — 줄 번호는 부르는 쪽이 정한다(종류별로 세는 그 번호). */
  listLabel: string;
  /**
   * 🔴 **고른 줄에 어느 이름을 적는가.** 안 넘기면 지금까지 그대로 우리 품명이고, 아무 줄도
   * 막히지 않는다. `"customer"` 를 넘기면 고객사 품명이 적히고 **그 이름이 없는 줄은 눌리지
   * 않는다**(위 `PartNameSource` 머리말).
   */
  nameSource?: PartNameSource;
}) {
  if (options.length === 0) return null;
  return (
    <ul
      aria-label={listLabel}
      className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {options.map((option) => {
        const detail = partOptionDetail(option);
        const pickable = canPickPartOption(option, nameSource);
        /* 🔴 고객사 품명은 **`partPickName` 과 같은 자**로 잰다 — 자가 둘이면 「이름이 있다」고
           그려 놓고 고르면 빈 이름이 들어가는 줄이 생긴다. */
        const customerPartName = partPickName(option, "customer");
        return (
          <li key={option.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              /* 🔴 `disabled` 가 진짜 울타리고, 이 한 줄은 그 울타리가 혹시 빠져도 빈 이름이
                 줄에 들어가지 않게 하는 것이다 — 막힌 줄을 고르면 품명이 지워진다. */
              onClick={() => {
                if (pickable) onPick(option);
              }}
              disabled={!pickable}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:disabled:bg-zinc-900/60 dark:disabled:hover:bg-zinc-900/60"
            >
              {/* 🔴 ① 고객사 품명 — 정해진 차례의 **맨 앞**이라 품명 줄 위에 선다(머리말 ③).
                  값이 있으면 이름표를 달아 보여 주고, 없으면 `"customer"` 화면에서만 **까닭**을
                  적는다(거기서만 못 고른다). 그 칸이 아예 없는 사이트에는 이 줄이 안 생긴다. */}
              {customerPartName !== "" ? (
                <span className="block text-zinc-500 dark:text-zinc-400">
                  {PART_FIELD_LABELS.customerPartName} · {customerPartName}
                </span>
              ) : (
                nameSource === "customer" && (
                  <span className="block text-amber-700 dark:text-amber-400">
                    {CUSTOMER_PART_NAME_REQUIRED_MESSAGE}
                  </span>
                )
              )}
              {/* ② 품명 + 꼬리표(품명2 · 교산 품번 · 도번) — 예전 그대로의 그 한 줄이다. */}
              <span className="block">
                <span className={pickable ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-500"}>
                  {option.partName}
                </span>
                {detail !== "" && (
                  <span className="ml-2 text-zinc-500 dark:text-zinc-400">{detail}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
