const t = await (await fetch('https://clerk.cartesia.ai/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).text()
function ctx(needle, before, after, max = 6) {
  let i = t.indexOf(needle), c = 0
  while (i >= 0 && c < max) {
    console.log('\n=== ' + needle + ' @' + i + ' ===')
    console.log(t.slice(Math.max(0, i - before), i + after).replace(/\n/g, ' '))
    i = t.indexOf(needle, i + needle.length); c++
  }
}
ctx('proof_token', 260, 200, 6)
ctx('specter', 240, 240, 8)
ctx('getProof', 200, 200, 6)
