import crypto from "node:crypto"

const hashFormats = ["latin1", "hex", "base64"]

export const replaceFormat = (formatString, fileName, cssContent) => {
  const hashLengthMatch = formatString.match(/hash:.*:(\d+)/)
  const hashFormatMatch = formatString.match(/hash:([^:]*)[:-]?/)
  const hashFormat = hashFormatMatch && hashFormats.includes(hashFormatMatch[1]) ? hashFormatMatch[1] : "hex"
  const hashLength = hashLengthMatch ? parseInt(hashLengthMatch[1]) : 6
  const hashString = crypto.createHash("md5").update(cssContent).digest(hashFormat)
  const hashToUse = hashString.length < hashLength ? hashString : hashString.slice(0, hashLength)
  return formatString.replace("[local]", fileName).replace(/\[hash:(.*?)(:\d+)?\]/, hashToUse)
}
