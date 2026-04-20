import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const MAGIC_PATH = "@@_MAGIC_PATH_@@"
const TESTS_TEMP_DIR = path.join(__dirname, "temp-legacy-options")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")

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

const buildLegacy = async (pluginOptions, writeOptions = {}) => {
  const outputConfig = {format: "esm", dir: TESTS_TEMP_DIR, ...writeOptions}
  const bundle = await rollup({
    input: path.join(TESTS_INPUT_DIR, "file1.js"),
    output: [outputConfig],
    plugins: [libStylePlugin(pluginOptions)],
    onwarn,
  })

  await bundle.write(outputConfig)
  await bundle.close()
}

describe("legacy customPath option", () => {
  test("customPath: '.' produces './...' imports and strips magic path", async () => {
    await buildLegacy({customPath: "."}, {entryFileNames: "bundle.js"})

    const out = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(out).not.toContain(MAGIC_PATH)
    // All css imports should start with "./"
    const imports = [...out.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1])
    expect(imports.length).toBeGreaterThan(0)
    for (const i of imports) expect(i.startsWith("./")).toBe(true)
  })

  test("customPath: '/custom/base' replaces the magic prefix", async () => {
    await buildLegacy({customPath: "/custom/base"}, {entryFileNames: "bundle.js"})

    const out = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(out).not.toContain(MAGIC_PATH)
    expect(out).toMatch(/import\s+['"]\/custom\/base/)
  })
})

describe("legacy customCSSInjectedPath option", () => {
  test("customCSSInjectedPath lets the injected import diverge from the emitted asset path", async () => {
    const pluginOptions = {
      // This affects ONLY the injected import string; the emitted asset file
      // still lives under test/test_files/*.css.
      customCSSInjectedPath: (cssFilePath) => `/cdn${cssFilePath}`,
    }

    await buildLegacy(pluginOptions, {entryFileNames: "bundle.js"})

    const out = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(out).not.toContain(MAGIC_PATH)
    // We don't assert on the exact path format because the closeBundle hook
    // only replaces MAGIC_PATH with customPath ?? "." - but we DO assert that
    // the injected path now contains our /cdn segment.
    expect(out).toContain("/cdn/test/test_files/styles1.css")
  })

  test("customCSSInjectedPath combined with customPath still writes asset files to their normal location", async () => {
    await buildLegacy({customPath: ".", customCSSInjectedPath: (p) => `/nope${p}`}, {entryFileNames: "bundle.js"})

    // The asset file must still exist at its source-derived location.
    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css").map((f) => path.basename(f))
    expect(cssFiles).toContain("styles1.css")
    expect(cssFiles).toContain("styles2.css")
    expect(cssFiles).toContain("styles3.css")
  })
})

describe("onwarn helper", () => {
  test("suppresses UNRESOLVED_IMPORT warnings that contain the magic path", () => {
    const forwarded = []
    const warn = (w) => forwarded.push(w)

    onwarn(
      {code: "UNRESOLVED_IMPORT", message: `Could not resolve '${MAGIC_PATH}styles1.css'`},
      warn
    )
    expect(forwarded).toHaveLength(0)
  })

  test("forwards unrelated warnings untouched", () => {
    const forwarded = []
    const warn = (w) => forwarded.push(w)

    const warning = {code: "CIRCULAR_DEPENDENCY", message: "Circular dep in a.js -> b.js"}
    onwarn(warning, warn)

    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]).toBe(warning)
  })

  test("does not blow up if no warn function is provided", () => {
    expect(() =>
      onwarn({code: "UNRESOLVED_IMPORT", message: `Could not resolve '${MAGIC_PATH}x.css'`})
    ).not.toThrow()
    expect(() => onwarn({code: "OTHER", message: "anything"})).not.toThrow()
  })

  test("forwards UNRESOLVED_IMPORT warnings that do NOT mention the magic path", () => {
    const forwarded = []
    onwarn(
      {code: "UNRESOLVED_IMPORT", message: "Could not resolve 'some/real/missing/module'"},
      (w) => forwarded.push(w)
    )
    expect(forwarded).toHaveLength(1)
  })
})

describe("legacy path + preserveModules interaction", () => {
  test("customPath with preserveModules still rewrites magic path across every chunk", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "nested/entry.js"),
      output: [{format: "esm", dir: TESTS_TEMP_DIR}],
      plugins: [libStylePlugin({customPath: "."})],
      onwarn,
    })

    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, preserveModules: true})
    await bundle.close()

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")
    for (const f of jsFiles) {
      const content = fs.readFileSync(f, "utf-8")
      expect(content).not.toContain(MAGIC_PATH)
    }
  })
})
