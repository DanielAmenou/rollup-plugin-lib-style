# rollup-plugin-lib-style

This plugin allows you to import CSS or SASS/SCSS files in your Rollup library and include them in the generated output. The plugin will extract the CSS or SASS/SCSS from the imported files and import them as a CSS file


When creating a library, you may want to use CSS modules to create scoped styles for your components. However, when publishing your library as a standalone package, you also need to include the CSS styles that are used by your components. Rollup Plugin Lib Style automates this process by generating a CSS file that includes all the imported CSS modules.

## Why

Today there are 2 main ways to bundle and import styles from a library

- Having a single CSS file for all styles in the library
- Using CSS-in-JS (styled-components, emotion, ...)

These two ways have some disadvantages when we are having a single CSS file, we are importing styles that probably will not be necessary, and when we are using CSS-in-JS we are increasing the HTML size

This plugin brings you the ability to consume only the used styles from the library

## Install

```bash
yarn add rollup-plugin-lib-style --dev
npm i rollup-plugin-lib-style --save-dev
```

## Usage

```js
// rollup.config.js
import {libStylePlugin} from "rollup-plugin-lib-style"

export default {
  plugins: [libStylePlugin()],
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
Default: "[local]\_[hash:hex:6]"<br />
Description: customize the scoped name of the classname.
Available placeholders: [local], [hash], [hash:\<digset>], [hash:\<digset>:\<length>] [hash:\<length>]
Available digset: "latin1", "hex", "base64"

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
  plugins: [libStylePlugin({loaders: [lessLoader]})],
}
```

### exclude
Type: Array<string | RegExp> | string | RegExp<br />
Default: null<br />
Description: exclude files from load by the loader

### customPath
Type: string<br />
Default: "."<br />
Description: Change custom path for starting of reference to CSS file, useful for nested component structure

### customCSSPath
Type: (id: string) => string<br />
Default: undefined<br />
Description: A callback that allows you to transform where to store import the generated CSS file from. For example, `Header.module.scss` transformed to `Header.module.css`, but NextJS treat `.module.scss` as CSS module, so you cannot import it directly. Then you can use `return id.replace(process.cwd(), "").replace(/\\/g, "/").replace('.module', '')` to fix it. This will affect both CSS filename and the `import` statement.

### customCSSInjectedPath
Type: (id: string) => string<br />
Default: undefined<br />
Description: A callback that allows you to transform the injected `import` statement path. For example, if you have deep nested css files like `./components/headers/Header.css` placed along with their corresponding js, this can be transformed to `./Header.css`. This will affect both CSS filename and the `import` statement.

## Global Styles
In some cases, we will want to create global class names (without hash)
we can do so by adding ".global" to the style file name.
In this case, the scopedName will be "[local]"
Example: myStyle.global.css, mySecondStyle.global.scss

```css
// myStyle.global.css
.myStyle {
  background-color: red;
}
```

```js
// myStyle.global.css.js
import "./myComponent/style.css"

var style = {myStyle: "myStyle"}

export {style as default}
```

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
  plugins: [libStylePlugin()],
}
```

## License

MIT &copy; [Daniel Amenou](https://github.com/DanielAmenou)
