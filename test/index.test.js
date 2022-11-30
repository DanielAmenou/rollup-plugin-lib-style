import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const MAGIC_PATH = "@@_MAGIC_PATH_@@"
const TESTS_TEMP_DIR = path.join(__dirname, "temp")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")
const TESTS_OUTPUT_DIR = path.join(__dirname, "temp", "test", "test_files")

afterEach(() => fs.remove(TESTS_TEMP_DIR))

const writeBundleHelper = async (fileName, pluginsOptions) => {
  const newBundle = await rollup({
    input: path.join(TESTS_INPUT_DIR, fileName),
    output: [
      {
        format: "esm",
        dir: TESTS_TEMP_DIR,
      },
    ],
    plugins: [libStylePlugin(pluginsOptions)],
    onwarn,
  })

  await newBundle.write({
    dir: TESTS_TEMP_DIR,
    preserveModules: false,
    entryFileNames: fileName,
  })
}

const writeBundle = async (pluginsOptions) => {
  await writeBundleHelper("file1.js", pluginsOptions)
  await writeBundleHelper("file2.js", pluginsOptions)
  await writeBundleHelper("file3.js", pluginsOptions)
}

describe("bundle CSS files", () => {
  test("CSS file created with hash class name", async () => {
    await writeBundle()
    const styles1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "styles1.css")).toString()
    expect(styles1).toMatch(/\.test1_([A-Za-z0-9])/)
  })

  test("CSS file created with global style", async () => {
    await writeBundle()
    const styles3 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "styles3.css")).toString()
    expect(styles3).toMatch(/body {/)
  })

  test("js file contains css import", async () => {
    await writeBundle()
    const file1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file1.js")).toString()
    expect(file1).toContain(`import '${MAGIC_PATH}/test/test_files/styles1.css';`)
    expect(file1).toContain(`import '${MAGIC_PATH}/test/test_files/styles2.css';`)
    expect(file1).toContain(`import '${MAGIC_PATH}/test/test_files/styles3.css';`)
  })

  test("Global Style", async () => {
    await writeBundle()
    const file3 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file3.js")).toString()
    const styles4 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "styles4.global.css")).toString()
    expect(styles4).toContain(".test8 {")
    expect(file3).toContain("{\"test7\":\"test7\",\"test8\":\"test8\"}")
  })
})

describe("bundle SCSS files", () => {
  test("SCSS file created with hash class name", async () => {
    await writeBundle()
    const styles1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "scssStyles.css")).toString()
    expect(styles1).toMatch(/\.test1_([A-Za-z0-9])/)
  })

  test("SCSS file created with sass variable", async () => {
    await writeBundle()
    const styles1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "scssStyles.css")).toString()
    expect(styles1).toMatch(/color: red;/)
  })

  test("js file contains css import", async () => {
    await writeBundle()
    const file1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file2.js")).toString()
    expect(file1).toContain(`import '${MAGIC_PATH}/test/test_files/scssStyles.css';`)
    expect(file1).toContain(`import '${MAGIC_PATH}/test/test_files/scssStyles2.css';`)
  })

  test("Global Style", async () => {
    await writeBundle()
    const file3 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file3.js")).toString()
    const styles3 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "scssStyles3.global.css")).toString()
    expect(styles3).toContain(".test4 {")
    expect(file3).toContain("{\"test7\":\"test7\",\"test8\":\"test8\"}")
  })
})

describe("plugin options", () => {
  test("importCSS: false", async () => {
    const pluginsOptions = {importCSS: false}
    await writeBundle(pluginsOptions)
    const file1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file1.js")).toString()
    expect(file1).not.toContain(`import '${MAGIC_PATH}/test/test_files/styles1.css';`)
  })

  test("classNamePrefix", async () => {
    const pluginsOptions = {classNamePrefix: "test_prefix_"}
    await writeBundle(pluginsOptions)
    const file1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file1.js")).toString()
    expect(file1).toContain("test_prefix_test1")
  })

  test("scopedName", async () => {
    const pluginsOptions = {scopedName: "[local]"}
    await writeBundle(pluginsOptions)
    const file1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file1.js")).toString()
    expect(file1).toContain("{\"test1\":\"test1\"")
  })
})
