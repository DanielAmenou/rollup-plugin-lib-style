/**
 * Tests for issue #12: PostCSS `to` should reflect the OUTPUT location of the
 * emitted CSS asset, not the SOURCE file path. Plugins like `postcss-url`
 * resolve their `assetsPath` relative to `to`, so anchoring `to` at the
 * output makes asset placement track Rollup's output topology rather than
 * the source tree's nesting.
 *
 * https://github.com/DanielAmenou/rollup-plugin-lib-style/issues/12
 */
import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const TESTS_TEMP_DIR = path.join(__dirname, "temp-postcss-output-path")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")

afterEach(() => fs.remove(TESTS_TEMP_DIR))

/**
 * A PostCSS plugin that records the `from` and `to` PostCSS gives it for
 * every CSS file it processes. We use this to assert on what the lib-style
 * plugin passes to PostCSS, without taking a real dependency on postcss-url.
 */
const makeRecordingPostCssPlugin = (calls) => {
  const plugin = () => ({
    postcssPlugin: "record-from-to",
    Once(root, {result}) {
      calls.push({
        from: result.opts.from,
        to: result.opts.to,
        sourceFile: root.source && root.source.input && root.source.input.file,
      })
    },
  })
  plugin.postcss = true
  return plugin
}

describe("PostCSS `to` is anchored at the output directory (issue #12)", () => {
  test("for a single output dir, `to` resolves under that dir, not under source", async () => {
    const calls = []
    const recorder = makeRecordingPostCssPlugin(calls)

    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      output: [{format: "esm", dir: TESTS_TEMP_DIR}],
      plugins: [libStylePlugin({postCssPlugins: [recorder()]})],
      onwarn,
    })
    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"})
    await bundle.close()

    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      // `from` stays the source file (used by source maps & css-modules
      // hashing). It must be the actual source path under test_files/.
      expect(c.from).toContain(path.join("test", "test_files"))

      // `to` must be anchored at the OUTPUT dir, NOT the source dir.
      const toAbs = path.resolve(c.to)
      expect(toAbs.startsWith(path.resolve(TESTS_TEMP_DIR))).toBe(true)
      expect(toAbs).toMatch(/\.css$/)
    }
  })

  test("`to` does NOT change with source nesting depth -- always rooted at the same output dir", async () => {
    const calls = []
    const recorder = makeRecordingPostCssPlugin(calls)

    const bundle = await rollup({
      // The "nested" fixture contains components at *different* nesting depths:
      //   nested/components/Button/Button.css   (depth 3)
      //   nested/deep/Widget/Widget.css         (depth 3 but distinct sub-tree)
      // Pre-fix, postcss-url's `assetsPath` (relative to source `to`) would
      // resolve to different physical locations for each component. Now both
      // resolve under the same output root.
      input: path.join(TESTS_INPUT_DIR, "nested", "entry.js"),
      output: [{format: "esm", dir: TESTS_TEMP_DIR}],
      plugins: [libStylePlugin({postCssPlugins: [recorder()]})],
      onwarn,
    })
    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, preserveModules: true})
    await bundle.close()

    expect(calls.length).toBeGreaterThanOrEqual(2)
    const outAbs = path.resolve(TESTS_TEMP_DIR)
    for (const c of calls) {
      expect(path.resolve(c.to).startsWith(outAbs)).toBe(true)
    }

    // For each emitted CSS, simulate what postcss-url would do with
    // `assetsPath: "../../assets"` -- resolve `../../assets` against the
    // *directory of `to`*. Verify that all such resolutions land under the
    // OUTPUT root (and never under the SOURCE tree on disk).
    const sourceRoot = path.resolve(TESTS_INPUT_DIR)
    for (const c of calls) {
      const resolvedAssetsDir = path.resolve(path.dirname(c.to), "../../assets")
      // Must live in the build output, never in the source tree.
      expect(resolvedAssetsDir.startsWith(outAbs)).toBe(true)
      expect(resolvedAssetsDir.startsWith(sourceRoot)).toBe(false)
    }
  })

  test("`customCSSPath` is reflected in the PostCSS `to` value", async () => {
    const calls = []
    const recorder = makeRecordingPostCssPlugin(calls)

    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      output: [{format: "esm", dir: TESTS_TEMP_DIR}],
      plugins: [
        libStylePlugin({
          postCssPlugins: [recorder()],
          customCSSPath: (id) => `/styles/${path.basename(id)}`,
        }),
      ],
      onwarn,
    })
    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"})
    await bundle.close()

    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      // The `to` PostCSS gets must reflect the customCSSPath remap, not
      // the original source location.
      expect(c.to).toContain(path.join(TESTS_TEMP_DIR, "styles"))
      expect(c.to).toMatch(/\.css$/)
      expect(c.to).not.toContain(path.join("test_files", "styles"))
    }
  })

  test("when output uses `file` instead of `dir`, `to` resolves under that file's directory", async () => {
    const calls = []
    const recorder = makeRecordingPostCssPlugin(calls)
    const outFile = path.join(TESTS_TEMP_DIR, "out", "bundle.js")

    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      // `output.file` form -- the plugin should derive the dir from it.
      output: [{format: "esm", file: outFile}],
      plugins: [libStylePlugin({postCssPlugins: [recorder()]})],
      onwarn,
    })
    // Rollup requires assets to go to a dir, so we still write with a dir,
    // but the `options` hook captured the dir from the `file` field.
    await bundle.write({format: "esm", dir: path.dirname(outFile), entryFileNames: "bundle.js"})
    await bundle.close()

    expect(calls.length).toBeGreaterThan(0)
    const expectedRoot = path.resolve(path.dirname(outFile))
    for (const c of calls) {
      expect(path.resolve(c.to).startsWith(expectedRoot)).toBe(true)
    }
  })

  test("when no output is configured in input options, `to` falls back to the source path (legacy behavior preserved)", async () => {
    const calls = []
    const recorder = makeRecordingPostCssPlugin(calls)

    // Note: `output` is intentionally omitted from the rollup() call here.
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin({postCssPlugins: [recorder()]})],
      onwarn,
    })
    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"})
    await bundle.close()

    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      // With no output dir known at transform time, we keep the legacy
      // source-rooted `to` -- so `from` and `to` end up equal, exactly as
      // they were before this fix.
      expect(c.to).toBe(c.from)
    }
  })
})

describe("regression check: full build still works with the new `to` semantics", () => {
  // The closed-issue safety net: simply re-run the most representative
  // rollup config from the existing suite and assert the same invariants
  // (no MAGIC_PATH leftovers, every CSS import resolvable on disk).
  const findFiles = (dir, ext) => {
    const results = []
    if (!fs.existsSync(dir)) return results
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) results.push(...findFiles(fullPath, ext))
      else if (entry.name.endsWith(ext)) results.push(fullPath)
    }
    return results
  }

  test("preserveModules build: imports resolve and CSS files exist", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "nested", "entry.js"),
      output: [{format: "esm", dir: TESTS_TEMP_DIR}],
      plugins: [libStylePlugin()],
      onwarn,
    })
    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, preserveModules: true})
    await bundle.close()

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css").map((f) => path.basename(f))
    expect(cssFiles).toContain("Button.css")
    expect(cssFiles).toContain("Widget.css")

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")
    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(jsFile, "utf-8")
      expect(content).not.toContain("@@_MAGIC_PATH_@@")
      const cssImportRegex = /import\s+['"]([^'"]*\.css)['"]/g
      let match
      while ((match = cssImportRegex.exec(content)) !== null) {
        const resolved = path.resolve(path.dirname(jsFile), match[1])
        expect(fs.existsSync(resolved)).toBe(true)
      }
    }
  })
})
