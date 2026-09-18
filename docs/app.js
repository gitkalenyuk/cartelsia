// Cartelsia v2.2.0 - YouTube Cartel Website Script
(function () {
  'use strict';

  // Reveal on scroll
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        observer.unobserve(e.target);
      }
    }
  }, { threshold: 0.08 });

  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

  // Interactive Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('is-active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('is-active'));

      btn.classList.add('is-active');
      const targetId = 'tab-' + btn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add('is-active');
      }
    });
  });

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
})();
