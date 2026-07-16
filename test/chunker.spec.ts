import { describe, expect, it } from 'vitest'
import { chunkText } from '../src/main/tts/chunker'

describe('chunkText', () => {
  it('повертає порожній масив для порожнього тексту', () => {
    expect(chunkText('', 500)).toEqual([])
    expect(chunkText('   \n\n  ', 500)).toEqual([])
  })

  it('короткий текст — один чанк', () => {
    const chunks = chunkText('Привіт, світе!', 500)
    expect(chunks).toEqual(['Привіт, світе!'])
  })

  it('не рве речення посередині', () => {
    const s1 = 'Перше речення тут досить довге і займає багато місця.'
    const s2 = 'Друге речення теж не коротке, повірте мені на слово.'
    const s3 = 'Третє речення завершує цей абзац остаточно і безповоротно.'
    const chunks = chunkText(`${s1} ${s2} ${s3}`, 120)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120)
      // кожен чанк закінчується кінцем речення
      expect(/[.!?…]$/.test(chunk.trim())).toBe(true)
    }
    // всі слова збережені
    const joined = chunks.join(' ')
    for (const word of `${s1} ${s2} ${s3}`.split(/\s+/)) {
      expect(joined).toContain(word)
    }
  })

  it('кириличні знаки питання й оклику — межі речень', () => {
    const text =
      'Хто тут ходить серед ночі? Я тут стою на варті! Добре, що ти прийшов сюди. Ходімо далі разом, друже.'
    const chunks = chunkText(text, 50)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50)
  })

  it('завелике одне речення ділиться по клаузах/словах, не по буквах', () => {
    const long = 'слово '.repeat(50).trim() + '.'
    const chunks = chunkText(long, 100)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100)
      // не рвемо слова
      for (const piece of chunk.split(/\s+/)) {
        expect(['слово', 'слово.']).toContain(piece)
      }
    }
  })

  it('inline-теги атомарні', () => {
    const text = `Раз два три <break time="500ms"/> чотири пʼять шість сім вісім девʼять десять.`
    const chunks = chunkText(text, 40)
    const joined = chunks.join(' ')
    expect(joined).toContain('<break time="500ms"/>')
  })

  it('абзаци обʼєднуються, поки влазять у ліміт', () => {
    const chunks = chunkText('Абзац один.\n\nАбзац два.', 500)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('Абзац один.')
    expect(chunks[0]).toContain('Абзац два.')
  })

  it('великі абзаци розділяються', () => {
    const para = 'Речення номер раз у цьому абзаці. '.repeat(10)
    const chunks = chunkText(`${para}\n\n${para}`, 200)
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200)
  })
})
