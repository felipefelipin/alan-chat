// utils/gestures.js
// Reconhecimento de toque sem nenhuma lib — cobre os dois padrões usados no app:
// 1) swipe genérico (fechar post, trocar post)
// 2) gestos de story (tap esquerda/direita, segurar pra pausar, swipe pra fechar/trocar)

const TAP_MOVE_TOLERANCE = 10;

export function attachSwipe(target, { axis = "both", threshold = 70, onSwipe, onDrag, onDragEnd } = {}) {
  let startX = 0, startY = 0, dx = 0, dy = 0, active = false;

  const start = (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; dx = 0; dy = 0; active = true;
  };
  const move = (e) => {
    if (!active) return;
    const t = e.touches[0];
    dx = t.clientX - startX; dy = t.clientY - startY;
    onDrag?.(dx, dy);
  };
  const end = () => {
    if (!active) return;
    active = false;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    let dir = null;
    if (axis !== "y" && absX > threshold && absX > absY) dir = dx > 0 ? "right" : "left";
    else if (axis !== "x" && absY > threshold && absY > absX) dir = dy > 0 ? "down" : "up";
    onDragEnd?.(dir, dx, dy);
    if (dir) onSwipe?.(dir);
  };

  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: true });
  target.addEventListener("touchend", end);
  target.addEventListener("touchcancel", end);

  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", end);
  };
}

export function attachStoryGestures(target, {
  onTapLeft, onTapRight, onHoldStart, onHoldEnd, onSwipeDown, onSwipeHorizontal, onDragY,
} = {}) {
  const HOLD_DELAY = 180;
  let startX = 0, startY = 0, held = false, holdTimer = null, moved = false;

  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  const start = (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; moved = false;
    holdTimer = setTimeout(() => { held = true; onHoldStart?.(); }, HOLD_DELAY);
  };

  const move = (e) => {
    const t = e.touches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if (Math.abs(dx) > TAP_MOVE_TOLERANCE || Math.abs(dy) > TAP_MOVE_TOLERANCE) {
      moved = true;
      clearHold();
    }
    if (dy > 0) onDragY?.(dy);
  };

  const end = (e) => {
    clearHold();
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    const wasHeld = held;
    held = false;

    if (wasHeld) { onHoldEnd?.(); return; }
    if (dy > 80 && Math.abs(dy) > Math.abs(dx)) { onSwipeDown?.(); return; }
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) { onSwipeHorizontal?.(dx > 0 ? "right" : "left"); return; }

    if (!moved) {
      const rect = target.getBoundingClientRect();
      const isRight = (t.clientX - rect.left) > rect.width / 2;
      isRight ? onTapRight?.() : onTapLeft?.();
    }
  };

  const cancel = () => { clearHold(); held = false; };

  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: true });
  target.addEventListener("touchend", end);
  target.addEventListener("touchcancel", cancel);

  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", cancel);
  };
}
