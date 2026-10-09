// Swipe a list row to the left to reveal its action buttons (Edit, Delete).
// Vertical scrolling still works: rows use `touch-action: pan-y`, and a gesture only
// becomes a swipe once it is clearly sideways.
//
// Markup:  <li class="sw-item"> <div class="sw-actions">…[data-swipe-act]…</div> <a class="sw-front">…</a> </li>

export function enableSwipe(list, { width = 168, onAction } = {}) {
  let open = null; // the row currently showing its actions
  let g = null; // gesture in progress
  let suppressClick = false;

  const front = (li) => li.querySelector('.sw-front');
  function setX(li, x, animate = true) {
    li.classList.toggle('dragging', !animate);
    front(li).style.transform = x ? `translateX(${x}px)` : '';
  }
  function openRow(li) {
    if (open && open !== li) closeRow(open);
    open = li;
    li.classList.add('open');
    setX(li, -width);
  }
  function closeRow(li) {
    if (!li) return;
    li.classList.remove('open');
    setX(li, 0);
    if (open === li) open = null;
  }

  list.addEventListener('pointerdown', (e) => {
    const f = e.target.closest('.sw-front');
    if (!f || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const li = f.closest('.sw-item');
    g = { li, x: e.clientX, y: e.clientY, base: li === open ? -width : 0, dx: 0, active: false, id: e.pointerId };
  });

  list.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g = null; return; } // vertical scroll
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      g.active = true;
      if (open && open !== g.li) closeRow(open);
      try { front(g.li).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    let x = g.base + dx;
    if (x > 0) x /= 4; // resist past the closed position
    if (x < -width) x = -width + (x + width) / 4; // and past fully open
    g.dx = dx;
    setX(g.li, x, false);
  });

  function end(e) {
    if (!g || e.pointerId !== g.id) return;
    const done = g;
    g = null;
    if (!done.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 60);
    const x = done.base + done.dx;
    if (x < -width * 0.45) openRow(done.li);
    else closeRow(done.li);
  }
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);

  // Clicks: run actions, swallow the click that ends a swipe, close an open row on tap.
  list.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    const act = e.target.closest('[data-swipe-act]');
    const li = e.target.closest('.sw-item');
    if (act && li) {
      e.preventDefault();
      e.stopPropagation();
      closeRow(li);
      onAction?.(act.dataset.swipeAct, li);
      return;
    }
    if (open && li === open && e.target.closest('.sw-front')) {
      e.preventDefault();
      e.stopPropagation();
      closeRow(open);
    }
  }, true);

  // Tapping anywhere else closes the open row.
  const onDocDown = (e) => { if (open && !open.contains(e.target)) closeRow(open); };
  document.addEventListener('pointerdown', onDocDown);
  return () => document.removeEventListener('pointerdown', onDocDown);
}
