import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  /*
   * Conventional leading-underscore exemption for intentionally unused bindings.
   *
   * Without this, a parameter that must stay for a callback signature, or a
   * destructured name deliberately dropped from a rest pattern, has to be
   * silenced with `void x;` or an inline disable — both noisier than the `_`
   * prefix the codebase already uses. Scoped to vars/args only; a genuinely
   * forgotten import is still reported.
   */
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", ".artifacts/**", ".archive/**"]),
]);
