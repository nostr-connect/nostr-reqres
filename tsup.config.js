import { defineConfig } from "tsup"

module.exports = defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["cjs", "esm"],
  minify: true,
  sourcemap: true,
  clean: true,
  dts: true,
  outExtension: ({ format }) => {
    return {
      js: `.${format}.js`
    }
  }
})
