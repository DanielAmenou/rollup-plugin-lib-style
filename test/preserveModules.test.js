import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const TESTS_TEMP_DIR = path.join(__dirname, "temp-preserve-modules")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")

afterEach(() => fs.remove(TESTS_TEMP_DIR))

/**
 * Recursively find all files matching an extension in a directory.
 */
const findFiles = (dir, ext) => {
  const results = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext))
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath)
    }
  }
  return results
}

const buildWithPreserveModules = async (pluginOptions = {}) => {
  const bundle = await rollup({
    input: path.join(TESTS_INPUT_DIR, "nested", "entry.js"),
    output: [
      {
        format: "esm",
        dir: TESTS_TEMP_DIR,
      },
    ],
    plugins: [libStylePlugin(pluginOptions)],
    onwarn,
  })

  await bundle.write({
    dir: TESTS_TEMP_DIR,
    preserveModules: true,
  })

  // closeBundle only runs when bundle.close() is called via the API
  await bundle.close()
}

const buildWithoutPreserveModules = async (fileName, pluginOptions = {}) => {
  const bundle = await rollup({
    input: path.join(TESTS_INPUT_DIR, fileName),
    output: [
      {
        format: "esm",
        dir: TESTS_TEMP_DIR,
      },
    ],
    plugins: [libStylePlugin(pluginOptions)],
    onwarn,
  })

  await bundle.write({
    dir: TESTS_TEMP_DIR,
    preserveModules: false,
    entryFileNames: fileName,
  })

  await bundle.close()
}

describe("preserveModules: true", () => {
  test("CSS files are emitted for each module", async () => {
    await buildWithPreserveModules()

    const cssFiles = findFiles(TESTS_TEMP_DIR, ".css")
    const cssFileNames = cssFiles.map((f) => path.basename(f))

    expect(cssFileNames).toContain("Button.css")
    expect(cssFileNames).toContain("Widget.css")
  })

  test("JS files contain no magic path placeholders after close", async () => {
    await buildWithPreserveModules()

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")
    expect(jsFiles.length).toBeGreaterThan(0)

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(jsFile, "utf-8")
      expect(content).not.toContain("@@_MAGIC_PATH_@@")
    }
  })

  test("each JS file imports its CSS with a path that resolves to an existing file", async () => {
    await buildWithPreserveModules()

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")
    let cssImportsFound = 0

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(jsFile, "utf-8")

      // Find all CSS imports in this JS file
      const cssImportRegex = /import\s+['"]([^'"]*\.css)['"]/g
      let match
      while ((match = cssImportRegex.exec(content)) !== null) {
        cssImportsFound++
        const importPath = match[1]
        // The import path should be relative (start with ./ or ../)
        expect(importPath).toMatch(/^\.\.?\//)

        // Resolve the import relative to the JS file and check the CSS file exists
        const resolvedCssPath = path.resolve(path.dirname(jsFile), importPath)
        expect(fs.existsSync(resolvedCssPath)).toBe(true)
      }
    }

    // We should have found at least 2 CSS imports (Button + Widget)
    expect(cssImportsFound).toBeGreaterThanOrEqual(2)
  })

  test("modules at different nesting depths all resolve correctly", async () => {
    await buildWithPreserveModules()

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")

    // Find the JS wrapper files that contain the CSS imports for Button and Widget
    // With preserveModules, rollup creates .css.js wrapper files
    const buttonCssJs = jsFiles.find((f) => f.includes("Button") && f.endsWith(".css.js"))
    const widgetCssJs = jsFiles.find((f) => f.includes("Widget") && f.endsWith(".css.js"))

    expect(buttonCssJs).toBeDefined()
    expect(widgetCssJs).toBeDefined()

    // Both should have their CSS imports resolved to real files
    const getCssImport = (content) => {
      const match = content.match(/import\s+['"]([^'"]*\.css)['"]/)
      return match ? match[1] : null
    }

    const buttonContent = fs.readFileSync(buttonCssJs, "utf-8")
    const widgetContent = fs.readFileSync(widgetCssJs, "utf-8")

    const buttonCssImport = getCssImport(buttonContent)
    const widgetCssImport = getCssImport(widgetContent)

    expect(buttonCssImport).toBeTruthy()
    expect(widgetCssImport).toBeTruthy()

    // Both resolved paths should point to existing CSS files
    const buttonCssResolved = path.resolve(path.dirname(buttonCssJs), buttonCssImport)
    const widgetCssResolved = path.resolve(path.dirname(widgetCssJs), widgetCssImport)

    expect(fs.existsSync(buttonCssResolved)).toBe(true)
    expect(fs.existsSync(widgetCssResolved)).toBe(true)

    // The resolved CSS files should contain the expected styles
    expect(fs.readFileSync(buttonCssResolved, "utf-8")).toContain("background-color")
    expect(fs.readFileSync(widgetCssResolved, "utf-8")).toContain("background-color")
  })
})

describe("preserveModules: false (regression check)", () => {
  test("CSS imports resolve correctly without preserveModules", async () => {
    await buildWithoutPreserveModules("file1.js")

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(jsFile, "utf-8")
      expect(content).not.toContain("@@_MAGIC_PATH_@@")

      // All CSS imports should resolve to existing files
      const cssImportRegex = /import\s+['"]([^'"]*\.css)['"]/g
      let match
      while ((match = cssImportRegex.exec(content)) !== null) {
        const resolvedCssPath = path.resolve(path.dirname(jsFile), match[1])
        expect(fs.existsSync(resolvedCssPath)).toBe(true)
      }
    }
  })
})

describe("customPath option", () => {
  test("explicit customPath uses legacy single-replacement behavior", async () => {
    await buildWithoutPreserveModules("file1.js", {customPath: "."})

    const file1 = fs.readFileSync(path.join(TESTS_TEMP_DIR, "file1.js"), "utf-8")
    expect(file1).not.toContain("@@_MAGIC_PATH_@@")
    // With customPath=".", the import should start with "./"
    expect(file1).toMatch(/import\s+['"]\.\//)
  })
})

describe("importCSS: false with preserveModules", () => {
  test("no CSS imports are injected when importCSS is false", async () => {
    await buildWithPreserveModules({importCSS: false})

    const jsFiles = findFiles(TESTS_TEMP_DIR, ".js")

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(jsFile, "utf-8")
      expect(content).not.toContain("@@_MAGIC_PATH_@@")
      expect(content).not.toMatch(/import\s+['"][^'"]*\.css['"]/)
    }
  })
})
