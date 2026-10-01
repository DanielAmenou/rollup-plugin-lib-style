import path from "path"
import fs from "fs-extra"
import {rollup, watch} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const TESTS_TEMP_DIR = path.join(__dirname, "temp-build-scenarios")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")
const OUTPUT_DIR = path.join(TESTS_TEMP_DIR, "dist")
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

const cssImportsOf = (code) => [...code.matchAll(/(?:\bimport|\brequire\()\s*(["'`])([^"'`]+\.css)\1/g)].map((m) => m[2]).sort()

// Every CSS import in every written JS file must point at a CSS file on disk.
const expectWrittenImportsResolve = (dir, expectedCount) => {
  const resolved = findFiles(dir, ".js").flatMap((file) => {
    const code = fs.readFileSync(file, "utf-8")
    expect(code).not.toContain("lib-style-asset")
    expect(code).not.toContain("@@_MAGIC_PATH_@@")
    return cssImportsOf(code).map((specifier) => path.resolve(path.dirname(file), specifier))
  })
  expect(resolved).toHaveLength(expectedCount)
  for (const cssFile of resolved) expect(fs.existsSync(cssFile)).toBe(true)
}

const writeFixture = (files) => {
  for (const [name, content] of Object.entries(files)) fs.outputFileSync(path.join(TESTS_TEMP_DIR, "src", name), content)
  return path.join(TESTS_TEMP_DIR, "src")
}

describe("chunk layouts", () => {
  test("code splitting: a lazily loaded chunk in a subfolder imports its CSS correctly", async () => {
    const src = writeFixture({
      "entry.js": `import s from "./entry.css"\nexport const load = () => import("./lazy/lazy.js")\nexport default s.entry\n`,
      "entry.css": `.entry { color: red }\n`,
      "lazy/lazy.js": `import s from "./lazy.css"\nexport default s.lazy\n`,
      "lazy/lazy.css": `.lazy { color: blue }\n`,
    })

    const bundle = await rollup({input: path.join(src, "entry.js"), plugins: [libStylePlugin()]})
    await bundle.write({format: "esm", dir: OUTPUT_DIR, chunkFileNames: "chunks/[name].js"})
    await bundle.close()

    const lazyChunk = fs.readFileSync(path.join(OUTPUT_DIR, "chunks", "lazy.js"), "utf-8")
    expect(cssImportsOf(lazyChunk)).toEqual(["../test/temp-build-scenarios/src/lazy/lazy.css"])
    expectWrittenImportsResolve(OUTPUT_DIR, 2)
  })

  test("manualChunks: CSS modules moved into a nested chunk import their CSS correctly", async () => {
    const bundle = await rollup({input, plugins: [libStylePlugin()]})
    await bundle.write({
      format: "esm",
      dir: OUTPUT_DIR,
      chunkFileNames: "assets/js/[name].js",
      manualChunks: (id) => (id.endsWith(".css") ? "styles" : undefined),
    })
    await bundle.close()

    const stylesChunk = fs.readFileSync(path.join(OUTPUT_DIR, "assets", "js", "styles.js"), "utf-8")
    expect(cssImportsOf(stylesChunk)).toEqual(FILE1_CSS_IMPORTS.map((specifier) => specifier.replace("./", "../../")))
    // Rollup also hoists the CSS imports into the entry chunk; each copy must
    // be relative to the chunk it ends up in.
    const entryChunk = fs.readFileSync(path.join(OUTPUT_DIR, "file1.js"), "utf-8")
    expect(cssImportsOf(entryChunk)).toEqual(FILE1_CSS_IMPORTS)
    expectWrittenImportsResolve(OUTPUT_DIR, 6)
  })

  test("output.file: a single-file build imports its CSS correctly", async () => {
    const bundle = await rollup({input, plugins: [libStylePlugin()]})
    await bundle.write({format: "esm", file: path.join(OUTPUT_DIR, "bundle.js")})
    await bundle.close()

    expect(cssImportsOf(fs.readFileSync(path.join(OUTPUT_DIR, "bundle.js"), "utf-8"))).toEqual(FILE1_CSS_IMPORTS)
    expectWrittenImportsResolve(OUTPUT_DIR, 3)
  })
})

describe("build features", () => {
  test("sourcemaps: no broken-sourcemap warnings and a map is produced", async () => {
    const warnings = []
    const bundle = await rollup({input, plugins: [libStylePlugin()], onwarn: (warning) => warnings.push(warning)})
    const {output} = await bundle.generate({format: "esm", sourcemap: true})
    await bundle.close()

    expect(warnings).toEqual([])
    expect(output[0].map).toBeTruthy()
    expect(output[0].map.mappings.length).toBeGreaterThan(0)
    expect(cssImportsOf(output[0].code)).toEqual(FILE1_CSS_IMPORTS)
  })

  test("a rebuild from Rollup's cache produces the same output", async () => {
    const first = await rollup({input, plugins: [libStylePlugin()]})
    const firstOutput = (await first.generate({format: "esm"})).output
    await first.close()

    const second = await rollup({input, plugins: [libStylePlugin()], cache: first.cache})
    const secondOutput = (await second.generate({format: "esm"})).output
    await second.close()

    expect(secondOutput[0].code).toBe(firstOutput[0].code)
    expect(cssImportsOf(secondOutput[0].code)).toEqual(FILE1_CSS_IMPORTS)
    const assetNames = (output) => output.filter((file) => file.type === "asset").map((file) => file.fileName)
    expect(assetNames(secondOutput).sort()).toEqual(assetNames(firstOutput).sort())
  })

  test("one plugin instance reused for two builds", async () => {
    const plugin = libStylePlugin()
    const build = async (dir) => {
      const output = {format: "esm", dir: path.join(OUTPUT_DIR, dir)}
      const bundle = await rollup({input, output, plugins: [plugin]})
      await bundle.write(output)
      await bundle.close()
    }
    await build("first")
    await build("second")

    expectWrittenImportsResolve(path.join(OUTPUT_DIR, "first"), 3)
    expectWrittenImportsResolve(path.join(OUTPUT_DIR, "second"), 3)
  })

  test("two plugin instances in one build (CSS and SCSS handled separately)", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file3.js"),
      plugins: [libStylePlugin({include: "**/*.css"}), libStylePlugin({include: "**/*.scss"})],
    })
    await bundle.write({format: "esm", dir: OUTPUT_DIR})
    await bundle.close()

    expect(cssImportsOf(fs.readFileSync(path.join(OUTPUT_DIR, "file3.js"), "utf-8"))).toEqual(["./test/test_files/scssStyles3.global.css", "./test/test_files/styles4.global.css"])
    expectWrittenImportsResolve(OUTPUT_DIR, 2)
  })
})

describe("watch mode", () => {
  // Runs the first watch build, then stops the watcher.
  const watchFirstBuild = (options) =>
    new Promise((resolve, reject) => {
      const watcher = watch({...options, watch: {skipWrite: false}})
      watcher.on("event", async (event) => {
        if (event.result) await event.result.close()
        if (event.code === "ERROR") {
          await watcher.close()
          reject(event.error)
        }
        if (event.code === "END") {
          await watcher.close()
          resolve()
        }
      })
    })

  test.each([
    ["default mode", {}],
    ["legacy mode (customPath)", {customPath: "."}],
  ])("%s: the written output imports its CSS correctly", async (_mode, pluginOptions) => {
    await watchFirstBuild({input, plugins: [libStylePlugin(pluginOptions)], onwarn, output: {format: "esm", dir: OUTPUT_DIR}})

    expect(cssImportsOf(fs.readFileSync(path.join(OUTPUT_DIR, "file1.js"), "utf-8"))).toEqual(FILE1_CSS_IMPORTS)
    expectWrittenImportsResolve(OUTPUT_DIR, 3)
  })
})
