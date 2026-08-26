const t = await (await fetch('https://clerk.cartesia.ai/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).text()
// знайди клас ApiKeys (pathRoot="/api_keys") та його методи create
let i = t.indexOf('pathRoot="/api_keys"')
console.log("=== ApiKeys class region ===")
console.log(t.slice(i - 200, i + 1400).replace(/\n/g, ' '))
// і path() метод для цього класу
i = t.indexOf('createApiKey')
if (i >= 0) console.log("\n=== createApiKey @ " + i + " ===\n" + t.slice(i - 400, i + 300).replace(/\n/g, ' '))
