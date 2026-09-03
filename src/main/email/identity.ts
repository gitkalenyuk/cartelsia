/**
 * Identity generation for autoreg (2.1.2).
 * The screenshot shows emails like "cartelia_..." with first name "cartelia"
 * getting "This action couldn't be completed". So: no brand words anywhere,
 * no underscores in the local part, 4 generation styles.
 */

const BANNED = ['cartelia', 'cartelsia', 'cartel', 'sonic', 'clerk']

const WORDS = [
  'stone', 'river', 'cloud', 'wolf', 'fox', 'moon', 'storm', 'iron', 'leaf', 'pine',
  'ridge', 'brook', 'frost', 'flare', 'ember', 'quill', 'sage', 'birch', 'clay', 'dune',
  'fern', 'hazel', 'iris', 'jade', 'kite', 'lark', 'maple', 'oak', 'pearl', 'reed',
  'slate', 'thorn', 'vale', 'wick', 'yarrow', 'basil', 'cobalt', 'drift', 'fable', 'garnet'
]

const FIRST_NAMES = [
  'John', 'Michael', 'David', 'Chris', 'Daniel', 'Mark', 'Paul', 'Tom', 'Alex', 'Nick',
  'Anna', 'Maria', 'Kate', 'Olga', 'Emma', 'Julia', 'Laura', 'Nina', 'Sara', 'Eva'
]

const LAST_NAMES = [
  'Smith', 'Johnson', 'Brown', 'Miller', 'Davis', 'Wilson', 'Moore', 'Taylor', 'Clark', 'Lewis',
  'Hall', 'Young', 'King', 'Wright', 'Hill', 'Green', 'Adams', 'Baker', 'Nelson', 'Carter'
]

export type EmailStyle = 'random' | 'word' | 'support' | 'custom'

export function randInt(max: number): number {
  return Math.floor(Math.random() * max)
}

export function randStr(len: number, alphabet: string): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    s += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  }
  return s
}

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function randomWord(): string {
  return WORDS[randInt(WORDS.length)]
}

function randomFirst(): string {
  return FIRST_NAMES[randInt(FIRST_NAMES.length)]
}

function randomLast(): string {
  return LAST_NAMES[randInt(LAST_NAMES.length)]
}

export function isBanned(s: string): boolean {
  const lower = s.toLowerCase()
  return BANNED.some((b) => lower.includes(b))
}

/** Replace banned words (any case) with random letters. */
export function sanitizeBanned(s: string): string {
  let out = s
  for (const b of BANNED) {
    const rx = new RegExp(b, 'gi')
    if (rx.test(out)) {
      out = out.replace(rx, () => randStr(b.length + 2, 'abcdefghijklmnopqrstuvwxyz'))
    }
  }
  return out
}

/** Local part of the email in the chosen style. Never contains "_" or brand words. */
export function genEmailLocal(style: EmailStyle, prefix?: string): string {
  if (style === 'word') {
    return (randomWord() + String(randInt(90) + 10) + randomWord()).slice(0, 24)
  }
  if (style === 'support') {
    return 'support' + String(Date.now()).slice(-13)
  }
  if (style === 'custom' && prefix) {
    const clean = sanitizeBanned(prefix.toLowerCase().replace(/[^a-z0-9]/g, '')).slice(0, 16)
    return clean + randStr(6, 'abcdefghijklmnopqrstuvwxyz0123456789')
  }
  // random (default): 10-12 chars of [a-z0-9], like mt8kb1dc8llr
  const len = 10 + randInt(3)
  return randStr(len, 'abcdefghijklmnopqrstuvwxyz0123456789')
}

export function genName(): { first: string; last: string } {
  return { first: randomFirst(), last: randomLast() }
}

/** Full check before registration: no brand words, valid email shape. */
export function validateIdentity(email: string, first: string, last: string): string | null {
  const local = email.split('@')[0] ?? ''
  if (isBanned(local)) return 'email contains a banned word'
  if (isBanned(first) || isBanned(last)) return 'name contains a banned word'
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return 'email is invalid'
  return null
}
