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

/**
 * Ensures generated class names are valid CSS identifiers.
 * - Replaces invalid characters with `_`
 * - Ensures class names do not start with a number
 * @param {string} name - Original class name
 * @returns {string} - Valid CSS class name
 */
export const normalizeClassName = (hash) => {
  // Replace invalid characters with '_'
  let sanitized = hash.replace(/[^a-zA-Z0-9-_]/g, "_")
  if (/^[0-9]/.test(sanitized)) sanitized = `_${sanitized}`
  return sanitized
}
