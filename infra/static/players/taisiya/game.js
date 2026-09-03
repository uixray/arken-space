(() => {
  "use strict";

  const ROUND_DURATION_MS = 25_000;
  const TARGET_LIFETIME_MS = 1_250;
  const POSITION_MIN = 14;
  const POSITION_MAX = 86;

  const board = document.querySelector("#game-board");
  const intro = document.querySelector("#game-intro");
  const startButton = document.querySelector("#start-game");
  const target = document.querySelector("#luck-target");
  const scoreOutput = document.querySelector("#score");
  const streakOutput = document.querySelector("#streak");
  const timerOutput = document.querySelector("#timer");
  const statusOutput = document.querySelector("#game-status");

  if (
    !board ||
    !intro ||
    !startButton ||
    !target ||
    !scoreOutput ||
    !streakOutput ||
    !timerOutput ||
    !statusOutput
  ) {
    return;
  }

  let score = 0;
  let streak = 0;
  let isPlaying = false;
  let roundStartedAt = 0;
  let frameId = 0;
  let targetTimeoutId = 0;
  let previousPosition = { x: 50, y: 50 };

  const randomCoordinate = () =>
    POSITION_MIN + Math.random() * (POSITION_MAX - POSITION_MIN);

  const formatSeconds = (milliseconds) =>
    (Math.max(0, milliseconds) / 1000).toFixed(1).replace(".", ",");

  const updateScoreboard = (remaining = ROUND_DURATION_MS) => {
    scoreOutput.textContent = String(score);
    streakOutput.textContent = String(streak);
    timerOutput.textContent = formatSeconds(remaining);
  };

  const choosePosition = () => {
    let x = randomCoordinate();
    let y = randomCoordinate();
    let attempts = 0;

    while (
      Math.hypot(x - previousPosition.x, y - previousPosition.y) < 24 &&
      attempts < 8
    ) {
      x = randomCoordinate();
      y = randomCoordinate();
      attempts += 1;
    }

    previousPosition = { x, y };
    target.style.setProperty("--x", `${x.toFixed(1)}%`);
    target.style.setProperty("--y", `${y.toFixed(1)}%`);
    target.classList.remove("is-new");
    void target.offsetWidth;
    target.classList.add("is-new");
  };

  const scheduleTargetMove = () => {
    window.clearTimeout(targetTimeoutId);
    targetTimeoutId = window.setTimeout(() => {
      if (!isPlaying) {
        return;
      }

      streak = 0;
      updateScoreboard(
        ROUND_DURATION_MS - (performance.now() - roundStartedAt),
      );
      statusOutput.textContent = "Звезда ускользнула — начинается новая серия.";
      choosePosition();
      scheduleTargetMove();
    }, TARGET_LIFETIME_MS);
  };

  const finishRound = () => {
    isPlaying = false;
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(targetTimeoutId);
    target.hidden = true;
    intro.hidden = false;
    startButton.textContent = "Играть ещё";
    timerOutput.textContent = "0,0";

    const ending =
      score === 0
        ? "Раунд окончен. Звёзды зовут попробовать ещё раз!"
        : `Раунд окончен! Поймано звёзд: ${score}.`;

    statusOutput.textContent = ending;
    startButton.focus({ preventScroll: true });
  };

  const updateTimer = (now) => {
    if (!isPlaying) {
      return;
    }

    const remaining = ROUND_DURATION_MS - (now - roundStartedAt);
    timerOutput.textContent = formatSeconds(remaining);

    if (remaining <= 0) {
      finishRound();
      return;
    }

    frameId = window.requestAnimationFrame(updateTimer);
  };

  const startRound = () => {
    score = 0;
    streak = 0;
    isPlaying = true;
    roundStartedAt = performance.now();
    previousPosition = { x: 50, y: 50 };
    updateScoreboard();
    intro.hidden = true;
    target.hidden = false;
    statusOutput.textContent = "Раунд начался. Лови первую звезду!";
    choosePosition();
    scheduleTargetMove();
    target.focus({ preventScroll: true });
    window.cancelAnimationFrame(frameId);
    frameId = window.requestAnimationFrame(updateTimer);
  };

  const catchTarget = (event) => {
    if (!isPlaying) {
      return;
    }

    event.stopPropagation();
    score += 1;
    streak += 1;
    const remaining = ROUND_DURATION_MS - (performance.now() - roundStartedAt);
    updateScoreboard(remaining);
    statusOutput.textContent = `Есть! Счёт ${score}, серия ${streak}.`;
    choosePosition();
    scheduleTargetMove();
  };

  const missTarget = (event) => {
    if (!isPlaying || event.target !== board || streak === 0) {
      return;
    }

    streak = 0;
    updateScoreboard(ROUND_DURATION_MS - (performance.now() - roundStartedAt));
    statusOutput.textContent = "Почти! Очки на месте, а серия начнётся заново.";
  };

  startButton.addEventListener("click", startRound);
  target.addEventListener("click", catchTarget);
  board.addEventListener("click", missTarget);
})();
