const t = await (await fetch('https://clerk.cartesia.ai/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).text()
function ctx(needle, before, after, max = 4, startAt = 0) {
  let i = t.indexOf(needle, startAt), c = 0
  while (i >= 0 && c < max) {
    console.log('\n=== ' + needle + ' @' + i + ' ===')
    console.log(t.slice(Math.max(0, i - before), i + after).replace(/\n/g, ' '))
    i = t.indexOf(needle, i + needle.length); c++
  }
}
ctx('_basePatch(e)', 100, 420, 3)
ctx('_basePost(e)', 50, 420, 2)
// environment: fetch page HTML, find protectCheck / specter cid
const h = await (await fetch('https://play.cartesia.ai/sign-in/create', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' } })).text()
const m1 = h.match(/protectCheck[^,}]{0,200}/g) || []
console.log('\nHTML protectCheck:', m1.slice(0, 4).join(' || '))
const boots = [...new Set(h.match(/https?:\/\/[^"\s]*bootstrap\.js[^"\s]*/g) || [])]
console.log('HTML bootstrap URLs:', boots)
const m2 = h.match(/inspect[^"]{0,80}/g) || []
console.log('inspect:', m2.slice(0, 2))
