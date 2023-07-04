import crypto from "node:crypto"
import {replaceFormat} from "../src/functions"

describe("replaceFormat function", () => {
  it("replaces [local] and [hash:base64:6] correctly", () => {
    const formatString = "[local]_[hash:base64:6]"
    const fileName = "testFile"
    const cssContent = ".myClass { background-color: #000; }"
    const hash = crypto.createHash("md5").update(cssContent).digest("base64").slice(0, 6)

    const result = replaceFormat(formatString, fileName, cssContent)

    expect(result).toEqual(`${fileName}_${hash}`)
  })

  it("replaces [local] and [hash:base64] correctly", () => {
    const formatString = "[local]_[hash:base64:3]"
    const fileName = "testFile"
    const cssContent = ".myClass { background-color: #000; }"
    const hash = crypto.createHash("md5").update(cssContent).digest("base64").slice(0, 3)

    const result = replaceFormat(formatString, fileName, cssContent)

    expect(result).toEqual(`${fileName}_${hash}`)
  })

  it("replaces [local] and [hash:6] correctly", () => {
    const formatString = "[local]_[hash:6]"
    const fileName = "testFile"
    const cssContent = ".myClass { background-color: #000; }"
    const hash = crypto.createHash("md5").update(cssContent).digest("hex").slice(0, 6)

    const result = replaceFormat(formatString, fileName, cssContent)

    expect(result).toEqual(`${fileName}_${hash}`)
  })

  it("replaces [local] correctly", () => {
    const formatString = "[local]"
    const fileName = "testFile"
    const cssContent = ".myClass { background-color: #000; }"

    const result = replaceFormat(formatString, fileName, cssContent)

    expect(result).toEqual(fileName)
  })

  it("produces different hashes for different cssContent", () => {
    const formatString = "[local]_[hash:base64:6]"
    const fileName = "testFile"
    const cssContent1 = ".test1 { font: 100% Helvetica, sans-serif; color: red; }"
    const cssContent2 = ".test2 { font: 100% Helvetica, sans-serif; color: blue; }"

    const result1 = replaceFormat(formatString, fileName, cssContent1)
    const result2 = replaceFormat(formatString, fileName, cssContent2)

    expect(result1).not.toEqual(result2)
  })
})
