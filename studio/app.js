const stages = [
  { percent:0, eyebrow:'今天先收下一条', copy:'收下 1 次，再回看 3 次', button:'收下这条' },
  { percent:25, eyebrow:'已经收下', copy:'已收下 · 下一步是第 1 次回看', button:'看看第 2 天' },
  { percent:50, eyebrow:'完成了一次回看', copy:'已完成第 1 次回看', button:'看看第 7 天' },
  { percent:75, eyebrow:'重要的东西正在留下', copy:'已完成第 2 次回看', button:'看看第 30 天' },
  { percent:100, eyebrow:'回看计划已完成', copy:'已完成第 3 次回看 · 宠物长成', button:'重新体验' },
];

const pet = document.querySelector('#demo-pet');
const lane = document.querySelector('#pet-stage');
const liquid = document.querySelector('#liquid');
const advance = document.querySelector('#advance');
let stage = 0;
let dragging = false;
let offset = 0;

function render() {
  const current = stages[stage];
  liquid.style.setProperty('--fill', `${current.percent}%`);
  document.querySelector('#percent').textContent = `${stage}/4`;
  document.querySelector('#demo-eyebrow').textContent = current.eyebrow;
  document.querySelector('#progress-copy').textContent = current.copy;
  advance.textContent = current.button;
  pet.setAttribute('aria-label', `可拖动的一点宠物，宠物成长 ${current.percent}%`);
  document.querySelectorAll('.rhythm li').forEach((item) => item.classList.toggle('done', Number(item.dataset.step) <= stage));
}

advance.addEventListener('click', () => { stage = stage === 4 ? 0 : stage + 1; render(); });
document.querySelector('#reset').addEventListener('click', () => { stage = 0; pet.classList.remove('manual'); pet.style.removeProperty('left'); render(); });

pet.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  dragging = true;
  pet.classList.add('dragging', 'manual');
  const petRect = pet.getBoundingClientRect();
  offset = event.clientX - petRect.left;
  pet.style.left = `${petRect.left - lane.getBoundingClientRect().left}px`;
  pet.setPointerCapture(event.pointerId);
});
pet.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  event.preventDefault();
  const max = lane.clientWidth - pet.offsetWidth;
  pet.style.left = `${Math.max(0, Math.min(max, event.clientX - lane.getBoundingClientRect().left - offset))}px`;
});
function endDrag(event) {
  if (!dragging) return;
  dragging = false;
  pet.classList.remove('dragging');
  if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
}
pet.addEventListener('pointerup', endDrag);
pet.addEventListener('pointercancel', endDrag);
pet.addEventListener('dragstart', (event) => event.preventDefault());

const journey = document.querySelector('.reading-journey');
if (journey && matchMedia('(hover:hover) and (prefers-reduced-motion:no-preference)').matches) {
  let scheduled = false;
  const updateJourney = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const progress = max > 0 ? Math.min(100, scrollY / max * 100) : 0;
    journey.style.setProperty('--journey-y', `${progress}%`);
    journey.style.setProperty('--journey-top', `${18 + progress * 2.24}px`);
    document.body.classList.toggle('has-scrolled', scrollY > 40);
    scheduled = false;
  };
  addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateJourney); }
  }, { passive:true });
  addEventListener('pointermove', (event) => {
    document.body.style.setProperty('--pointer-x', `${event.clientX}px`);
    document.body.style.setProperty('--pointer-y', `${event.clientY}px`);
    journey.style.setProperty('--journey-x', `${(event.clientX / innerWidth - .5) * 8}px`);
  }, { passive:true });
  updateJourney();
}
render();
