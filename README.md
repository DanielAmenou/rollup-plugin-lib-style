# rollup-plugin-lib-style

[![License](https://img.shields.io/npm/l/rollup-plugin-lib-style.svg)](https://github.com/danielamenou/rollup-plugin-lib-style/blob/master/LICENSE) [![npm downloads](https://img.shields.io/npm/dt/rollup-plugin-lib-style.svg)](https://www.npmjs.com/package/rollup-plugin-lib-style) [![npm version](https://img.shields.io/npm/v/rollup-plugin-lib-style.svg)](https://www.npmjs.com/package/rollup-plugin-lib-style)

A Rollup plugin for building component libraries with **tree-shakeable, per-component CSS**. Write your styles in CSS, SASS/SCSS, Less, Stylus, or any other CSS preprocessor -- the plugin extracts scoped CSS modules and generates a separate CSS file for each component. Consumers only pay for the styles they actually use.

## Why

There are two common approaches to bundling and distributing styles from a library:

| Approach                                         | Drawback                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Single CSS file**                              | Consumers must import _all_ styles, even for components they never use. Increases total CSS payload and can cause unused-style bloat. |
| **CSS-in-JS** (styled-components, emotion, etc.) | Adds runtime overhead, increases JavaScript bundle size, and can delay first paint since styles are computed at runtime.              |

**rollup-plugin-lib-style** takes a fundamentally better approach for libraries: it generates a **separate CSS file per component**, automatically scoped with CSS modules. This gives you:

- **Zero runtime cost** -- styles are plain CSS files, not JavaScript. No runtime style injection, no extra computation on the client.
- **Tree-shakeable CSS** -- when a consumer imports a component, only that component's CSS is loaded. Unused components contribute zero CSS to the final bundle.
- **Scoped by default** -- CSS module hashing prevents class name collisions between your library and the consuming application, with no extra setup.
- **Preprocessor agnostic** -- works out of the box with CSS and SASS/SCSS, and supports Less, Stylus, and any other preprocessor via custom loaders.
- **preserveModules-friendly** -- each emitted chunk gets a CSS import path computed relative to its own location, so preserving the source module structure, code splitting, and hashed asset names all work out of the box.
- **No consumer-side configuration** -- consumers simply import your components; the CSS is automatically referenced and loaded alongside the JavaScript.

## Install

```bash
npm install rollup-plugin-lib-style --save-dev
```

or

```bash
yarn add rollup-plugin-lib-style --dev
```

## Usage

```js
// rollup.config.js
import {libStylePlugin} from "rollup-plugin-lib-style"

export default {
  plugins: [libStylePlugin()],
}
```

After adding this plugin, you can use CSS and SASS/SCSS files out of the box. Support for Less, Stylus, and other preprocessors can be added via custom loaders (see [loaders](#loaders)).

Each imported style file is transformed into a CSS module. A new `.css` file is generated alongside a `.css.js` file that re-exports the class name mappings and imports the CSS.

For example, given this import:

```js
import style from "./style.css"
```

The plugin transforms it into:

```js
import style from "./style.css.js"
```

The generated `style.css.js` file looks like this:

```js
// style.css.js
import "./myComponent/style.css"

var style = {test: "test_cPySKa"}

export {style as default}
```

This gives consumers the ability to import only the styles they actually use.

## Works with `preserveModules`

The plugin resolves each CSS import path per chunk, so it produces correct output regardless of your Rollup output topology:

- `output.preserveModules: true` -- each emitted JS module imports its CSS using a specifier relative to that module's own location, so modules at different nesting depths all resolve correctly.
- Single-bundle builds (`preserveModules: false`) -- works as before.
- Multiple `output` targets, code splitting, nested chunks, and custom `assetFileNames` -- all supported without extra configuration.

```js
// rollup.config.js
import {libStylePlugin} from "rollup-plugin-lib-style"

export default {
  input: "src/index.js",
  output: {
    dir: "dist",
    format: "esm",
    preserveModules: true, // works out of the box
  },
  plugins: [libStylePlugin()],
}
```

Internally, the plugin emits each CSS file as a Rollup asset and rewrites the import specifier during `renderChunk` using Rollup's authoritative asset file names. This means `bundle.write()` and `bundle.generate()` both produce correct output -- no post-build rewrite step is required.

## Options

### importCSS

Type: `boolean`<br />
Default: `true`<br />
Description: Automatically import the generated CSS file from the JavaScript module.

### classNamePrefix

Type: `string`<br />
Default: `""`<br />
Description: A prefix added to all generated class names.

### scopedName

Type: `string`<br />
Default: `"[local]_[hash:hex:6]"`<br />
Description: Customize the scoped name format for generated class names.<br />
Available placeholders: `[local]`, `[hash]`, `[hash:<digest>]`, `[hash:<digest>:<length>]`, `[hash:<length>]`<br />
Available digests: `"latin1"`, `"hex"`, `"base64"`

### postCssPlugins

Type: `object[]`<br />
Default: `[]`<br />
Description: An array of [PostCSS plugins](https://postcss.org/docs/postcss-plugins) to apply during CSS processing.

### sassOptions

Type: `object`<br />
Default: `{}`<br />
Description: Options passed to the Sass compiler. Can be used to set `loadPaths` for global imports and mixins.

Example:

```js
// rollup.config.js
import {libStylePlugin} from "rollup-plugin-lib-style"

export default {
  plugins: [
    libStylePlugin({
      sassOptions: {
        loadPaths: ["./src/styles", "./node_modules"],
      },
    }),
  ],
}
```

### loaders

Type: `Loader[]`<br />
Default: `[]`<br />
Description: Custom loaders for additional CSS preprocessors like Less, Stylus, etc. Each loader must have a `name`, a `regex` to match file extensions, and a `process` function that returns an object with a `code` property containing the CSS string.

Example:

```js
// rollup.config.js
import {libStylePlugin} from "rollup-plugin-lib-style"

const lessLoader = {
  name: "lessLoader",
  regex: /\.less$/,
  process: ({code, filePath}) => ({code: compileLess(code)}),
}

export default {
  plugins: [libStylePlugin({loaders: [lessLoader]})],
}
```

You can also override the built-in SCSS loader to customize Sass compilation:

```js
// rollup.config.js
import {libStylePlugin} from "rollup-plugin-lib-style"
import sass from "sass"

const customSassLoader = {
  name: "sass",
  regex: /\.(sass|scss)$/,
  process: ({filePath}) => ({
    code: sass
      .compile(filePath, {
        loadPaths: ["./src/styles", "./node_modules"],
      })
      .css.toString(),
  }),
}

export default {
  plugins: [libStylePlugin({loaders: [customSassLoader]})],
}
```

### include

Type: `Array<string | RegExp> | string | RegExp | null`<br />
Default: `null`<br />
Description: A pattern or array of patterns specifying which files to include. By default, all files matched by a loader are included.

### exclude

Type: `Array<string | RegExp> | string | RegExp | null`<br />
Default: `null`<br />
Description: A pattern or array of patterns specifying which files to exclude from processing.

### customCSSPath

Type: `(id: string) => string`<br />
Default: `undefined`<br />
Description: A callback to transform the path used for the generated CSS file. This controls where the CSS asset is emitted. The import specifier in the generated JavaScript is automatically computed from this path.

For example, if your source uses `.module.scss` files but the output should use plain `.css`, you can strip the `.module` portion:

```js
libStylePlugin({
  customCSSPath: (id) => id.replace(process.cwd(), "").replace(/\\/g, "/").replace(".module", ""),
})
```

### customPath _(legacy)_

Type: `string`<br />
Default: `undefined`<br />
Description: Legacy option. When set, the plugin switches to its original magic-path + post-build rewrite behavior, where every CSS import in the output is prefixed with this string. Most users should not need this -- the plugin now computes correct per-chunk relative paths automatically. This option is kept for backward compatibility with existing configurations.

### customCSSInjectedPath _(legacy)_

Type: `(id: string) => string`<br />
Default: `undefined`<br />
Description: Legacy option. When set, the plugin switches to the magic-path + post-build rewrite flow so the injected import specifier can differ from where the CSS file is actually emitted. Most users should not need this; if you want to change the emitted CSS location, use `customCSSPath` instead. Kept for backward compatibility.

## Global Styles

In some cases, you may want class names to remain unscoped (without a hash). You can do this by adding `.global` to the style file name. For global styles, the `scopedName` is set to `"[local]"`, preserving the original class name.

Examples: `myStyle.global.css`, `mySecondStyle.global.scss`

```css
/* myStyle.global.css */
.myStyle {
  background-color: red;
}
```

The generated JavaScript module:

```js
// myStyle.global.css.js
import "./myComponent/style.css"

var style = {myStyle: "myStyle"}

export {style as default}
```

## `onwarn` handler _(only needed with legacy options)_

In its default mode the plugin resolves its own synthetic imports during the build, so Rollup emits no warnings and no `onwarn` handler is required. However, if you opt into legacy behavior by setting `customPath` or `customCSSInjectedPath`, the plugin falls back to its original magic-path mechanism, which causes Rollup to warn about unresolved imports:

```
(!) Unresolved dependencies
https://rollupjs.org/guide/en/#warning-treating-module-as-external-dependency
@@_MAGIC_PATH_@@/src/components/Component/style.css (imported by "src/components/Component/style.scss")
```

In that case, use the exported `onwarn` handler to suppress them:

```js
// rollup.config.js
import {libStylePlugin, onwarn} from "rollup-plugin-lib-style"

export default {
  onwarn,
  plugins: [libStylePlugin({customPath: "."})],
}
```

## License

MIT &copy; [Daniel Amenou](https://github.com/DanielAmenou)
