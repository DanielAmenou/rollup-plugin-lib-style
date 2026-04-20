import path from "node:path"
import {createFilter} from "@rollup/pluginutils"
import postCssTransformer from "./postCssTransformer"
import fs from "fs-extra"
import sass from "sass"
import glob from "glob"

const PLUGIN_NAME = "rollup-plugin-lib-style"

// Marker specifier injected into transformed JS. The suffix is the rollup
// asset reference id returned by this.emitFile, which lets us look up the
// asset's final relative fileName in renderChunk and rewrite each import to
// a path that is correct relative to the specific chunk containing it.
const MARKER_PREFIX = "\0lib-style-asset:"
const MARKER_REGEX = /(['"])\0lib-style-asset:([^'"]+)\1/g

// Legacy placeholder kept for backward compatibility with the
// `customPath` / `customCSSInjectedPath` options and the exported `onwarn`
// helper. See the legacy branch in transform/closeBundle below.
const MAGIC_PATH = "@@_MAGIC_PATH_@@"
const MAGIC_PATH_REGEX = /@@_MAGIC_PATH_@@/g

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

const toPosix = (p) => p.replace(/\\/g, "/")

const libStylePlugin = (options = {}) => {
  const {customPath, customCSSPath, customCSSInjectedPath, loaders, include, exclude, importCSS = true, sassOptions = {}, ...postCssOptions} = options
  const allLoaders = [...(loaders || []), ...defaultLoaders]
  const filter = createFilter(include, exclude)
  const getLoader = (filepath) => allLoaders.find((loader) => loader.regex.test(filepath))

  // `customPath` and `customCSSInjectedPath` intentionally let the injected
  // specifier diverge from the emitted asset's path. Preserve the legacy
  // magic-path + closeBundle rewrite for those cases so previously-working
  // setups keep working; use the new asset-reference flow otherwise.
  const useLegacyInjection = customPath !== undefined || customCSSInjectedPath !== undefined

  // Per-instance state, used only for the legacy injection path.
  const outputPaths = []

  return {
    name: PLUGIN_NAME,

    options(opts) {
      if (!useLegacyInjection) return null
      if (!opts.output) console.error("missing output options")
      else opts.output.forEach((outputOptions) => outputPaths.push(outputOptions.dir))
      return null
    },

    async transform(code, id) {
      const loader = getLoader(id)
      if (!filter(id) || !loader) return null

      const rawCss = await loader.process({filePath: id, code, options: {sassOptions}})
      const postCssResult = await postCssTransformer({code: rawCss.code, fiePath: id, options: postCssOptions})

      for (const dependency of postCssResult.dependencies) this.addWatchFile(dependency)

      const getDefaultFilePath = () => id.replace(process.cwd(), "").replace(/\\/g, "/")

      const cssFilePath = customCSSPath ? customCSSPath(id) : getDefaultFilePath()
      const cssFilePathWithoutSlash = cssFilePath.startsWith("/") ? cssFilePath.substring(1) : cssFilePath
      const emittedFileName = cssFilePathWithoutSlash.replace(loader.regex, ".css")

      const refId = this.emitFile({
        type: "asset",
        fileName: emittedFileName,
        source: postCssResult.extracted.code,
      })

      let importStr = ""
      if (importCSS) {
        if (useLegacyInjection) {
          const cssFileInjectedPath = customCSSInjectedPath ? customCSSInjectedPath(cssFilePath) : cssFilePath
          importStr = `import "${MAGIC_PATH}${cssFileInjectedPath.replace(loader.regex, ".css")}";\n`
        } else {
          importStr = `import "${MARKER_PREFIX}${refId}";\n`
        }
      }

      return {
        code: importStr + postCssResult.code,
        map: {mappings: ""},
      }
    },

    resolveId(source) {
      if (typeof source === "string" && source.startsWith(MARKER_PREFIX)) {
        return {id: source, external: true}
      }
      return null
    },

    renderChunk(code, chunk) {
      if (!importCSS || useLegacyInjection) return null
      if (!code.includes(MARKER_PREFIX)) return null

      const chunkDir = path.posix.dirname(toPosix(chunk.fileName))
      let modified = false

      const newCode = code.replace(MARKER_REGEX, (match, quote, refId) => {
        const assetFileName = toPosix(this.getFileName(refId))
        let rel = path.posix.relative(chunkDir, assetFileName)
        if (!rel.startsWith(".")) rel = "./" + rel
        modified = true
        return `${quote}${rel}${quote}`
      })

      return modified ? {code: newCode, map: null} : null
    },

    async closeBundle() {
      if (!importCSS || !useLegacyInjection) return

      const importersPaths = outputPaths
        .reduce((result, currentPath) => {
          if (currentPath) result.push(glob.sync(`${currentPath}/**/*.js`))
          return result
        }, [])
        .flat()

      await Promise.all(
        importersPaths.map((currentPath) =>
          fs
            .readFile(currentPath)
            .then((buffer) => buffer.toString())
            .then((fileContent) => fileContent.replace(MAGIC_PATH_REGEX, customPath ?? "."))
            .then((fileContent) => fs.writeFile(currentPath, fileContent))
        )
      )
    },
  }
}

const onwarn = (warning, warn) => {
  if (warning.code === "UNRESOLVED_IMPORT" && warning.message.includes(MAGIC_PATH)) return
  if (typeof warn === "function") warn(warning)
}

export {libStylePlugin, onwarn}
