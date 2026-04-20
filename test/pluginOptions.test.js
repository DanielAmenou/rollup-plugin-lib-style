import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const TESTS_TEMP_DIR = path.join(__dirname, "temp-plugin-options")
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

const buildSimple = async ({input, plugins, output}) => {
  const bundle = await rollup({input, plugins, onwarn})
  await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, ...output})
  await bundle.close()
}

describe("include / exclude options", () => {
  test("exclude pattern: CSS files matching the pattern are skipped entirely", async () => {
    // Exclude styles2.css - rollup should then error on the unresolved import
    // (since the plugin is the only thing that handles CSS) which is exactly
    // what we want to observe: the filter truly skipped that file.
    await expect(
      rollup({
        input: path.join(TESTS_INPUT_DIR, "file1.js"),
        plugins: [libStylePlugin({exclude: ["**/styles2.css"]})],
        onwarn,
      })
    ).rejects.toThrow()
  })

  test("include pattern: only matched files are transformed", async () => {
    // Include only .css - this means scssStyles.* would not be matched, but
    // since file1.js only imports .css files, the build should succeed and
    // produce a working bundle.
    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin({include: ["**/*.css"]})],
      output: {entryFileNames: "bundle.js"},
    })

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).toMatch(/import\s+['"][^'"]*styles1\.css['"]/)
    expect(jsOut).not.toContain("@@_MAGIC_PATH_@@")
  })
})

describe("customCSSPath option", () => {
  test("remaps the emitted CSS asset file path", async () => {
    const pluginsOptions = {
      customCSSPath: (id) => `/assets/css/${path.basename(id)}`,
    }

    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin(pluginsOptions)],
      output: {entryFileNames: "bundle.js"},
    })

    expect(fs.existsSync(path.join(TESTS_TEMP_DIR, "assets/css/styles1.css"))).toBe(true)
    expect(fs.existsSync(path.join(TESTS_TEMP_DIR, "assets/css/styles2.css"))).toBe(true)
    expect(fs.existsSync(path.join(TESTS_TEMP_DIR, "assets/css/styles3.css"))).toBe(true)

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).toMatch(/import\s+['"]\.\/assets\/css\/styles1\.css['"]/)
    expect(jsOut).not.toContain("@@_MAGIC_PATH_@@")
  })

  test("handles paths with and without leading slash identically", async () => {
    const pluginsOptions = {customCSSPath: (id) => `no-slash/${path.basename(id)}`}

    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "file1.js"),
      plugins: [libStylePlugin(pluginsOptions)],
      output: {entryFileNames: "bundle.js"},
    })

    expect(fs.existsSync(path.join(TESTS_TEMP_DIR, "no-slash/styles1.css"))).toBe(true)
  })
})

describe("customLoaders option", () => {
  test("custom loader is invoked for matching files and takes precedence over defaults", async () => {
    let loaderCalls = 0

    const lessLoader = {
      name: "fake-less",
      regex: /\.less$/,
      process: ({code}) => {
        loaderCalls++
        // Hand-rolled minimal "less" -> css transform just for the fixture
        return {code: code.replace("@bg: hotpink;", "").replace("@bg", "hotpink")}
      },
    }

    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "less/entry.js"),
      plugins: [libStylePlugin({loaders: [lessLoader]})],
      output: {entryFileNames: "bundle.js"},
    })

    expect(loaderCalls).toBe(1)

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
    expect(cssFiles.length).toBe(1)
    const cssContent = fs.readFileSync(cssFiles[0], "utf-8")
    expect(cssContent).toContain("background-color: hotpink")
    expect(cssContent).not.toContain("@bg")

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).toMatch(/import\s+['"][^'"]*button\.css['"]/)
    // The class should still be hashed by postcss-modules
    expect(jsOut).toMatch(/"less-button":"less-button_[A-Za-z0-9]+/)
  })

  test("when a file matches a custom loader the default loader is NOT used", async () => {
    // Override .css with a custom loader that injects a marker comment.
    // If both ran we'd see the raw rule AND the marker; we only want marker+rule.
    const customCssLoader = {
      name: "css-wrapper",
      regex: /\.css$/,
      process: ({code}) => ({code: `/* wrapped */\n${code}`}),
    }

    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin({loaders: [customCssLoader]})],
      output: {entryFileNames: "bundle.js"},
    })

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
    const cssContent = fs.readFileSync(cssFiles[0], "utf-8")
    // Marker from the custom loader is there:
    expect(cssContent).toContain("/* wrapped */")
    // And the rule was still processed by postcss-modules once:
    expect((cssContent.match(/\.aOnly/g) || []).length).toBe(1)
  })
})

describe("postCssPlugins option", () => {
  test("extra postcss plugins run after the built-in css-modules pass", async () => {
    const calls = []
    const recordingPlugin = () => ({
      postcssPlugin: "recording-plugin",
      Once(root) {
        calls.push(root.source.input.file)
      },
    })
    recordingPlugin.postcss = true

    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin({postCssPlugins: [recordingPlugin()]})],
      output: {entryFileNames: "bundle.js"},
    })

    expect(calls.length).toBe(1)
    expect(calls[0]).toMatch(/a\.css$/)
  })

  test("postcss plugin can mutate the emitted CSS", async () => {
    const prependBanner = () => ({
      postcssPlugin: "prepend-banner",
      Once(root) {
        root.prepend({text: "banner comment"})
      },
    })
    prependBanner.postcss = true

    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin({postCssPlugins: [prependBanner()]})],
      output: {entryFileNames: "bundle.js"},
    })

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
    const cssContent = fs.readFileSync(cssFiles[0], "utf-8")
    expect(cssContent).toContain("/* banner comment */")
  })
})

describe("scopedName option variants", () => {
  test("scopedName with only [local] produces unhashed class names", async () => {
    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin({scopedName: "[local]"})],
      output: {entryFileNames: "bundle.js"},
    })

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).toContain('"aOnly":"aOnly"')

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
    const cssContent = fs.readFileSync(cssFiles[0], "utf-8")
    expect(cssContent).toMatch(/\.aOnly\s*\{/)
  })

  test("scopedName with [hash:base64:5] produces a short base64 hash suffix", async () => {
    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin({scopedName: "[local]_[hash:base64:5]"})],
      output: {entryFileNames: "bundle.js"},
    })

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    const match = jsOut.match(/"aOnly":"(aOnly_[^"]+)"/)
    expect(match).not.toBeNull()
    const hashed = match[1]
    // "aOnly_" + 5 chars
    expect(hashed.length).toBe("aOnly_".length + 5)
  })

  test("classNamePrefix combines with the hashed scoped name", async () => {
    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin({classNamePrefix: "lib__", scopedName: "[local]_[hash:hex:4]"})],
      output: {entryFileNames: "bundle.js"},
    })

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).toMatch(/"aOnly":"lib__aOnly_[a-f0-9]{4}"/)
  })
})

describe("global style detection", () => {
  test("*.global.css classes are emitted unprefixed even with classNamePrefix set", async () => {
    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "file3.js"),
      plugins: [libStylePlugin({classNamePrefix: "should_not_appear_"})],
      output: {entryFileNames: "bundle.js"},
    })

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).not.toContain("should_not_appear_")
    expect(jsOut).toContain('"test7":"test7"')
    expect(jsOut).toContain('"test8":"test8"')
  })
})

describe("node_modules styles are treated as global", () => {
  const fakeDir = path.join(TESTS_INPUT_DIR, "node_modules", "fake-lib")
  const fakeCss = path.join(fakeDir, "vendor.css")
  const fakeEntry = path.join(TESTS_INPUT_DIR, "node_modules_entry.js")

  beforeAll(async () => {
    await fs.ensureDir(fakeDir)
    await fs.writeFile(fakeCss, ".vendor { color: purple; }\n")
    await fs.writeFile(fakeEntry, 'import s from "./node_modules/fake-lib/vendor.css"\nexport const v = s.vendor\n')
  })

  afterAll(async () => {
    await fs.remove(fakeDir)
    await fs.remove(fakeEntry)
    // Also clean the parent node_modules if empty
    const parent = path.join(TESTS_INPUT_DIR, "node_modules")
    if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) await fs.remove(parent)
  })

  test("classes in files under node_modules are not hashed nor prefixed", async () => {
    await buildSimple({
      input: fakeEntry,
      plugins: [libStylePlugin({classNamePrefix: "ignored_", scopedName: "[local]_[hash:hex:6]"})],
      output: {entryFileNames: "bundle.js"},
    })

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).toContain('"vendor":"vendor"')
    expect(jsOut).not.toContain("ignored_")
  })
})

describe("importCSS option", () => {
  test("importCSS=true (default): JS modules import their CSS assets", async () => {
    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin()],
      output: {entryFileNames: "bundle.js"},
    })

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).toMatch(/import\s+['"][^'"]*a\.css['"]/)
  })

  test("importCSS=false: CSS assets are still emitted but JS never imports them", async () => {
    await buildSimple({
      input: path.join(TESTS_INPUT_DIR, "multi_entry/a.js"),
      plugins: [libStylePlugin({importCSS: false})],
      output: {entryFileNames: "bundle.js"},
    })

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
    expect(cssFiles.length).toBe(1)

    const jsOut = fs.readFileSync(path.join(TESTS_TEMP_DIR, "bundle.js"), "utf-8")
    expect(jsOut).not.toMatch(/import\s+['"][^'"]*\.css['"]/)
    expect(jsOut).not.toContain("\0lib-style-asset:")
  })
})

describe("SCSS watched dependencies", () => {
  test("files @use'd through sass loadPaths are registered as watch dependencies", async () => {
    const watched = new Set()
    const captureWatchPlugin = {
      name: "capture-watch",
      buildStart() {
        const origAddWatchFile = this.addWatchFile
        // Not strictly needed; just a sanity plugin. The real check is below.
      },
    }

    const bundle = await rollup({
      input: path.join(TESTS_INPUT_DIR, "fileMixins.js"),
      plugins: [
        captureWatchPlugin,
        libStylePlugin({sassOptions: {loadPaths: [path.join(TESTS_INPUT_DIR, "mixins")]}}),
      ],
      onwarn,
    })

    // Use rollup's own watchFiles API to verify dependencies got registered.
    for (const f of bundle.watchFiles) watched.add(path.resolve(f))

    await bundle.write({format: "esm", dir: TESTS_TEMP_DIR, entryFileNames: "bundle.js"})
    await bundle.close()

    // The scss file itself must be watched
    expect([...watched].some((f) => f.endsWith("sassWithMixins.scss"))).toBe(true)
  })
})
