import fs from "fs"
import path from "path"
import {builtinModules} from "module"

const ROOT = path.join(__dirname, "..")
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"))

const listJsFiles = (dir) =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listJsFiles(fullPath)
    return entry.name.endsWith(".js") ? [fullPath] : []
  })

// "lodash/fp" -> "lodash", "@scope/name/sub" -> "@scope/name"
const packageName = (specifier) => {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

const bareSpecifiers = (file) => {
  const code = fs.readFileSync(file, "utf-8")
  const patterns = [/^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm, /\brequire\(\s*["']([^"']+)["']\s*\)/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]
  return patterns
    .flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1]))
    .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:"))
}

describe("package.json", () => {
  // Regression test: src/ imported `glob` without declaring it, so the
  // published package failed to load in a clean install.
  test("every package imported from src/ is a declared runtime dependency", () => {
    const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})])

    const undeclared = []
    for (const file of listJsFiles(path.join(ROOT, "src"))) {
      for (const specifier of bareSpecifiers(file)) {
        const name = packageName(specifier)
        if (!builtinModules.includes(name) && !declared.has(name)) {
          undeclared.push(`${path.relative(ROOT, file)} imports "${specifier}"`)
        }
      }
    }

    expect(undeclared).toEqual([])
  })
})
