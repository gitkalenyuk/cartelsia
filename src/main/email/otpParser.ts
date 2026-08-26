/**
 * Парсинг OTP-кодів і лінків з тіла email-повідомлень.
 *
 * Ізольований модуль без IMAP/Node-залежностей — щоб легко тестувати і перевикористовувати
 * (наприклад, для майбутніх HTTP-провайдерів типу MailSlurp).
 *
 * ВАЖЛИВО: OTP парситься СУВОРО після декодування MIME/transfer-encoding.
 * Потік: raw bytes → decodeBody → extractVerification.
 */

/** Quoted-Printable → plain text (обробляє =XX, =\r\n, =3D). */
export function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/=([A-Fa-f0-9]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** Спроба base64-декоду якщо тіло схоже на base64. */
export function tryBase64Decode(input: string): string | null {
  const stripped = input.replace(/\s+/g, '')
  if (stripped.length < 32 || stripped.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) return null
  try {
    const decoded = Buffer.from(stripped, 'base64').toString('utf8')
    // Евристика: декодоване повинно містити читабельний HTML/текст або 6 цифр
    if (decoded.includes('<') || decoded.includes('cartesia') || decoded.includes('verification') || /\d{6}/.test(decoded)) {
      return decoded
    }
    return null
  } catch {
    return null
  }
}

/** Декодує тіло листа з урахуванням Content-Transfer-Encoding. */
export function decodeBody(raw: string, encodingHint?: string): string {
  let out = raw
  const hint = (encodingHint || '').toLowerCase()
  const isBase64 = hint.includes('base64') || (!hint && tryBase64Decode(raw) !== null)

  if (isBase64) {
    const b64 = tryBase64Decode(raw)
    if (b64) return b64
    // fallback: спробувати декодувати навіть якщо евристика не спрацювала
    try {
      const maybe = Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8')
      if (maybe.length > 20) out = maybe
    } catch {
      /* ignore */
    }
  }

  // quoted-printable завжди пробуємо (безпечно для plain text)
  out = decodeQuotedPrintable(out)
  return out
}

/** Витягує 6-значний OTP-код з декодованого тіла. */
export function parseOtpCode(decoded: string): string | null {
  // 1) <b>######</b> — найчастіший шаблон від Cartesia/WorkOS
  const bold = decoded.match(/<b[^>]*>\s*(\d{6})\s*<\/b>/i)
  if (bold) return bold[1]

  // 2) "Verification code: 123456"
  const phrase = decoded.match(/verification\s+code[:\s]+(\d{6})/i)
  if (phrase) return phrase[1]

  // 3) fallback: 6 цифр поруч із "code" / "OTP"
  const loose = decoded.match(/(?:code|otp)[^0-9]{0,20}(\d{6})/i)
  if (loose) return loose[1]

  // 4) дуже вільний: перші 6 цифр підряд у тілі (ризиковано — див. evalBody)
  //    увімкнено тільки якщо явні патерни вище не спрацювали
  const any = decoded.match(/(?<![\d])(\d{6})(?![\d])/)
  return any ? any[1] : null
}

/** Витягує verification-посилання (Cartesia/WorkOS/Confirm). */
export function parseVerificationLink(decoded: string): string | null {
  const urlMatches = decoded.match(/https?:\/\/[^\s"'<>]+/gi) ?? []
  for (const u of urlMatches) {
    const clean = u.replace(/&amp;/gi, '&').replace(/=3D/gi, '=').trim().replace(/[.,;]+$/, '')
    const lower = clean.toLowerCase()
    if (
      lower.includes('cartesia') ||
      lower.includes('workos') ||
      lower.includes('verify') ||
      lower.includes('confirm') ||
      lower.includes('callback')
    ) {
      // Відфільтровуємо unsubscribe/manage-preferences навіть якщо домен містить cartesia
      if (/\bunsub(scribe)?\b|\bmanage[-_]?preferences\b|\bopt[-_]?out\b/i.test(lower)) continue
      return clean
    }
  }
  return null
}

/** Витягує OTP-код та/або лінк з тіла листа. Пріоритет: code > link. */
export function extractVerification(rawBody: string): { code?: string; link?: string } {
  // Визначаємо encoding з заголовків якщо вони в rawBody
  const cteMatch = rawBody.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)
  const encodingHint = cteMatch ? cteMatch[1].trim() : undefined

  // Іноді raw містить IMAP FETCH обгортку (BODY[TEXT]…\r\n\r\n<content>)
  // Безпечно передаємо все — парсер знайде код/лінк у будь-якій частині
  const decoded = decodeBody(rawBody, encodingHint)
  const out: { code?: string; link?: string } = {}

  const code = parseOtpCode(decoded)
  if (code) out.code = code

  const link = parseVerificationLink(decoded)
  if (link) out.link = link

  return out
}
