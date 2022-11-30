import {createFilter} from "rollup-pluginutils"
import postCssTransformer from "./postCssTransformer"
import fs from "fs-extra"
import sass from "sass"
import glob from "glob"

const PLUGIN_NAME = "rollup-plugin-lib-style"
const MAGIC_PATH_REGEX = /@@_MAGIC_PATH_@@/g
const MAGIC_PATH = "@@_MAGIC_PATH_@@"

const emittedCssFiles = []

const outputPaths = []

const defaultLoaders = [
  {
    name: "sass",
    regex: /\.(sass|scss)$/,
    process: ({filePath}) => ({code: sass.compile(filePath).css.toString()}),
  },
  {
    name: "css",
    regex: /\.(css)$/,
    process: ({code}) => ({code}),
  },
]

const replaceMagicPath = (fileContent) => fileContent.replace(MAGIC_PATH_REGEX, ".")

const libStylePlugin = (options = {}) => {
  const {loaders, include, exclude, importCSS = true, ...postCssOptions} = options
  const allLoaders = [...(loaders || []), ...defaultLoaders]
  const filter = createFilter(include, exclude)
  const getLoader = (filepath) => allLoaders.find((loader) => loader.regex.test(filepath))

  return {
    name: PLUGIN_NAME,

    options(options) {
      if (!options.output) console.error("missing output options")
      else options.output.forEach((outputOptions) => outputPaths.push(outputOptions.dir))
    },

    resolveId(source) {
      console.log("source", source)
      if (emittedCssFiles.some((currentFileId) => source.replace(process.cwd(), "").replace(/\\/g, "/").includes(currentFileId))) return {id: "./file1.js"}
    },

    async transform(code, id) {
      const loader = getLoader(id)
      if (!filter(id) || !loader) return null

      //console.log("emittedCssFiles", id.replace(process.cwd(), "").replace(/\\/g, "/"), emittedCssFiles)
      const rawCss = await loader.process({filePath: id, code})

      const postCssResult = await postCssTransformer({code: rawCss.code, fiePath: id, options: postCssOptions})

      for (const dependence of postCssResult.dependencies) this.addWatchFile(dependence)

      const cssFilePath = id.replace(process.cwd(), "").replace(/\\/g, "/")

      // create a new css file with the generated hash class names
      const newCssFileName = cssFilePath.replace("/", "").replace(loader.regex, ".css")
      emittedCssFiles.push(newCssFileName)

      this.emitFile({
        type: "asset",
        fileName: cssFilePath.replace("/", "").replace(loader.regex, ".css"),
        source: postCssResult.extracted.code,
      })

      const importStr = importCSS ? `import ".${cssFilePath.replace(loader.regex, ".css")}";\n` : ""

      // create a new js file with css module
      return {
        code: importStr + postCssResult.code,
        map: {mappings: ""},
      }
    },

    async closeBundle() {
      if (!importCSS) return

      // get all the modules that import CSS files
      const importersPaths = outputPaths
        .reduce((result, currentPath) => {
          result.push(glob.sync(`${currentPath}/**/*.js`))
          return result
        }, [])
        .flat()

      // replace magic path with relative path
      await Promise.all(
        importersPaths.map((currentPath) =>
          fs
            .readFile(currentPath)
            .then((buffer) => buffer.toString())
            .then(replaceMagicPath)
            .then((fileContent) => fs.writeFile(currentPath, fileContent))
        )
      )
    },
  }
}

const onwarn = (warning, warn) => {
  if (warning.code === "UNRESOLVED_IMPORT" && warning.message.includes(MAGIC_PATH)) return
  warn(warning)
}

export {libStylePlugin, onwarn}
