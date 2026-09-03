(() => {
  "use strict";

  const canvas = document.querySelector("#runner-canvas");
  const surface = document.querySelector("#game-surface");
  const startButton = document.querySelector("#start-button");
  const jumpButton = document.querySelector("#jump-button");
  const scoreNode = document.querySelector("#score");
  const bestScoreNode = document.querySelector("#best-score");
  const statusNode = document.querySelector("#game-status");
  const liveNode = document.querySelector("#game-live");

  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(surface instanceof HTMLElement) ||
    !(startButton instanceof HTMLButtonElement) ||
    !(jumpButton instanceof HTMLButtonElement) ||
    !(scoreNode instanceof HTMLElement) ||
    !(bestScoreNode instanceof HTMLElement) ||
    !(statusNode instanceof HTMLElement) ||
    !(liveNode instanceof HTMLElement)
  ) {
    return;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    statusNode.textContent = "Игра не запустилась в этом браузере.";
    startButton.disabled = true;
    jumpButton.disabled = true;
    return;
  }

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const WORLD = Object.freeze({
    width: 360,
    height: 220,
    roofY: 178,
    heroX: 54,
    heroWidth: 30,
    heroHeight: 33,
    gravity: 1180,
    jumpVelocity: -470,
    obstacleSpeed: 152,
  });
  const OBSTACLE_PATTERN = Object.freeze([
    { gap: 1.52, width: 20, height: 32, type: "chimney" },
    { gap: 1.4, width: 16, height: 42, type: "antenna" },
    { gap: 1.68, width: 28, height: 25, type: "vent" },
    { gap: 1.32, width: 18, height: 37, type: "chimney" },
    { gap: 1.78, width: 15, height: 46, type: "antenna" },
  ]);
  const COLORS = Object.freeze({
    skyTop: "#11183a",
    skyBottom: "#29306a",
    moon: "#ffd968",
    mint: "#8df3d6",
    coral: "#ff7f77",
    violet: "#9d8cff",
    paper: "#f7f1cf",
    ink: "#090e24",
    roof: "#151b3d",
    roofEdge: "#45508e",
  });

  const hero = {
    y: WORLD.roofY - WORLD.heroHeight,
    velocityY: 0,
    grounded: true,
  };

  let state = "idle";
  let score = 0;
  let bestScore = 0;
  let obstacles = [];
  let patternIndex = 0;
  let spawnTimer = 1.35;
  let lastFrame = 0;
  let animationFrame = 0;
  let skylineOffset = 0;

  context.scale(2, 2);

  function resetHero() {
    hero.y = WORLD.roofY - WORLD.heroHeight;
    hero.velocityY = 0;
    hero.grounded = true;
  }

  function setScore(nextScore) {
    score = nextScore;
    bestScore = Math.max(bestScore, score);
    scoreNode.textContent = String(score);
    bestScoreNode.textContent = String(bestScore);
  }

  function announce(message) {
    liveNode.textContent = "";
    window.setTimeout(() => {
      liveNode.textContent = message;
    }, 30);
  }

  function startGame() {
    window.cancelAnimationFrame(animationFrame);
    state = "running";
    setScore(0);
    obstacles = [];
    patternIndex = 0;
    spawnTimer = 1.25;
    lastFrame = performance.now();
    resetHero();
    startButton.textContent = "Начать заново";
    jumpButton.textContent = "Прыжок ↑";
    statusNode.textContent = reducedMotion
      ? "В пути! Фон остаётся спокойным, движутся только игровые объекты."
      : "В пути! Следи за препятствиями.";
    surface.setAttribute("aria-label", "Игровое поле. Нажмите, чтобы прыгнуть");
    announce("Забег начался. Нажимай, чтобы перепрыгивать препятствия.");
    drawScene();
    animationFrame = window.requestAnimationFrame(gameLoop);
  }

  function endGame() {
    state = "over";
    hero.velocityY = 0;
    startButton.textContent = "Ещё раз";
    jumpButton.textContent = "Снова + прыжок ↑";
    statusNode.textContent = `Раунд окончен. Счёт: ${score}. Попробуешь ещё?`;
    surface.setAttribute(
      "aria-label",
      "Раунд окончен. Нажмите, чтобы начать снова и прыгнуть",
    );
    announce(`Раунд окончен. Счёт ${score}. Лучший результат ${bestScore}.`);
  }

  function jump() {
    if (!hero.grounded || state !== "running") {
      return;
    }

    hero.grounded = false;
    hero.velocityY = WORLD.jumpVelocity;
  }

  function playAction() {
    if (state !== "running") {
      startGame();
    }
    jump();
  }

  function spawnObstacle() {
    const pattern = OBSTACLE_PATTERN[patternIndex];
    obstacles.push({
      x: WORLD.width + 8,
      width: pattern.width,
      height: pattern.height,
      type: pattern.type,
      passed: false,
    });
    patternIndex = (patternIndex + 1) % OBSTACLE_PATTERN.length;
    spawnTimer = pattern.gap;
  }

  function rectanglesOverlap(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function update(deltaSeconds) {
    hero.velocityY += WORLD.gravity * deltaSeconds;
    hero.y += hero.velocityY * deltaSeconds;

    const groundTop = WORLD.roofY - WORLD.heroHeight;
    if (hero.y >= groundTop) {
      hero.y = groundTop;
      hero.velocityY = 0;
      hero.grounded = true;
    }

    spawnTimer -= deltaSeconds;
    if (spawnTimer <= 0) {
      spawnObstacle();
    }

    if (!reducedMotion) {
      skylineOffset = (skylineOffset + 22 * deltaSeconds) % 72;
    }
    obstacles.forEach((obstacle) => {
      obstacle.x -= WORLD.obstacleSpeed * deltaSeconds;
      if (!obstacle.passed && obstacle.x + obstacle.width < WORLD.heroX) {
        obstacle.passed = true;
        setScore(score + 1);
        if (score > 0 && score % 5 === 0) {
          announce(`${score} точных прыжков!`);
        }
      }
    });
    obstacles = obstacles.filter(
      (obstacle) => obstacle.x + obstacle.width > -8,
    );

    const heroHitbox = {
      x: WORLD.heroX + 6,
      y: hero.y + 4,
      width: WORLD.heroWidth - 12,
      height: WORLD.heroHeight - 5,
    };

    for (const obstacle of obstacles) {
      const obstacleHitbox = {
        x: obstacle.x + 2,
        y: WORLD.roofY - obstacle.height + 2,
        width: obstacle.width - 4,
        height: obstacle.height - 2,
      };

      if (rectanglesOverlap(heroHitbox, obstacleHitbox)) {
        endGame();
        return;
      }
    }
  }

  function roundedRect(x, y, width, height, radius, fill) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fillStyle = fill;
    context.fill();
  }

  function drawSky() {
    const gradient = context.createLinearGradient(0, 0, 0, WORLD.height);
    gradient.addColorStop(0, COLORS.skyTop);
    gradient.addColorStop(1, COLORS.skyBottom);
    context.fillStyle = gradient;
    context.fillRect(0, 0, WORLD.width, WORLD.height);

    context.fillStyle = COLORS.moon;
    context.beginPath();
    context.arc(306, 48, 23, 0, Math.PI * 2);
    context.fill();

    const stars = [
      [28, 34],
      [76, 52],
      [122, 27],
      [170, 61],
      [221, 31],
      [266, 75],
      [337, 91],
    ];
    context.fillStyle = COLORS.paper;
    stars.forEach(([x, y], index) => {
      const size = index % 3 === 0 ? 2 : 1;
      context.fillRect(x, y, size, size);
    });

    context.fillStyle = "#202858";
    for (let x = -skylineOffset - 20; x < WORLD.width + 72; x += 72) {
      const buildingHeight = 40 + ((Math.round(x / 72) + 9) % 3) * 12;
      context.fillRect(x, WORLD.roofY - buildingHeight - 8, 48, buildingHeight);
      context.fillStyle = "rgba(255, 217, 104, 0.45)";
      context.fillRect(x + 9, WORLD.roofY - buildingHeight + 4, 5, 7);
      context.fillRect(x + 27, WORLD.roofY - buildingHeight + 20, 5, 7);
      context.fillStyle = "#202858";
    }

    context.fillStyle = COLORS.roof;
    context.fillRect(0, WORLD.roofY, WORLD.width, WORLD.height - WORLD.roofY);
    context.fillStyle = COLORS.roofEdge;
    context.fillRect(0, WORLD.roofY, WORLD.width, 4);
    context.fillStyle = "rgba(141, 243, 214, 0.14)";
    for (let x = 0; x < WORLD.width; x += 34) {
      context.fillRect(x, WORLD.roofY + 14, 20, 2);
    }
  }

  function drawHero() {
    const x = WORLD.heroX;
    const y = hero.y;

    context.save();
    context.translate(x, y);
    context.fillStyle = COLORS.ink;
    context.strokeStyle = COLORS.mint;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(5, 8);
    context.lineTo(9, 0);
    context.lineTo(14, 8);
    context.lineTo(22, 0);
    context.lineTo(26, 9);
    context.quadraticCurveTo(31, 18, 26, 26);
    context.quadraticCurveTo(15, 34, 4, 26);
    context.quadraticCurveTo(-1, 18, 5, 8);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = COLORS.moon;
    context.beginPath();
    context.ellipse(9, 15, 3.5, 2, 0.2, 0, Math.PI * 2);
    context.ellipse(21, 15, 3.5, 2, -0.2, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = COLORS.violet;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(14, 23);
    context.lineTo(17, 26);
    context.lineTo(21, 22);
    context.stroke();
    context.restore();
  }

  function drawObstacle(obstacle) {
    const y = WORLD.roofY - obstacle.height;

    if (obstacle.type === "antenna") {
      context.strokeStyle = COLORS.coral;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(obstacle.x + obstacle.width / 2, WORLD.roofY);
      context.lineTo(obstacle.x + obstacle.width / 2, y + 7);
      context.stroke();
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(obstacle.x + 2, y + 13);
      context.lineTo(obstacle.x + obstacle.width / 2, y + 2);
      context.lineTo(obstacle.x + obstacle.width - 2, y + 13);
      context.stroke();
      return;
    }

    const fill = obstacle.type === "vent" ? COLORS.violet : COLORS.coral;
    roundedRect(
      obstacle.x,
      y,
      obstacle.width,
      obstacle.height,
      obstacle.type === "vent" ? 6 : 3,
      fill,
    );
    context.fillStyle = "rgba(9, 14, 36, 0.28)";
    context.fillRect(obstacle.x + 4, y + 7, Math.max(3, obstacle.width - 8), 3);
  }

  function drawScene() {
    context.clearRect(0, 0, WORLD.width, WORLD.height);
    drawSky();
    obstacles.forEach(drawObstacle);
    drawHero();

    if (state === "idle") {
      roundedRect(84, 88, 192, 48, 12, "rgba(9, 14, 36, 0.86)");
      context.fillStyle = COLORS.paper;
      context.font = "900 14px Trebuchet MS";
      context.textAlign = "center";
      context.fillText("ТАПНИ, ЧТОБЫ ПРЫГНУТЬ", 180, 117);
    }
  }

  function gameLoop(timestamp) {
    if (state !== "running") {
      return;
    }

    const deltaSeconds = Math.min((timestamp - lastFrame) / 1000, 0.033);
    lastFrame = timestamp;
    update(deltaSeconds);
    drawScene();

    if (state === "running") {
      animationFrame = window.requestAnimationFrame(gameLoop);
    }
  }

  startButton.addEventListener("click", startGame);
  jumpButton.addEventListener("click", playAction);
  surface.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    playAction();
  });
  surface.addEventListener("keydown", (event) => {
    if (
      event.code === "Space" ||
      event.code === "ArrowUp" ||
      event.code === "Enter"
    ) {
      event.preventDefault();
      playAction();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state === "running") {
      lastFrame = performance.now();
    }
  });

  setScore(0);
  resetHero();
  drawScene();
})();
