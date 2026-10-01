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
    // We don't assert on the exact path format because the plugin only
    // replaces MAGIC_PATH with customPath ?? "." - but we DO assert that
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

describe("legacy placeholder is replaced in memory", () => {
  // These setups used to ship "@@_MAGIC_PATH_@@" imports, because the old
  // rewrite ran on disk in closeBundle and only looked at .js files under an
  // output dir that had to be configured in the rollup() options.
  const input = path.join(TESTS_INPUT_DIR, "file1.js")
  const plugins = () => [libStylePlugin({customPath: "."})]

  const expectRewritten = (code) => {
    expect(code).not.toContain(MAGIC_PATH)
    expect(code).toMatch(/["']\.\/test\/test_files\/styles1\.css["']/)
  }

  test.each([
    {format: "esm", extension: ".mjs"},
    {format: "cjs", extension: ".cjs"},
  ])("format=$format with $extension entry files", async ({format, extension}) => {
    const output = {format, dir: TESTS_TEMP_DIR, entryFileNames: `[name]${extension}`}
    const bundle = await rollup({input, output, plugins: plugins(), onwarn})
    await bundle.write(output)
    await bundle.close()

    const files = findFiles(TESTS_TEMP_DIR, extension)
    expect(files).toHaveLength(1)
    expectRewritten(fs.readFileSync(files[0], "utf-8"))
  })

  test("bundle.generate()", async () => {
    const bundle = await rollup({input, plugins: plugins(), onwarn})
    const {output} = await bundle.generate({format: "esm"})
    await bundle.close()

    expectRewritten(output[0].code)
  })

  test("output options passed only to bundle.write()", async () => {
    const bundle = await rollup({input, plugins: plugins(), onwarn})
    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"})
    await bundle.close()

    expectRewritten(fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8"))
  })

  test("a JS API build that never calls bundle.close()", async () => {
    const output = {format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"}
    const bundle = await rollup({input, output, plugins: plugins(), onwarn})
    await bundle.write(output)

    expectRewritten(fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8"))
  })

  test("no unresolved-import warnings, even without the onwarn helper", async () => {
    const warnings = []
    const bundle = await rollup({input, plugins: plugins(), onwarn: (warning) => warnings.push(warning)})
    await bundle.generate({format: "esm"})
    await bundle.close()

    expect(warnings.map((warning) => warning.code)).not.toContain("UNRESOLVED_IMPORT")
  })

  test("other .js files in the output dir are left alone", async () => {
    const unrelatedFile = path.join(TESTS_TEMP_DIR, "vendor", "untouched.js")
    const unrelatedSource = `export const keep = "${MAGIC_PATH}/not-ours.css"\n`
    fs.outputFileSync(unrelatedFile, unrelatedSource)

    const output = {format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"}
    const bundle = await rollup({input, output, plugins: plugins(), onwarn})
    await bundle.write(output)
    await bundle.close()

    expect(fs.readFileSync(unrelatedFile, "utf-8")).toBe(unrelatedSource)
    expectRewritten(fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8"))
  })

  test("esm and cjs outputs written from the same bundle", async () => {
    const bundle = await rollup({input, plugins: plugins(), onwarn})
    await bundle.write({format: "esm", dir: path.join(TESTS_TEMP_DIR, "esm"), entryFileNames: "bundle.js"})
    await bundle.write({format: "cjs", dir: path.join(TESTS_TEMP_DIR, "cjs"), entryFileNames: "bundle.js"})
    await bundle.close()

    expectRewritten(fs.readFileSync(path.join(TESTS_TEMP_DIR, "esm", "bundle.js"), "utf-8"))
    expectRewritten(fs.readFileSync(path.join(TESTS_TEMP_DIR, "cjs", "bundle.js"), "utf-8"))
  })

  test("a minifier-style renderChunk plugin listed before the plugin", async () => {
    // Re-prints `import '...';\n` as `import"...";` like a minifier would.
    const fakeMinifier = {name: "fake-minifier", renderChunk: (code) => ({code: code.replace(/import '([^']*)';\n/g, 'import"$1";'), map: null})}
    const bundle = await rollup({input, plugins: [fakeMinifier, ...plugins()], onwarn})
    const {output} = await bundle.generate({format: "esm"})
    await bundle.close()

    expectRewritten(output[0].code)
  })

  test("customPath is inserted literally, even when it contains $ patterns", async () => {
    const bundle = await rollup({input, plugins: [libStylePlugin({customPath: "./$&/$1"})], onwarn})
    const {output} = await bundle.generate({format: "esm"})
    await bundle.close()

    expect(output[0].code).not.toContain(MAGIC_PATH)
    expect(output[0].code).toContain("./$&/$1/test/test_files/styles1.css")
  })

  test("importCSS: false injects no imports but still emits the CSS", async () => {
    const bundle = await rollup({input, plugins: [libStylePlugin({customPath: ".", importCSS: false})], onwarn})
    const {output} = await bundle.generate({format: "esm"})
    await bundle.close()

    const [chunk, ...assets] = output
    expect(chunk.code).not.toContain(MAGIC_PATH)
    expect(chunk.code).not.toMatch(/import\s+['"][^'"]*\.css['"]/)
    expect(assets.map((asset) => asset.fileName).sort()).toEqual(["test/test_files/styles1.css", "test/test_files/styles2.css", "test/test_files/styles3.css"])
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
