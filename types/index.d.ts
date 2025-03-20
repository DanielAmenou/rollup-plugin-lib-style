import {PluginImpl, RollupWarning} from "rollup"

declare interface ProcessArgs {
  code: string
  filePath: string
  options?: any
}

declare interface SassOptions {
  loadPaths?: string[]
  [key: string]: any
}

declare interface Loader {
  name: string
  regex: string
  process: (arg: ProcessArgs) => string
}

declare interface Options {
  include?: string | string[]
  exclude?: string | string[]
  loaders?: Loader[]
  importCSS?: boolean
  postCssPlugins?: object[]
  classNamePrefix?: string
  scopedName?: string
  customPath?: string
  customCSSPath?: (id: string) => string
  customCSSInjectedPath?: (id: string) => string
  sassOptions?: SassOptions
}

declare const onwarn: (warning: RollupWarning, defaultHandler: (warning: string | RollupWarning) => void) => void

declare const libStylePlugin: PluginImpl<Options>

export {onwarn, libStylePlugin}
