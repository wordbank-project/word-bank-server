import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Require braces on every if/for/while body, even single-statement ones.
      curly: ["error", "all"],
    },
  }
);
