const t = await (await fetch('https://clerk.cartesia.ai/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).text()
function ctx(needle, before, after, max = 4) {
  let i = t.indexOf(needle), c = 0
  while (i >= 0 && c < max) {
    console.log('\n=== ' + needle + ' @' + i + ' ===')
    console.log(t.slice(Math.max(0, i - before), i + after).replace(/\n/g, ' '))
    i = t.indexOf(needle, i + needle.length); c++
  }
  if (c === 0) console.log(needle + ' NOT FOUND')
}
ctx('_basePatch=', 60, 500, 3)
ctx('new URLSearchParams', 300, 200, 3)
const h = await (await fetch('https://play.cartesia.ai/sign-in/create', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' } })).text()
console.log('\nHTML len=' + h.length)
console.log(h.slice(0, 300))
const boots = [...new Set(h.match(/ins_[A-Za-z0-9]+[^"'\\]*?bootstrap[^"'\\]*/g) || [])]
console.log('bootstraps:', boots)
