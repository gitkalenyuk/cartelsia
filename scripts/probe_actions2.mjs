const t = await (await fetch('https://clerk.cartesia.ai/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).text()
function ctx(needle, before, after, max = 6) {
  let i = t.indexOf(needle), c = 0
  while (i >= 0 && c < max) {
    console.log('\n=== ' + needle + ' @' + i + ' ===')
    console.log(t.slice(Math.max(0, i - before), i + after).replace(/\n/g, ' '))
    i = t.indexOf(needle, i + needle.length); c++
  }
  if (c === 0) console.log(needle + ': NOT FOUND, count=' + ((t.match(new RegExp(needle, 'g')) || []).length))
}
ctx('attemptComplete', 220, 260, 8)
ctx('completeSignUpFlow', 300, 400, 4)
ctx('handleComplete', 200, 300, 4)
ctx('patch(' , 60, 80, 0)
ctx('"complete"', 200, 200, 6)
