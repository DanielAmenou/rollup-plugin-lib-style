import {createFilter} from "rollup-pluginutils"
import postCssTransformer from "./postCssTransformer"
import fs from "fs-extra"
import sass from "sass"
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
    process: ({filePath, options}) => ({
      code: sass.compile(filePath, options?.sassOptions || {}).css.toString(),
    }),
  },
  {
    name: "css",
    regex: /\.(css)$/,
    process: ({code}) => ({code}),
  },
]

const replaceMagicPath = (fileContent, customPath = ".") => fileContent.replace(MAGIC_PATH_REGEX, customPath)

const libStylePlugin = (options = {}) => {
  const {customPath, customCSSPath, customCSSInjectedPath, loaders, include, exclude, importCSS = true, sassOptions = {}, ...postCssOptions} = options
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

      const rawCss = await loader.process({filePath: id, code, options: {sassOptions}})

      const postCssResult = await postCssTransformer({code: rawCss.code, fiePath: id, options: postCssOptions})

      for (const dependency of postCssResult.dependencies) this.addWatchFile(dependency)

      const getFilePath = () => {
        return id.replace(process.cwd(), "").replace(/\\/g, "/")
      }

      const cssFilePath = customCSSPath ? customCSSPath(id) : getFilePath()
      const cssFileInjectedPath = customCSSInjectedPath ? customCSSInjectedPath(cssFilePath) : cssFilePath
      const cssFilePathWithoutSlash = cssFilePath.startsWith("/") ? cssFilePath.substring(1) : cssFilePath

      // create a new css file with the generated hash class names
      this.emitFile({
        type: "asset",
        fileName: cssFilePathWithoutSlash.replace(loader.regex, ".css"),
        source: postCssResult.extracted.code,
      })

      const importStr = importCSS ? `import "${MAGIC_PATH}${cssFileInjectedPath.replace(loader.regex, ".css")}";\n` : ""

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
            .then((fileContent) => replaceMagicPath(fileContent, customPath))
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
