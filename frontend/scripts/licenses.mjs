#!/usr/bin/env node
/**
 * Writes public/third-party-licenses.txt: every package shipped in the app (production
 * dependencies only), with its licence and full licence text. Open-source licences such as
 * MIT and ISC require these notices to travel with the software, so the file is served at
 * /third-party-licenses.txt and linked from the login page.
 *
 *   npm run licenses
 *
 * Exits with an error if a package has no licence or a licence outside ALLOWED, so a
 * problem dependency is caught before it ships.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "MIT OR Apache-2.0", "Unlicense"])

const tree = JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))
const found = new Map()
function walk(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (!info.version) continue
    found.set(`${name}@${info.version}`, name)
    walk(info.dependencies)
  }
}
walk(tree.dependencies)

const problems = []
const sections = []
for (const id of [...found.keys()].sort()) {
  const name = found.get(id)
  const dir = join("node_modules", name)
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const license = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "UNKNOWN")
  if (!ALLOWED.has(license)) problems.push(`${id}: ${license}`)
  const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f)) : undefined
  const text = file ? readFileSync(join(dir, file), "utf8").trim() : `${license} licence (no licence file shipped with the package).`
  sections.push(`${"=".repeat(72)}\n${id}\nLicence: ${license}\n${pkg.homepage ? `Homepage: ${pkg.homepage}\n` : ""}\n${text}\n`)
}

const header = `Tailor POS uses the following open-source software. Thank you to its authors.\n${found.size} packages.\n\n`
writeFileSync("public/third-party-licenses.txt", header + sections.join("\n"))
console.log(`Wrote public/third-party-licenses.txt (${found.size} packages).`)
if (problems.length) {
  console.error(`Licences that need a look before shipping:\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
