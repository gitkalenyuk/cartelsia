const t = await (await fetch('https://clerk.cartesia.ai/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).text()
const acts = [...new Set((t.match(/action:"([a-z_0-9]+)"/gi) || []).map(s => s.replace(/^action:"|"$/g, '')))]
console.log('ACTIONS:', acts.join(', '))
const comp = [...new Set(t.match(/[a-zA-Z_]*[cC]omplet[a-zA-Z_]*/g) || [])]
console.log('completion-words:', comp.join(', '))
let i = t.indexOf('complete(')
let n = 0
while (i >= 0 && n < 14) {
  console.log('\n--- complete( @' + i + ' ---')
  console.log(t.slice(Math.max(0, i - 140), i + 140).replace(/\n/g, ' '))
  i = t.indexOf('complete(', i + 10)
  n++
}
