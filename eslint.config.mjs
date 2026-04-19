import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  ...compat.extends("plugin:jsx-a11y/recommended"),
  {
    rules: {
      // Pragmatic a11y baseline: keep the core WCAG rules strict but mute
      // a few rules that have a high false-positive rate in design-system code
      // we already audit by hand (icon-only buttons w/ aria-label, decorative imgs).
      "jsx-a11y/no-autofocus": ["warn", { ignoreNonDOM: true }],
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/label-has-associated-control": [
        "warn",
        { assert: "either", depth: 3 },
      ],
      // Respect the underscore convention for intentionally unused values.
      // This is the long-standing TS/ESLint community pattern: any variable,
      // arg or destructured prop prefixed with `_` is treated as "this is
      // here on purpose, do not warn".
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
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      "tests/load/**",
      "public/**",
      "reports/mutation/**",
      ".stryker-tmp/**",
    ],
  },
];

export default eslintConfig;
