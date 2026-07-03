import postcss from "postcss"
import postcssModules from "postcss-modules"
import {replaceFormat, normalizeClassName} from "./functions"

const DEFAULT_SCOPED_NAME = "[local]_[hash:hex:6]"

/**
 * @typedef {object} postCssLoaderOptions
 * @property {object[]} postCssPlugins
 * @property {string} classNamePrefix
 * @property {string} scopedName
 */

/**
 * @typedef {object} postCssLoaderProps
 * @property {postCssLoaderOptions} options
 * @property {string} filePath  Absolute path of the SOURCE file. Used as
 *   PostCSS `from`, for source maps and for css-modules class hashing.
 * @property {string} [outputPath]  Absolute path of the eventual emitted CSS
 *   asset (i.e. its location inside Rollup's output directory). Used as
 *   PostCSS `to`, so plugins like `postcss-url` resolve `assetsPath` relative
 *   to where the CSS will *actually* live, not to where the source happens
 *   to sit. Falls back to `filePath` when the plugin cannot determine an
 *   output directory (e.g. a generate-only build with no `output.dir` /
 *   `output.file`), preserving legacy behavior in that case.
 * @property {string} code
 */

/**
 * Transform CSS into CSS-modules
 * @param {postCssLoaderProps}
 * @returns
 */
const postCssLoader = async ({code, filePath, outputPath, options}) => {
  const {scopedName = DEFAULT_SCOPED_NAME, postCssPlugins = [], classNamePrefix = ""} = options

  const modulesExported = {}

  const isGlobalStyle = /\.global\.(css|scss|sass|less|stylus)$/.test(filePath)
  const isInNodeModules = /[\\/]node_modules[\\/]/.test(filePath)

  const postCssPluginsWithCssModules = [
    postcssModules({
      generateScopedName: (name, filename, css) => {
        const hashContent = `${filename}:${name}:${css}`
        const rawScopedName = replaceFormat(scopedName, name, hashContent)
        const normalizedName = normalizeClassName(rawScopedName)
        return isInNodeModules || isGlobalStyle
          ? name // Use the original name for global or node_modules styles
          : classNamePrefix + normalizedName // Apply prefix and normalize
      },
      getJSON: (cssFileName, json) => (modulesExported[cssFileName] = json),
    }),
    ...postCssPlugins,
  ]

  const postcssOptions = {
    // `from` stays the source file so source maps, dependency tracking, and
    // css-modules class-name hashing keep working exactly as before.
    from: filePath,
    // `to` reflects the OUTPUT location of the emitted CSS asset (when known).
    // postcss-url and similar plugins resolve their `assetsPath` relative to
    // `to`, so this makes asset placement track Rollup's output structure
    // rather than the source tree's nesting -- see issue #12.
    to: outputPath || filePath,
    map: false,
  }

  const result = await postcss(postCssPluginsWithCssModules).process(code, postcssOptions)

  // collect dependencies
  const dependencies = []
  for (const message of result.messages) {
    if (message.type === "dependency") {
      dependencies.push(message.file)
    }
  }

  // print postcss warnings
  for (const warning of result.warnings()) {
    console.warn(`WARNING: ${warning.plugin}:`, warning.text)
  }

  // The css-modules plugin keys its JSON export by the `from` value we passed,
  // so we look it up under `filePath`.
  return {
    code: `export default ${JSON.stringify(modulesExported[filePath])};`,
    dependencies,
    extracted: {
      id: filePath,
      code: result.css,
    },
  }
}

export default postCssLoader
