// Cartelsia site 2.1.3: reveal-on-scroll, лічильник завантажень, версія, hover-світло на картках
(function () {
  'use strict'

  // ── Reveal on scroll ──
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible')
        io.unobserve(e.target)
      }
    }
  }, { threshold: 0.12 })
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el))

  // ── Hover-підсвітка карток (radial за курсором) ──
  document.querySelectorAll('.cardx').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect()
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px')
      card.style.setProperty('--my', (e.clientY - r.top) + 'px')
    })
  })

  // ── Версія з GitHub Releases (fallback 2.1.3) ──
  const VER_FALLBACK = '2.1.3'
  const versionEls = ['nav-version', 'hero-version', 'cta-version'].map((id) => document.getElementById(id)).filter(Boolean)
  fetch('https://api.github.com/repos/gitkalenyuk/cartelsia/releases/latest')
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.tag_name) return
      const v = String(d.tag_name).replace(/^v/, '')
      for (const el of versionEls) el.textContent = v
    })
    .catch(() => {
      for (const el of versionEls) el.textContent = VER_FALLBACK
    })

  // ── Лічильник завантажень: сума download_count всіх asset-ів усіх релізів ──
  const dlEl = document.getElementById('dl-count')
  if (dlEl) {
    fetch('https://api.github.com/repos/gitkalenyuk/cartelsia/releases?per_page=100')
    .then((r) => r.json())
    .then((releases) => {
      let total = 0
      for (const rel of releases) {
        for (const a of rel.assets || []) total += a.download_count || 0
      }
      dlEl.textContent = total.toLocaleString('uk-UA')
    })
    .catch(() => { dlEl.textContent = '700+' })
  }
})()
