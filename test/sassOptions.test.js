import path from "path"
import fs from "fs-extra"
import {rollup} from "rollup"
import {libStylePlugin, onwarn} from "../src/index"

const MAGIC_PATH = "@@_MAGIC_PATH_@@"
const TESTS_TEMP_DIR = path.join(__dirname, "temp")
const TESTS_INPUT_DIR = path.join(__dirname, "test_files")
const TESTS_OUTPUT_DIR = path.join(__dirname, "temp", "test", "test_files")
const MIXINS_DIR = path.join(__dirname, "test_files", "mixins")

beforeAll(async () => {
  // Ensure the test directories exist
  await fs.ensureDir(TESTS_TEMP_DIR)
  await fs.ensureDir(TESTS_OUTPUT_DIR)
})

afterEach(() => fs.remove(TESTS_TEMP_DIR))

const compileWithSassOptions = async (sassOptions) => {
  const inputFile = path.join(TESTS_INPUT_DIR, "fileMixins.js")

  const bundle = await rollup({
    input: inputFile,
    output: [
      {
        format: "esm",
        dir: TESTS_TEMP_DIR,
      },
    ],
    plugins: [libStylePlugin({sassOptions})],
    onwarn,
  })

  await bundle.write({
    dir: TESTS_TEMP_DIR,
    preserveModules: false,
    entryFileNames: "fileMixins.js",
  })
}

describe("SASS loadPaths functionality", () => {
  test("should compile SASS with mixins when loadPaths is set correctly", async () => {
    await compileWithSassOptions({loadPaths: [MIXINS_DIR]})

    // Check if CSS file was created
    const cssFilePath = path.join(TESTS_OUTPUT_DIR, "sassWithMixins.css")
    expect(fs.existsSync(cssFilePath)).toBe(true)

    // Read the CSS contents
    const cssContent = fs.readFileSync(cssFilePath).toString()

    // Verify that the mixin was included in the CSS
    expect(cssContent).toContain("display: inline-block")
    expect(cssContent).toContain("background-color: blue")
    expect(cssContent).toContain("color: white")
    expect(cssContent).toContain("font-weight: bold")
  })

  test("should fail to compile SASS with mixins when loadPaths is not set", async () => {
    // Testing the negative case - should throw an error when trying to compile
    // without the correct loadPaths
    await expect(compileWithSassOptions({})).rejects.toThrow()
  })

  test("should pass sassOptions to custom loaders", async () => {
    // Create a spy loader to check if sassOptions are correctly passed
    let capturedOptions = null

    const customLoader = {
      name: "sass",
      regex: /\.(sass|scss)$/,
      process: ({filePath, options}) => {
        capturedOptions = options.sassOptions
        // We need to process the file still, so use the real sass compile
        const sass = require("sass")
        return {code: sass.compile(filePath, options.sassOptions || {}).css.toString()}
      },
    }

    const inputFile = path.join(TESTS_INPUT_DIR, "fileMixins.js")
    const sassOptions = {loadPaths: [MIXINS_DIR]}

    const bundle = await rollup({
      input: inputFile,
      output: [{format: "esm", dir: TESTS_TEMP_DIR}],
      plugins: [
        libStylePlugin({
          loaders: [customLoader],
          sassOptions,
        }),
      ],
      onwarn,
    })

    await bundle.write({
      dir: TESTS_TEMP_DIR,
      preserveModules: false,
      entryFileNames: "fileMixins.js",
    })

    // Verify that the sassOptions were passed correctly to the loader
    expect(capturedOptions).toEqual(sassOptions)
  })
})
