import path from "node:path"
import {createFilter} from "@rollup/pluginutils"
import postCssTransformer from "./postCssTransformer"
import sass from "sass"

const PLUGIN_NAME = "rollup-plugin-lib-style"

// Marker specifier injected into transformed JS. The suffix is the rollup
// asset reference id returned by this.emitFile, which lets us look up the
// asset's final relative fileName in renderChunk and rewrite each import to
// a path that is correct relative to the specific chunk containing it.
const MARKER_PREFIX = "\0lib-style-asset:"
const MARKER_NAME = "lib-style-asset:"

// Matches a marker specifier in rendered chunk code. Rollup prints the NUL
// byte as-is, but a code printer (terser, swc, esbuild, ...) that renders the
// chunk before us re-escapes it, so the escaped forms are accepted too.
const MARKER_REGEX = /(['"`])(?:\0|\\0|\\x00|\\u0000|\\u\{0+\})lib-style-asset:([^'"`\\\s]+)\1/g

// Looser pattern used as a last check in generateBundle: any marker that is
// still in a chunk at that point (in an escaped form we don't know, or with
// the NUL byte stripped) would ship as an import nobody can resolve.
const LEFTOVER_MARKER_REGEX = /(['"`])(?:\0|\\[0-9a-zA-Z{}]+)?lib-style-asset:([^'"`\\\s]+)\1/g

// The emitted file name for a reference id, or null when the id doesn't
// belong to a file emitted in this build (a look-alike string in user code).
const getEmittedFileName = (context, refId) => {
  try {
    return context.getFileName(refId)
  } catch {
    return null
  }
}

// Legacy placeholder kept for backward compatibility with the
// `customPath` / `customCSSInjectedPath` options and the exported `onwarn`
// helper. It is replaced in memory in renderChunk, like the marker above.
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

// Normalize Rollup's `output` (single object | array | undefined) to a list
// of output directories. For a `file`-only output, derive the dir.
const collectOutputDirs = (output) => {
  if (!output) return []
  const list = Array.isArray(output) ? output : [output]
  const dirs = []
  for (const o of list) {
    if (!o) continue
    if (o.dir) dirs.push(o.dir)
    else if (o.file) dirs.push(path.dirname(o.file))
  }
  return dirs
}

const libStylePlugin = (options = {}) => {
  const {customPath, customCSSPath, customCSSInjectedPath, loaders, include, exclude, importCSS = true, sassOptions = {}, ...postCssOptions} = options
  const allLoaders = [...(loaders || []), ...defaultLoaders]
  const filter = createFilter(include, exclude)
  const getLoader = (filepath) => allLoaders.find((loader) => loader.regex.test(filepath))

  // `customPath` and `customCSSInjectedPath` intentionally let the injected
  // specifier diverge from the emitted asset's path. Preserve the legacy
  // magic-path injection for those cases so previously-working setups keep
  // working; use the asset-reference flow otherwise.
  const useLegacyInjection = customPath !== undefined || customCSSInjectedPath !== undefined

  // Per-instance state.
  // `outputDirs` is consumed by `transform` to anchor PostCSS's `to` option
  //   at the eventual asset OUTPUT location, so plugins like `postcss-url`
  //   resolve `assetsPath` against the build output rather than the source
  //   tree (issue #12).
  const outputDirs = []

  // Legacy flow: swap the placeholder for `customPath` (default ".").
  const rewriteLegacyImports = (code) => {
    if (!code.includes(MAGIC_PATH)) return null
    const replacement = customPath ?? "."
    return {code: code.replace(MAGIC_PATH_REGEX, () => replacement), map: null}
  }

  // Default flow: point each marker at its asset, relative to this chunk.
  const rewriteMarkerImports = (context, code, chunk) => {
    if (!code.includes(MARKER_NAME)) return null

    const chunkDir = path.posix.dirname(toPosix(chunk.fileName))
    let modified = false

    const newCode = code.replace(MARKER_REGEX, (match, quote, refId) => {
      const assetFileName = getEmittedFileName(context, refId)
      if (assetFileName === null) return match // not one of our markers
      let rel = path.posix.relative(chunkDir, toPosix(assetFileName))
      if (!rel.startsWith(".")) rel = "./" + rel
      modified = true
      return `${quote}${rel}${quote}`
    })

    return modified ? {code: newCode, map: null} : null
  }

  return {
    name: PLUGIN_NAME,

    options(opts) {
      // Reset per-build so state doesn't leak across `rollup()` invocations
      // when this plugin instance is reused.
      outputDirs.length = 0
      for (const dir of collectOutputDirs(opts && opts.output)) {
        outputDirs.push(dir)
      }
      return null
    },

    async transform(code, id) {
      const loader = getLoader(id)
      if (!filter(id) || !loader) return null

      const rawCss = await loader.process({filePath: id, code, options: {sassOptions}})

      // Compute the eventual emitted CSS file name BEFORE running PostCSS so
      // we can pass its absolute output location to PostCSS's `to` option.
      // This lets plugins like `postcss-url` (with `assetsPath`) resolve
      // their relative paths against the OUTPUT layout rather than the
      // source tree, which is what issue #12 was about.
      const getDefaultFilePath = () => id.replace(process.cwd(), "").replace(/\\/g, "/")

      const cssFilePath = customCSSPath ? customCSSPath(id) : getDefaultFilePath()
      const cssFilePathWithoutSlash = cssFilePath.startsWith("/") ? cssFilePath.substring(1) : cssFilePath
      const emittedFileName = cssFilePathWithoutSlash.replace(loader.regex, ".css")

      // If we know an output directory (the common case where the user has
      // configured `output.dir` or `output.file` in the rollup options), we
      // anchor `to` there. Otherwise we fall back to the source path, which
      // matches the plugin's pre-fix behavior so generate-only builds and
      // setups that pass `output` only via `bundle.write()` keep working.
      const outputAnchor = outputDirs[0]
      const outputPath = outputAnchor ? path.resolve(outputAnchor, emittedFileName) : id

      const postCssResult = await postCssTransformer({
        code: rawCss.code,
        filePath: id,
        outputPath,
        options: postCssOptions,
      })

      for (const dependency of postCssResult.dependencies) this.addWatchFile(dependency)

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
      if (typeof source !== "string") return null
      if (source.startsWith(MARKER_PREFIX)) return {id: source, external: true}
      // Legacy placeholders are rewritten in renderChunk. Mark them external
      // here so Rollup doesn't warn about them as unresolved imports.
      if (useLegacyInjection && source.startsWith(MAGIC_PATH)) return {id: source, external: true}
      return null
    },

    renderChunk: {
      // Run before minifiers and other code printers (terser, swc, esbuild,
      // ...), which re-escape the marker's NUL byte. Rewriting in memory here
      // also covers `generate()`, `.mjs`/`.cjs` outputs and JS-API builds,
      // which the old post-build rewrite on disk missed.
      order: "pre",
      handler(code, chunk) {
        if (!importCSS) return null
        if (useLegacyInjection) return rewriteLegacyImports(code)
        return rewriteMarkerImports(this, code, chunk)
      },
    },

    generateBundle(outputOptions, bundle) {
      if (!importCSS || useLegacyInjection) return
      // Last line of defence: never write output that still imports a marker.
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk" || !file.code.includes(MARKER_NAME)) continue
        for (const [leftover, , refId] of file.code.matchAll(LEFTOVER_MARKER_REGEX)) {
          // A raw NUL byte only gets into a chunk through a marker import.
          // Escaped or NUL-less look-alikes may be strings in user code, so
          // those only count when they name a file emitted in this build.
          if (!leftover.includes("\0") && getEmittedFileName(this, refId) === null) continue
          this.error(
            `"${file.fileName}" contains an internal CSS import placeholder that ${PLUGIN_NAME} couldn't replace with a CSS file path ` +
              `(${JSON.stringify(leftover)}). This usually means another plugin changed it first. ` +
              `Please open an issue at https://github.com/DanielAmenou/rollup-plugin-lib-style/issues with your plugin list.`
          )
        }
      }
    },
  }
}

// No longer needed: legacy placeholders are resolved by the plugin itself, so
// Rollup doesn't warn about them. Kept so existing configs that use it work.
const onwarn = (warning, warn) => {
  if (warning.code === "UNRESOLVED_IMPORT" && warning.message.includes(MAGIC_PATH)) return
  if (typeof warn === "function") warn(warning)
}

export {libStylePlugin, onwarn}
