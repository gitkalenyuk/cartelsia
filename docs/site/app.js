// Cartelsia site — tabs, downloads counter
(function () {
  // ── Page tabs (nav) ──
  const pages = ['home', 'docs', 'ai'];
  function show(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-links a').forEach(a =>
      a.classList.toggle('active', a.dataset.page === page));
    window.scrollTo({ top: 0 });
    location.hash = page;
  }
  document.querySelectorAll('[data-page]').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); show(a.dataset.page); }));
  const initial = location.hash.replace('#', '');
  show(pages.includes(initial) ? initial : 'home');

  // ── OS tabs inside AI prompt page ──
  document.querySelectorAll('.tabs2 button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs2 button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const os = btn.dataset.os;
      document.querySelectorAll('.ai-os').forEach(el => {
        el.style.display = el.dataset.os === os ? 'block' : 'none';
      });
    });
  });
  document.querySelectorAll('.copybtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = document.getElementById(btn.dataset.target);
      if (!ta) return;
      navigator.clipboard.writeText(ta.value).then(() => {
        btn.textContent = '✓ Скопійовано';
        setTimeout(() => (btn.textContent = 'Копіювати'), 1600);
      });
    });
  });

  // ── Downloads counter: GitHub Releases API (усі релізи + нові) ──
  async function loadDownloads() {
    const el = document.getElementById('dl-count');
    const els = document.querySelectorAll('.dl-count');
    try {
      const res = await fetch('https://api.github.com/repos/gitkalenyuk/cartelsia/releases?per_page=100');
      const releases = await res.json();
      let total = 0;
      for (const r of releases) for (const a of r.assets || []) total += a.download_count || 0;
      els.forEach(x => (x.textContent = total.toLocaleString('uk-UA')));
      if (el) el.textContent = total.toLocaleString('uk-UA');
    } catch {
      els.forEach(x => (x.textContent = '193+'));
      if (el) el.textContent = '193+'; // 37 (v1.4.0) + 156 (v1.1.0) на момент релізу 2.0
    }
  }
  loadDownloads();
})();
