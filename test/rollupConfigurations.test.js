import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const TESTS_TEMP_DIR = path.join(__dirname, "temp-rollup-configs")
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

/**
 * Assert that every `import '…css'` in every JS file in `root`
 * resolves to a CSS file that actually exists on disk.
 */
const expectAllCssImportsResolvable = (root) => {
  const jsFiles = findFiles(root, ".js")
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
}

describe("rollup output formats", () => {
  const formats = [
    {format: "esm", requirePattern: /^import\s+['"]/m},
    {format: "cjs", requirePattern: /require\(['"][^'"]*\.css['"]\)/},
  ]

  test.each(formats)(
    "format=$format: CSS assets are emitted and imported with a valid relative path",
    async ({format, requirePattern}) => {
      const bundle = await rollup({
        input: path.join(TESTS_INPUT_DIR, "file1.js"),
        plugins: [libStylePlugin()],
        onwarn,
      })

      await bundle.write({
        format,
        dir: TESTS_TEMP_DIR,
        entryFileNames: "bundle.js",
      })
      await bundle.close()

      const mainJs = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
      expect(mainJs).not.toContain("@@_MAGIC_PATH_@@")
      expect(mainJs).toMatch(requirePattern)

      const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
      expect(cssFiles.length).toBeGreaterThanOrEqual(3)

      expectAllCssImportsResolvable(TESTS_TEMP_DIR)
    }
  )

  test("format=iife with a named global produces a valid bundle that references CSS assets", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin()],
      onwarn,
    })

    await bundle.write({
      format: "iife",
      name: "MyLib",
      dir: TESTS_TEMP_DIR,
      entryFileNames: "bundle.iife.js",
    })
    await bundle.close()

    const iifeJs = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.iife.js"), "utf-8")
    expect(iifeJs).toContain("var MyLib")
    expect(iifeJs).not.toContain("@@_MAGIC_PATH_@@")

    // At minimum the asset files for the three source CSS files should exist.
    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
    expect(cssFiles.length).toBeGreaterThanOrEqual(3)
  })

  test("format=umd with preserveModules:false rewrites the injected import path", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin()],
      onwarn,
    })

    await bundle.write({
      format: "umd",
      name: "MyUMD",
      dir: TESTS_TEMP_DIR,
      entryFileNames: "bundle.umd.js",
    })
    await bundle.close()

    const umdJs = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.umd.js"), "utf-8")
    expect(umdJs).toContain("MyUMD")
    expect(umdJs).not.toContain("@@_MAGIC_PATH_@@")
    expect(umdJs).not.toContain("\0lib-style-asset:")
  })
})

describe("rollup multiple outputs (single bundle, multiple write() calls)", () => {
  test("CSS assets are emitted and imports resolve for both esm and cjs write() calls", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin()],
      onwarn,
    })

    const esmDir = path.join(TESTS_TEMP_DIR, "esm")
    const cjsDir = path.join(TESTS_TEMP_DIR, "cjs")

    await bundle.write({format: "esm", dir: esmDir, entryFileNames: "bundle.js"})
    await bundle.write({format: "cjs", dir: cjsDir, entryFileNames: "bundle.js"})
    await bundle.close()

    const esmMain = fs.readFileSync(path.join(esmDir, "bundle.js"), "utf-8")
    const cjsMain = fs.readFileSync(path.join(cjsDir, "bundle.js"), "utf-8")

    expect(esmMain).toMatch(/import\s+['"][^'"]*styles1\.css['"]/)
    expect(cjsMain).toMatch(/require\(['"][^'"]*styles1\.css['"]\)/)

    expectAllCssImportsResolvable(esmDir)
    expectAllCssImportsResolvable(cjsDir)
  })
})

describe("rollup multi-input configurations", () => {
  test("input as array: each entry gets its own CSS imports and assets are shared", async () => {
    const bundle = await rollup({
      input: [
        path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
        path.join(TESTS_INPUT_DIR, "multi_entry/b.js"),
      ],
      plugins: [libStylePlugin()],
      onwarn,
    })

    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, preserveModules: false})
    await bundle.close()

    const aOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "a.js"), "utf-8")
    const bOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "b.js"), "utf-8")

    expect(aOut).toMatch(/import\s+['"][^'"]*a\.css['"]/)
    expect(bOut).toMatch(/import\s+['"][^'"]*b\.css['"]/)
    expect(aOut).not.toMatch(/b\.css/)
    expect(bOut).not.toMatch(/a\.css/)

    expectAllCssImportsResolvable(TESTS_TEMP_DIR)
  })

  test("input as object: output filenames use the entry keys", async () => {
    const bundle = await rollup({
      input: {
        alpha: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
        beta: path.join(TESTS_INPUT_DIR, "multi_entry/b.js"),
      },
      plugins: [libStylePlugin()],
      onwarn,
    })

    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, preserveModules: false})
    await bundle.close()

    expect(fs.existsSync(path.join(TESTS_TEMP_DIR, "alpha.js"))).toBe(true)
    expect(fs.existsSync(path.join(TESTS_TEMP_DIR, "beta.js"))).toBe(true)

    const alphaOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "alpha.js"), "utf-8")
    expect(alphaOut).toMatch(/import\s+['"][^'"]*a\.css['"]/)

    expectAllCssImportsResolvable(TESTS_TEMP_DIR)
  })
})

describe("rollup custom filename patterns", () => {
  test("entryFileNames with a subfolder still produces resolvable relative CSS imports", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin()],
      onwarn,
    })

    await bundle.write({
      format: "esm",
      dir: TESTS_TEMP_DIR,
      entryFileNames: "dist/js/[name].js",
    })
    await bundle.close()

    const entryJs = fs.readFileSync(path.join(TESTS_TEMP_DIR, "dist/js/file1.js"), "utf-8")

    const match = entryJs.match(/import\s+['"]([^'"]*\.css)['"]/)
    expect(match).not.toBeNull()

    // The emitted CSS assets live at test/test_files/*.css (based on the
    // source paths), so the rewritten import must climb back out of dist/js/.
    expect(match[1].startsWith("../") || match[1].startsWith("./")).toBe(true)

    expectAllCssImportsResolvable(TESTS_TEMP_DIR)
  })

  test("preserveModules:true with a shared chunk dir emits CSS per module", async () => {
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "nested/entry.js"),
      plugins: [libStylePlugin()],
      onwarn,
    })

    await bundle.write({
      format: "esm",
      dir: TESTS_TEMP_DIR,
      preserveModules: true,
      preserveModulesRoot: path.join(TESTS_INPUT_DIR, "nested"),
    })
    await bundle.close()

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css").map((f) => path.basename(f))
    expect(cssFiles).toContain("Button.css")
    expect(cssFiles).toContain("Widget.css")

    expectAllCssImportsResolvable(TESTS_TEMP_DIR)
  })
})

describe("plugin composition with rollup", () => {
  test("another plugin's transform runs before lib-style without breaking CSS imports", async () => {
    const markerPlugin = {
      name: "marker-plugin",
      transform(code, id) {
        if (id.endsWith(".js")) {
          return {code: `/* marker */\n${code}`, map: null}
        }
        return null
      },
    }

    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [markerPlugin, libStylePlugin()],
      onwarn,
    })

    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"})
    await bundle.close()

    const out = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(out).toContain("/* marker */")
    expect(out).toMatch(/import\s+['"][^'"]*styles1\.css['"]/)
    expect(out).not.toContain("@@_MAGIC_PATH_@@")
  })

  test("plugin is a no-op for files that don't match its loaders", async () => {
    // If a non-CSS import is encountered, transform should return null and
    // rollup should pass the code through untouched (besides its own work).
    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin()],
      onwarn,
    })

    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "a.js"})
    await bundle.close()

    const out = fs.readFileSync(path.join(TESTS_TEMP_DIR, "a.js"), "utf-8")
    expect(out).toContain("aClass")
    expect(out).toMatch(/import\s+['"][^'"]*a\.css['"]/)
  })
})
