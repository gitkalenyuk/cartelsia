const t = await (await fetch('https://clerk.cartesia.ai/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).text()
function c(n, b, a, m = 3) {
  const hits = []
  let i = t.indexOf(n)
  while (i >= 0 && hits.length < m) { hits.push(i); i = t.indexOf(n, i + n.length) }
  console.log('\n### ' + n + ' (' + hits.length + ')')
  hits.forEach(o => console.log('@' + o + ': ' + t.slice(Math.max(0, o - b), o + a).replace(/\n/g, ' ')))
}
c('"/client"', 80, 160, 6)
