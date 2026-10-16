/**
 * ============================================================================
 * 부품 고르개가 받는 줄의 모양 — 두 사이트가 **같은 글자로** 본다
 * ============================================================================
 * 고르개(./part-picker.tsx)가 한 벌이므로 **그 화면이 받는 줄의 모양**도 한 벌
 * 이어야 한다 — 두 사이트의 조회가 각자 제 타입을 들고 있으면 한쪽만 칸이 늘거나
 * 이름이 바뀐 날 컴파일러가 아무 말도 하지 않는다. 이웃한
 * ../quotes/quote-list-rows.ts 가 같은 까닭으로 있다.
 *
 * 🔴 **여기에는 조회가 없다.** 값을 실제로 읽어 오는 일(`getPartPickerList` ·
 * `getPartPickerUnitPrices`)은 각 사이트가 갖는다 — 이 묶음은 DB 에 접속하지
 * 않는다(../../index.ts 머리말). 여기 있는 것은 **읽어 온 값의 모양**뿐이다.
 *
 * 🔴 두 형은 표 정의를 물지 않는다 — `../../schema/` 를 하나도 읽지 않는 순수
 * 형이다(그래야 브라우저 묶음에 drizzle 이 딸려 오지 않는다. README 69줄 부근).
 * 칸 이름을 스키마와 맞추어 두는 일은 가져다 쓰는 사이트의 조회가 한다: 조회가
 * 이 형을 반환형으로 적고 있어서, 스키마에서 칸이 사라지면 그쪽에서 깨진다.
 *
 * 2026-09-22 — A/S 의 `src/lib/db/queries/inventory.ts` 에서 옮겨 왔다. 저쪽은
 * 이제 이 두 형을 **재수출한다**(부르는 쪽이 지금까지 하던 대로 그 파일에서
 * 타입을 가져올 수 있게, 그리고 사이트 안에 정의가 두 벌이 되지 않게).
 * ============================================================================
 */

/**
 * 부품을 **알아보는 데 필요한 것만** 담은 한 줄. 고르개가 거르는 다섯 가지다 —
 * 품명 · 품명2(규격) · 고객사 품명 · 도번 · 교산 품번.
 *
 * 🔴 **재고 · 소유구분 · 내부 비고가 없다.** 화면에서 안 그리는 것으로는 모자라다 —
 * 조회가 이미 실어 보낸 뒤이기 때문이다. 그래서 칸 자체를 두지 않는다
 * (./part-picker.tsx 머리말).
 *
 * 🔴 **`id` 가 무엇인지는 주는 쪽이 정한다.** 제 표에서 읽는 사이트(PO/내자)는 부품의
 * UUID 를 담고, 재고 관리에서 받아 오는 사이트(A/S, 2026-10-16)는 **재고 관리의 부품
 * 번호(No.)를 글자로** 담는다. 고르개는 이 값을 **줄을 가르는 열쇠**로만 쓰고(목록의
 * key, 단가를 찾는 열쇠), 어디에 저장할지는 보지 않는다 — 저장은 폼의 몫이다.
 */
export type PartPickerRow = {
  id: string;
  partName: string;
  partSpec: string | null;
  drawingNo: string | null;
  kyosanPartNo: string | null;
  /**
   * 고객사에 나가는 서류에 쓰는 이름(재고 관리의 `customerName`, 2026-10-14 에 생긴 칸).
   * 우리 품명과 다르고, 사람이 **그 이름으로 찾는다** — 그래서 거르는 칸에 들어간다.
   *
   * 🔴 **선택이다.** 제 표에서 읽는 사이트에는 이 칸이 아예 없다. 없으면 없는 대로
   * 지금까지처럼 네 가지로 거른다.
   */
  customerPartName?: string | null;
};

/**
 * 고르개가 **함께 받아 두는** 단가 한 줄. 부품마다 값이 둘이다 — 일반 단가와 O/H 단가
 * (./part-price-field.ts 머리말). 둘 다 소유구분을 보지 않는다(2026-09-17 사용자 정정).
 *
 * 🔴 **값의 출처는 주는 쪽이 정한다.** 제 표에서 읽는 사이트는 부품 단가 표 둘을 읽고,
 * 재고 관리에서 받아 오는 사이트(A/S, 2026-10-16)는 재고 관리가 부품 줄에 실어 주는
 * **견적가 · O/H 견적가**를 그대로 옮겨 담는다(저쪽 API.md 2절). 열쇠(`partId`)도 그
 * 사이트의 `PartPickerRow.id` 와 같은 값이어야 한다 — 고르개는 그 둘로 줄을 맞춘다.
 *
 * 🔴 **null 은 "정하지 않았다"이고 `"0"` 은 "무상 부품"이다.** 행이 없는 것을 `"0"` 으로
 * 채워 돌려주면 그 구분이 화면에 닿기 전에 사라지고, 견적서가 그 부품을 0원으로 청구한다
 * (A/S queries/part-unit-prices.ts 의 같은 규약).
 */
export type PartPickerPriceRow = {
  partId: string;
  /** 부품 상세에 적어 둔 일반 단가. 정해 두지 않았으면 null. */
  unitPrice: string | null;
  /** O/H 단가. 정해 두지 않았으면 null — 🔴 그때 일반 단가로 때우지 않는다. */
  overhaulUnitPrice: string | null;
};

/**
 * 엑셀 현황판이 **빈 칸을 `-` 로** 적는 습관. 재고 관리도 **같은 글자들**을 빈 값으로 본다
 * (저쪽 `lib/parts/form.ts` 의 `DASH_ONLY`) — 붙임표 · 줄표 · 전각 붙임표 · 한글 ㅡ 까지다.
 * 🔴 **같은 자를 써야** 두 시스템이 같은 칸을 같게 읽는다. 여기만 넓거나 좁으면, 한쪽은
 * 「이름이 있다」고 그리는데 다른 쪽은 「비어 있다」고 말한다.
 */
const DASH_ONLY = /^[-–—－ㅡ]+$/;

/**
 * 칸에 **값이 들어 있는가** — 들어 있으면 다듬은 글자를, 없으면 **빈 글자**를 돌려준다.
 *
 * 🔴 **`-` 만 적힌 칸은 「없음」이다.** 자료가 엑셀에서 넘어와 빈칸 대신 `-` 가 적힌 줄이
 *    많다. 그것을 값으로 세면 두 가지가 한꺼번에 어긋난다 —
 *     ㉠ 꼬리표가 `- · - · -` 로 채워져 **정작 있는 값이 묻힌다**,
 *     ㉡ 고객사 품명 자리에서는 「이름이 있다」고 읽혀 **고객사에 나가는 서류에 `-` 가 이름으로
 *        찍힌다**(재고 관리도 `-` 를 고객사 품명으로 받지 않는다 — 보내면 400 이다).
 *
 * 🔵 **거르기(`filterPartOptions`)에는 쓰지 않는다.** 찾는 글자와 맞춰 보는 일은 적힌 그대로
 *    하면 되고, 이 자는 **보여 주고 · 값으로 세는** 자리의 것이다.
 */
export function partFieldValue(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  return DASH_ONLY.test(text) ? "" : text;
}

/**
 * ============================================================================
 * 🔴 부품을 **어떤 차례로 보이는가** — 적는 자리는 **여기 하나**다 (2026-10-16 요청 ③)
 * ============================================================================
 * 사용자 요청: 「**어디서든** 부품 검색 결과는 **고객사 품명 · 품명 · 품명2 · 교산 품번 ·
 * 도번** 순서로 보이게.」 그릴 자리가 다섯이다 — 견적서 고르개 · 사용 부품 고르개 · 부품
 * 요청의 찾은 줄 · 담은 줄 · 견적서 줄의 상세. 다섯 군데에 차례를 적어 두면 **언젠가 갈린다**:
 * 한 곳만 칸을 더하거나 자리를 바꿔도 아무도 모르고, 같은 부품이 화면마다 다르게 읽힌다.
 *
 * 그래서 차례와 이름표를 **이 파일 한 곳**에 둔다. 여기인 까닭:
 *  · 고르개(`./part-picker.tsx`)가 바로 곁에서 쓴다 — 그 조각은 PO/내자와 한 벌이다.
 *  · A/S 의 부품 요청 칸도 이 파일을 이미 쓰고 있다(`partFieldValue` 를 빌리는 그 자리,
 *    `src/lib/domain/inventory-gateway.ts`) — react 도 DB 도 물지 않는 순수 모듈이라
 *    서버 쪽에서 불러도 아무것도 딸려 오지 않는다.
 *
 * 🔵 **값이 있는 것만 그리는 규칙은 그대로다** — 아래 `partFieldEntries` 가 `partFieldValue`
 *    로 재어 빈 칸(🔴 `-` 만 적힌 칸까지)을 **아예 빼고** 돌려준다.
 * 🔵 **그리는 모양은 쓰는 쪽이 정한다** — 여기서는 「무엇을 · 어떤 이름표로 · 어떤 차례로」
 *    까지만 정한다. 한 줄로 이을지 석 줄로 나눌지는 화면의 몫이다.
 * ============================================================================
 */
export const PART_FIELD_ORDER = [
  "customerPartName",
  "partName",
  "partSpec",
  "kyosanPartNo",
  "drawingNo",
] as const;

export type PartFieldKey = (typeof PART_FIELD_ORDER)[number];

/**
 * 칸마다의 이름표. 🔴 **값만 이으면 어느 것이 교산 품번이고 어느 것이 도번인지 모른다** —
 * 사람이 그 둘을 서로 다른 데 쓴다. 이름표를 붙일지 말지는 화면이 고르지만, 붙인다면
 * **이 글자**를 쓴다(화면마다 다른 말을 적으면 같은 칸이 다른 칸으로 읽힌다).
 */
export const PART_FIELD_LABELS: Record<PartFieldKey, string> = {
  customerPartName: "고객사 품명",
  partName: "품명",
  partSpec: "품명2",
  kyosanPartNo: "교산 품번",
  drawingNo: "도번",
};

export type PartFieldEntry = { key: PartFieldKey; label: string; value: string };

/** 다섯 칸의 날값. 🔵 **전부 선택이다** — 줄에 그 칸이 없는 사이트(PO/내자)가 있다. */
export type PartFieldValues = Partial<Record<PartFieldKey, string | null | undefined>>;

/**
 * 그 부품의 **보일 칸들**을 정해진 차례로. 🔴 **값이 없는 칸은 아예 빠진다**(`-` 만 적힌 칸도
 * 없는 칸이다 — 위 `partFieldValue`).
 *
 * `exclude` 는 **그 화면이 다른 자리에 따로 그리는 칸**을 빼는 데 쓴다 — 같은 글자가 한 줄에
 * 두 번 나오면 어느 것이 무엇인지 더 헷갈린다. 🔴 **차례를 바꾸는 데 쓰는 값이 아니다.**
 */
export function partFieldEntries(
  values: PartFieldValues,
  options: { exclude?: readonly PartFieldKey[] } = {}
): PartFieldEntry[] {
  const exclude = options.exclude ?? [];
  const entries: PartFieldEntry[] = [];
  for (const key of PART_FIELD_ORDER) {
    if (exclude.includes(key)) continue;
    const value = partFieldValue(values[key]);
    if (value === "") continue;
    entries.push({ key, label: PART_FIELD_LABELS[key], value });
  }
  return entries;
}

/** 칸 사이를 잇는 글자. 🔴 화면마다 다른 글자로 이으면 같은 줄이 다른 줄로 보인다. */
export const PART_FIELD_SEPARATOR = " · ";

/** 값만 이어 한 줄로 — 이름표 없이. 어느 칸인지가 자리로 읽히는 자리(고르개 꼬리표)에서 쓴다. */
export function partFieldValueText(entries: readonly PartFieldEntry[]): string {
  return entries.map((entry) => entry.value).join(PART_FIELD_SEPARATOR);
}

/** 이름표를 달아 이어 한 줄로. 칸이 섞여 있어 자리만으로는 못 가리는 자리에서 쓴다. */
export function partFieldLabeledText(entries: readonly PartFieldEntry[]): string {
  return entries.map((entry) => `${entry.label} ${entry.value}`).join(PART_FIELD_SEPARATOR);
}
