import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const TESTS_TEMP_DIR = path.join(__dirname, "temp")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")
const TESTS_OUTPUT_DIR = path.join(__dirname, "temp", "test", "test_files")

beforeEach(async () => {
  await writeBundle("file1.js", {libName: "libName"})
  await writeBundle("file2.js", {libName: "libName"})
})

//afterAll(() => fs.remove(TESTS_TEMP_DIR))

const writeBundle = async (fileName, pluginsOptions) => {
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
 
  await newBundle.generate({
    dir: TESTS_TEMP_DIR,
    preserveModules: false,
    entryFileNames: fileName,
  })
}

describe("bundle CSS files", () => {
  test("CSS file created with hash class name", async () => {
    const styles1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "styles1.css")).toString()
    expect(styles1).toMatch(/\.test1_([A-Za-z0-9])/)
  })

  test("CSS file created with global style", async () => {
    const styles3 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "styles3.css")).toString()
    expect(styles3).toMatch(/body {/)
  })

  test("js file contains css import", async () => {
    const file1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file1.js")).toString()
    expect(file1).toContain("import './test/test_files/styles1.css';")
    expect(file1).toContain("import './test/test_files/styles2.css';")
    expect(file1).toContain("import './test/test_files/styles3.css';")
  })
})

describe("bundle SCSS files", () => {
  test("SCSS file created with hash class name", async () => {
    const styles1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "scssStyles.css")).toString()
    expect(styles1).toMatch(/\.test1_([A-Za-z0-9])/)
  })

  test("SCSS file created with sass variable", async () => {
    const styles1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "scssStyles.css")).toString()
    expect(styles1).toMatch(/color: red;/)
  })

  // test("js file contains css import", async () => {
  //   const file1 = fs.readFileSync(path.join(TESTS_OUTPUT_DIR, "..", "..", "file2.js")).toString()
  //   expect(file1).toContain("import './test/test_files/scssStyles.scss';")
  //   expect(file1).toContain("import './test/test_files/scssStyles2.scss';")
  // })
})
