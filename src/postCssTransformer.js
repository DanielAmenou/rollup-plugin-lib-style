import postcss from "postcss"
import postcssModules from "postcss-modules"

const defaultScopedName = "[local]_[hash:base64:6]"

/**
 * @typedef {object} postCssLoaderOptions
 * @property {object[]} postCssPlugins
 * @property {string} classNamePrefix
 * @property {string} scopedName
 */

/**
 * @typedef {object} postCssLoaderProps
 * @property {postCssLoaderOptions} options
 * @property {string} fiePath
 * @property {string} code
 */

/**
 * Transform CSS into CSS-modules
 * @param {postCssLoaderProps}
 * @returns
 */
const postCssLoader = async ({code, fiePath, options}) => {
  const {scopedName = defaultScopedName, postCssPlugins = [], classNamePrefix = ""} = options

  const modulesExported = {}

  postCssPlugins.unshift(
    postcssModules({
      generateScopedName: classNamePrefix + scopedName,
      getJSON: (cssFileName, json) => (modulesExported[cssFileName] = json),
    })
  )

  const postcssOptions = {
    from: fiePath,
    to: fiePath,
    map: false,
  }

  const result = await postcss(postCssPlugins).process(code, postcssOptions)

  // collect dependencies
  const dependencies = []
  for (const message of result.messages) {
    if (message.type === "dependency") {
      dependencies.add(message.file)
    }
  }

  // print postcss warnings
  for (const warning of result.warnings()) {
    console.warn(warning.message || warning.text)
  }

  return {
    code: `export default ${JSON.stringify(modulesExported[fiePath])};`,
    dependencies,
    extracted: {
      id: fiePath,
      code: result.css,
    },
  }
}

export default postCssLoader