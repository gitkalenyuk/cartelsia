// Real-API smoke test проти Cartesia.
// Бюджет: ~26 символів за прогін (тільки крок 4). Кроки 1-3 і 5 безкоштовні.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'

const BASE = 'https://api.cartesia.ai'
const VERSION = '2026-03-01'
const TRANSCRIPT = 'Привіт! Це тестова фраза.'

if (TRANSCRIPT.length > 200) {
  console.error(`ВІДМОВА: transcript ${TRANSCRIPT.length} символів > 200 (бюджетний запобіжник)`)
  process.exit(1)
}

const { keys } = JSON.parse(readFileSync('keys.local.json', 'utf8'))
const headers = (key, json = true) => ({
  Authorization: `Bearer ${key}`,
  'Cartesia-Version': VERSION,
  ...(json ? { 'Content-Type': 'application/json' } : {})
})

let failures = 0
const ok = (label) => console.log(`  ✓ ${label}`)
const fail = (label, detail) => {
  failures++
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('1. Валідація ключів через POST /access-token (безкоштовно)')
for (const [i, key] of keys.entries()) {
  const res = await fetch(`${BASE}/access-token`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ grants: { tts: true }, expires_in: 60 })
  })
  if (res.ok) {
    const body = await res.json()
    if (body.token) ok(`ключ #${i + 1} (…${key.slice(-4)}): валідний`)
    else fail(`ключ #${i + 1}: 200, але без token`, JSON.stringify(body).slice(0, 120))
  } else {
    fail(`ключ #${i + 1} (…${key.slice(-4)}): HTTP ${res.status}`, (await res.text()).slice(0, 160))
  }
}

console.log('2. GET /voices (безкоштовно)')
const voicesRes = await fetch(`${BASE}/voices/?limit=10&expand[]=preview_file_url`, {
  headers: headers(keys[0], false)
})
let voiceId = null
if (voicesRes.ok) {
  const body = await voicesRes.json()
  if (Array.isArray(body.data) && body.data.length) {
    ok(`отримано ${body.data.length} голосів (has_more=${body.has_more})`)
    voiceId = body.data[0].id
  } else fail('порожній список голосів', JSON.stringify(body).slice(0, 160))
} else {
  fail(`GET /voices HTTP ${voicesRes.status}`, (await voicesRes.text()).slice(0, 160))
}

console.log('2б. GET /voices?language=uk')
const ukRes = await fetch(`${BASE}/voices/?limit=5&language=uk`, {
  headers: headers(keys[0], false)
})
if (ukRes.ok) {
  const body = await ukRes.json()
  ok(`uk-голосів на сторінці: ${body.data?.length ?? 0}`)
  if (body.data?.length) voiceId = body.data[0].id
} else fail(`HTTP ${ukRes.status}`, (await ukRes.text()).slice(0, 160))

console.log(`3. POST /tts/bytes — "${TRANSCRIPT}" (~${TRANSCRIPT.length} кредитів, ключ #1)`)
if (!voiceId) {
  fail('немає voiceId для генерації')
} else {
  const ttsRes = await fetch(`${BASE}/tts/bytes`, {
    method: 'POST',
    headers: headers(keys[0]),
    body: JSON.stringify({
      model_id: 'sonic-3.5',
      transcript: TRANSCRIPT,
      voice: { mode: 'id', id: voiceId },
      language: 'uk',
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 }
    })
  })
  if (ttsRes.ok) {
    const buf = Buffer.from(await ttsRes.arrayBuffer())
    const isMp3 =
      buf.length > 5000 &&
      (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))
    if (isMp3) {
      mkdirSync('test/fixtures', { recursive: true })
      writeFileSync('test/fixtures/sample.mp3', buf)
      ok(`аудіо ${buf.length} байтів, MP3-сигнатура коректна → test/fixtures/sample.mp3`)
      appendFileSync(
        'usage-ledger.txt',
        `${new Date().toISOString()}\tsmoke\tkey#1\t${TRANSCRIPT.length}\n`
      )
    } else {
      fail(`відповідь не схожа на MP3 (${buf.length} байтів)`, buf.toString('hex', 0, 8))
    }
  } else {
    fail(`POST /tts/bytes HTTP ${ttsRes.status}`, (await ttsRes.text()).slice(0, 300))
  }
}

console.log('4. Бозус-ключ → очікуємо 401/403 (безкоштовно)')
const bogusRes = await fetch(`${BASE}/access-token`, {
  method: 'POST',
  headers: headers('sk_car_bogus00000000000000000'),
  body: JSON.stringify({ grants: { tts: true }, expires_in: 60 })
})
if (bogusRes.status === 401 || bogusRes.status === 403) ok(`невалідний ключ → HTTP ${bogusRes.status}`)
else fail(`очікували 401/403, отримали ${bogusRes.status}`)

console.log(failures ? `\nПРОВАЛЕНО: ${failures} перевірок` : '\nУСІ SMOKE-ПЕРЕВІРКИ ПРОЙШЛИ')
process.exit(failures ? 1 : 0)
