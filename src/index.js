import {createFilter} from "rollup-pluginutils"
import postCssTransformer from "./postCssTransformer"
import fs from "fs-extra"
import sass from "sass"
import path from "path"
import glob from "glob"

const PLUGIN_NAME = "rollup-plugin-lib-style"
const MAGIC_PATH_REGEX = /@@_MAGIC_PATH_@@/g
const MAGIC_PATH = "@@_MAGIC_PATH_@@"

const modulesIds = new Set()

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

const libStylePlugin = (options) => {
  const {loaders, include, exclude, ...postCssOptions} = options
  const allLoaders = [...(loaders || []), ...defaultLoaders]
  const filter = createFilter(include, exclude)
  const getLoader = (filepath) => allLoaders.find((loader) => loader.regex.test(filepath))

  return {
    name: PLUGIN_NAME,

    options(options) {
      if (!options.output) console.error("missing output options")
      else options.output.forEach((outputOptions) => outputPaths.push(outputOptions.dir))
    },

    async transform(code, id) {
      const loader = getLoader(id)
      if (!filter(id) || !loader) return null

      modulesIds.add(id)

      const rawCss = await loader.process({filePath: id, code})

      const postCssResult = await postCssTransformer({code: rawCss.code, fiePath: id, options: postCssOptions})

      for (const dependence of postCssResult.dependencies) this.addWatchFile(dependence)

      const cssFilePath = id.replace(process.cwd(), "").replace(/\\/g, "/")

      // create a new css file with the generated hash class names
      this.emitFile({
        type: "asset",
        fileName: cssFilePath.replace("/", "").replace(loader.regex, ".css"),
        source: postCssResult.extracted.code,
      })

      const importStr = `import "${MAGIC_PATH}${cssFilePath.replace(loader.regex, ".css")}";\n`

      // create a new js file with css module
      return {
        code: importStr + postCssResult.code,
        map: {mappings: ""},
      }
    },

    async closeBundle() {
      const importers = []
      modulesIds.forEach((id) => this.getModuleInfo(id).importers.forEach((importer) => importers.push(path.parse(importer).name + ".js"))) // TODO - add number pattern for duplicate name files

      const importersPaths = outputPaths
        .reduce((result, currentPath) => {
          result.push(glob.sync(`${currentPath}/**/*(${importers.join("|")})`))
          return result
        }, [])
        .flat()

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
