import {Plugin, TransformHook, RollupWarning} from "rollup"

declare interface ProcessArgs {
  code: string
  filePath: string
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
  postCssPlugins: object[]
  classNamePrefix: string
  scopedName: string
}

type onwarn = (warning: RollupWarning, defaultHandler: (warning: string | RollupWarning) => void) => void
type libStylePlugin = (options?: Options) => Plugin

export {onwarn, libStylePlugin}
