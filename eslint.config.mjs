import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * 사이트들은 `eslint-config-next` 를 쓰지만 이 묶음은 쓰지 않는다.
 * 그 설정은 Next 앱의 모양(app/ · pages/ · next/image …)을 전제로 검사하는데,
 * 여기에는 그 어느 것도 없다. 대신 같은 뿌리(typescript-eslint)만 가져와
 * 규칙이 서로 어긋나지 않게 한다. vendor/dss-ui 와 같은 방식이다.
 */
export default tseslint.config(
  {
    ignores: ["node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // TypeScript 가 이미 "없는 이름"을 훨씬 정확히 잡는다. 켜 두면
      // 타입 전용 전역(JSX · NodeJS 등)을 못 찾겠다고 거짓 경보를 낸다 —
      // typescript-eslint 공식 권고대로 끈다.
      "no-undef": "off",
    },
  }
);
