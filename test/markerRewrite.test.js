import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin} from "../src/index"

const TESTS_TEMP_DIR = path.join(__dirname, "temp-marker-rewrite")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")
const input = path.join(TESTS_INPUT_DIR, "file1.js")

const FILE1_CSS_IMPORTS = ["./test/test_files/styles1.css", "./test/test_files/styles2.css", "./test/test_files/styles3.css"]

afterEach(() => fs.remove(TESTS_TEMP_DIR))

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

// Matches `import './a.css'`, minified `import"./a.css"` and `require("./a.css")`.
const cssImportsOf = (code) => [...code.matchAll(/(?:\bimport|\brequire\()\s*(["'`])([^"'`]+\.css)\1/g)].map((m) => m[2]).sort()

const silent = () => {}

// Behaves like @rollup/plugin-terser for the purpose of these tests: a plain
// renderChunk hook (no `order`) that re-prints the NUL byte as `\0`.
const fakeMinifier = () => ({
  name: "fake-minifier",
  renderChunk: (code) => ({code: code.split("\0").join("\\0"), map: null}),
})

// A renderChunk plugin that runs before ours (order "pre", listed first)
// and prints the marker's NUL byte differently.
const nulPrinter = (replacement) => ({
  name: "nul-printer",
  renderChunk: {
    order: "pre",
    handler: (code) => ({code: code.split("\0").join(replacement), map: null}),
  },
})

describe("CSS imports are rewritten before other renderChunk plugins run", () => {
  test.each([
    ["listed before the plugin", (plugin) => ({plugins: [fakeMinifier(), plugin]})],
    ["listed after the plugin", (plugin) => ({plugins: [plugin, fakeMinifier()]})],
    ["in output.plugins", (plugin) => ({plugins: [plugin], outputPlugins: [fakeMinifier()]})],
  ])("a minifier %s", async (_position, setup) => {
    const {plugins, outputPlugins} = setup(libStylePlugin())
    const bundle = await rollup({input, plugins})
    const {output} = await bundle.generate({format: "esm", plugins: outputPlugins})
    await bundle.close()

    expect(output[0].code).not.toContain("lib-style-asset")
    expect(cssImportsOf(output[0].code)).toEqual(FILE1_CSS_IMPORTS)
  })

  test("a minifier before the plugin with preserveModules: every CSS import resolves on disk", async () => {
    const bundle = await rollup({input: path.join(TESTS_INPUT_DIR, "nested/entry.js"), plugins: [fakeMinifier(), libStylePlugin()]})
    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, preserveModules: true})
    await bundle.close()

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")
    const resolvedImports = jsFiles.flatMap((file) => cssImportsOf(fs.readFileSync(file, "utf-8")).map((specifier) => path.resolve(path.dirname(file), specifier)))

    expect(resolvedImports).toHaveLength(2)
    for (const cssFile of resolvedImports) expect(fs.existsSync(cssFile)).toBe(true)
    for (const file of jsFiles) expect(fs.readFileSync(file, "utf-8")).not.toContain("lib-style-asset")
  })
})

describe("escaped markers from an earlier code printer", () => {
  test.each([
    ["\\0", "esm"],
    ["\\0", "cjs"],
    ["\\x00", "esm"],
    ["\\x00", "cjs"],
    ["\\u0000", "esm"],
    ["\\u0000", "cjs"],
    ["\\u{0}", "esm"],
    ["\\u{0}", "cjs"],
  ])("NUL printed as %s (format=%s)", async (escaped, format) => {
    const bundle = await rollup({input, plugins: [nulPrinter(escaped), libStylePlugin()]})
    const {output} = await bundle.generate({format})
    await bundle.close()

    expect(output[0].code).not.toContain("lib-style-asset")
    expect(cssImportsOf(output[0].code)).toEqual(FILE1_CSS_IMPORTS)
  })

  test("a printer that switches require() to template literals", async () => {
    const backticks = {
      name: "backticks",
      renderChunk: {
        order: "pre",
        handler: (code) => ({code: code.replace(/require\('([^']*)'\)/g, "require(`$1`)"), map: null}),
      },
    }
    const bundle = await rollup({input, plugins: [backticks, libStylePlugin()]})
    const {output} = await bundle.generate({format: "cjs"})
    await bundle.close()

    expect(output[0].code).toContain("require(`./test/test_files/styles1.css`)")
    expect(cssImportsOf(output[0].code)).toEqual(FILE1_CSS_IMPORTS)
  })
})

describe("leftover placeholder check", () => {
  test.each([
    ["with the NUL byte stripped", ""],
    ["as an escape the plugin doesn't know (\\000)", "\\000"],
  ])("a marker %s fails the build instead of being written", async (_label, replacement) => {
    const bundle = await rollup({input, plugins: [nulPrinter(replacement), libStylePlugin()]})

    await expect(bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"})).rejects.toThrow(/internal CSS import placeholder/)
    await bundle.close()

    expect(fs.existsSync(path.join(TESTS_TEMP_DIR, "bundle.js"))).toBe(false)
  })

  test("bundle.generate() fails too", async () => {
    const bundle = await rollup({input, plugins: [nulPrinter(""), libStylePlugin()]})
    await expect(bundle.generate({format: "esm"})).rejects.toThrow(/rollup-plugin-lib-style/)
    await bundle.close()
  })

  test("an imported placeholder that names no file in this build (e.g. from a prebuilt dependency) fails the build", async () => {
    const entry = path.join(TESTS_TEMP_DIR, "src", "prebuilt.js")
    fs.outputFileSync(entry, `import "\\0lib-style-asset:fromAnotherBuild"\nexport default 1\n`)

    const bundle = await rollup({input: entry, plugins: [libStylePlugin()]})
    await expect(bundle.generate({format: "esm"})).rejects.toThrow(/internal CSS import placeholder/)
    await bundle.close()
  })
})

describe("user code that looks like a marker is left alone", () => {
  const writeEntry = (lines) => {
    const entry = path.join(TESTS_TEMP_DIR, "src", "lookalike.js")
    fs.outputFileSync(entry, [`import styles from "../../test_files/styles1.css"`, ...lines, `export const className = styles.test1`].join("\n"))
    return entry
  }

  test("strings with only the marker prefix", async () => {
    const entry = writeEntry([`export const prefix = "\\0lib-style-asset:"`, `export const name = "lib-style-asset:"`])

    const bundle = await rollup({input: entry, plugins: [libStylePlugin()]})
    const {output} = await bundle.generate({format: "esm"})
    await bundle.close()

    expect(output[0].code).toContain(`"\\0lib-style-asset:"`)
    expect(output[0].code).toContain(`"lib-style-asset:"`)
    expect(cssImportsOf(output[0].code)).toEqual(["./test/test_files/styles1.css"])
  })

  test("strings that look like a whole marker but name no emitted file", async () => {
    const entry = writeEntry([`export const escaped = "\\0lib-style-asset:notARealRef"`, `export const stripped = "lib-style-asset:notARealRef"`])

    const bundle = await rollup({input: entry, plugins: [libStylePlugin()]})
    const {output} = await bundle.generate({format: "esm"})
    await bundle.close()

    expect(output[0].code).toContain(`"\\0lib-style-asset:notARealRef"`)
    expect(output[0].code).toContain(`"lib-style-asset:notARealRef"`)
    expect(cssImportsOf(output[0].code)).toEqual(["./test/test_files/styles1.css"])
  })

  test("bundling the plugin's own source with the plugin enabled", async () => {
    const bundle = await rollup({input: path.join(__dirname, "..", "src", "index.js"), plugins: [libStylePlugin()], onwarn: silent})
    const {output} = await bundle.generate({format: "esm"})
    await bundle.close()

    expect(output[0].code).toContain(`const MARKER_PREFIX = "\\0lib-style-asset:"`)
    expect(output[0].code).toContain(`const MAGIC_PATH = "@@_MAGIC_PATH_@@"`)
  })
})
