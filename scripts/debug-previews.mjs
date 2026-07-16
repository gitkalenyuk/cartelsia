// Діагностика превʼю голосів: скільки мають preview_file_url і чи качаються вони
import { readFileSync } from 'fs'

const { keys } = JSON.parse(readFileSync('keys.local.json', 'utf8'))
const headers = { Authorization: `Bearer ${keys[3]}`, 'Cartesia-Version': '2026-03-01' }

const res = await fetch('https://api.cartesia.ai/voices/?limit=25&expand[]=preview_file_url', {
  headers
})
console.log('GET /voices:', res.status)
const body = await res.json()
const withPrev = body.data.filter((v) => v.preview_file_url)
console.log(`голосів: ${body.data.length}, з preview_file_url: ${withPrev.length}`)
for (const v of body.data.slice(0, 6)) {
  console.log(` - ${v.name} [${v.language}]: ${v.preview_file_url ? v.preview_file_url.slice(0, 90) : 'НЕМАЄ'}`)
}

if (withPrev.length) {
  const url = withPrev[0].preview_file_url
  console.log('\nКачаю перший семпл БЕЗ авторизації…')
  const p1 = await fetch(url)
  console.log(`  status=${p1.status}, type=${p1.headers.get('content-type')}, bytes=${p1.ok ? (await p1.arrayBuffer()).byteLength : '-'}`)
  if (!p1.ok) {
    console.log('Пробую З авторизацією…')
    const p2 = await fetch(url, { headers })
    console.log(`  status=${p2.status}, bytes=${p2.ok ? (await p2.arrayBuffer()).byteLength : '-'}`)
  }
}

// перевірка кодування expand без дужок
const res2 = await fetch('https://api.cartesia.ai/voices/?limit=5&expand=preview_file_url', { headers })
const body2 = await res2.json()
console.log(`\nвар. expand= без []: з превʼю ${body2.data?.filter((v) => v.preview_file_url).length ?? 'err'} із ${body2.data?.length}`)
