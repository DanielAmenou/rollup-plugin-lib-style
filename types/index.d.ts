import {PluginImpl, RollupWarning} from "rollup"

declare interface ProcessArgs {
  code: string
  filePath: string
  options?: {
    sassOptions?: SassOptions
    [key: string]: any
  }
}

declare interface ProcessResult {
  code: string
}

declare interface SassOptions {
  loadPaths?: string[]
  [key: string]: any
}

declare interface Loader {
  name: string
  regex: RegExp
  process: (args: ProcessArgs) => ProcessResult | Promise<ProcessResult>
}

declare interface Options {
  include?: Array<string | RegExp> | string | RegExp | null
  exclude?: Array<string | RegExp> | string | RegExp | null
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
export type {Options, Loader, ProcessArgs, ProcessResult, SassOptions}
