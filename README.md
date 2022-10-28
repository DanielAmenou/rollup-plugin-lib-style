# rollup-plugin-lib-style

A Rollup plugin that converts CSS and extensions for CSS into CSS modules and imports the generated CSS files.
Under the assumption the library will be bundled by webpack or another bundler, it gives us the ability to consume only the used styles

## Why

Today there are 2 main ways to bundle and import style from a library

- bundle all the styles into one big CSS file
- use CSS-in-JS

These two ways have some disadvantages, when we are using one big file we are importing style that probably will not be necessary, and when you are using CSS-in-JS you will increase the HTML size

This plugin brings you the ability to consume only the used styles from the library

## Install

```bash
yarn add rollup-plugin-lib-style --dev
npm i rollup-plugin-lib-style --save-dev
```

## Usage

```js
// rollup.config.js
import {libStyleLoader} from "rollup-plugin-lib-style"

export default {
  plugins: [libStyleLoader()],
}
```

After adding this plugin we will be able to use CSS, SCSS, and SASS files (and more languages by adding plugins)
The imported CSS file will be transformed into a CSS module and a new CSS file will be generated

In the js file that imports style file, the import will be changed in the following way:

```js
import style from "./style.css"
```

```js
import style from "./style.css.js"
```

The newly generated file will export the CSS module, but also will import the new CSS file.

```js
// style.css.js"
import "./myComponent/style.css"

var style = {test: "test_cPySKa"}

export {style as default}
```

This gives us the ability to consume only the used style

## Options

### importCSS
Type: `boolean`<br />
Default: true<br />
Description: auto import the generated CSS

### classNamePrefix

Type: `string`<br />
Default: ""<br />
Description: prefix for the classnames

### scopedName

Type: `string`<br />
Default: "[local]\_[hash:base64:6]"<br />
Description: customize the scoped name of the classname

### postCssPlugins

Type: object[]<br />
Default: []<br />
Description: [PostCSS Plugins](https://postcss.org/docs/postcss-plugins)

### loaders

Type: Loader[]<br />
Default: []<br />
Description: loaders for CSS extension languages like Less, Stylus, ...<br />
Example:

```js
// rollup.config.js
const lessLoader = {
  name: "lessLoader"
  regex: /\.less$/
  process: ({code, filePath}) => less(code)
}

export default {
  plugins: [libStyleLoader({loaders: [lessLoader]})],
}
```

### exclude
Type: Array<string | RegExp> | string | RegExp<br />
Default: null<br />
Description: exclude files from load by the loader


## Known Issues
"Unresolved dependencies" warnings
```
(!) Unresolved dependencies
https://rollupjs.org/guide/en/#warning-treating-module-as-external-dependency
@@_MAGIC_PATH_@@/src/components/Component/style.css (imported by "src/components/Component/style.scss")
```

These warnings can be suppressed by using the "onwarn" function
```js
// rollup.config.js
import {libStylePlugin, onwarn} from "rollup-plugin-lib-style"

export default {
  onwarn,
  plugins: [libStyleLoader()],
}
```

## License

MIT &copy; [Daniel Amenou](https://github.com/DanielAmenou)
