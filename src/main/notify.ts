import { Notification } from 'electron'

export function showCompletionNotification(opts: {
  title: string
  chunks: number
  chars: number
  failed: number
}): void {
  if (!Notification.isSupported()) return
  const body =
    opts.failed > 0
      ? `${opts.chunks} фрагментів · ${opts.chars.toLocaleString('uk-UA')} символів · ${opts.failed} з помилкою`
      : `${opts.chunks} фрагментів · ${opts.chars.toLocaleString('uk-UA')} символів`
  new Notification({
    title: `Cartelsia — генерацію завершено`,
    body: `${opts.title}\n${body}`,
    silent: true // звук грає renderer (керується налаштуванням)
  }).show()
}
