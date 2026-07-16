// Перевірка instant clone (multipart) + видалення клону. Кредити не витрачаються.
import { readFileSync } from 'fs'

const BASE = 'https://api.cartesia.ai'
const { keys } = JSON.parse(readFileSync('keys.local.json', 'utf8'))
const KEY = keys[2]
const headers = { Authorization: `Bearer ${KEY}`, 'Cartesia-Version': '2026-03-01' }

const clip = readFileSync('test/fixtures/sample.mp3')
const fd = new FormData()
fd.append('clip', new Blob([clip], { type: 'audio/mpeg' }), 'clip.mp3')
fd.append('name', 'Cartelsia Smoke Clone')
fd.append('language', 'uk')
fd.append('description', 'Тимчасовий тестовий клон — буде видалено')

console.log('POST /voices/clone (multipart)…')
const res = await fetch(`${BASE}/voices/clone`, { method: 'POST', headers, body: fd })
if (!res.ok) {
  console.error(`✗ clone HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}
const voice = await res.json()
console.log(`✓ клон створено: id=${voice.id}, name=${voice.name}, language=${voice.language}`)

console.log('GET /voices?is_owner=true — клон видно власнику…')
const own = await fetch(`${BASE}/voices/?limit=20&is_owner=true`, { headers })
const ownBody = await own.json()
const found = ownBody.data?.some((v) => v.id === voice.id)
console.log(found ? '✓ клон у списку власника' : '✗ клон НЕ знайдено у списку')

console.log(`DELETE /voices/${voice.id}…`)
const del = await fetch(`${BASE}/voices/${voice.id}`, { method: 'DELETE', headers })
if (del.ok || del.status === 204) console.log('✓ клон видалено')
else {
  console.error(`✗ delete HTTP ${del.status}: ${(await del.text()).slice(0, 200)}`)
  process.exit(1)
}
console.log('КЛОНУВАННЯ ПРАЦЮЄ')
