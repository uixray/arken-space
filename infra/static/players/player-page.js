const featureButton = document.querySelector("[data-feature-toggle]");
const featureStage = document.querySelector("[data-feature-stage]");

featureButton?.addEventListener("click", () => {
  const active = featureButton.getAttribute("aria-expanded") === "true";
  featureButton.setAttribute("aria-expanded", String(!active));
  featureStage?.classList.toggle("is-active", !active);
});

const artifacts = [...document.querySelectorAll("[data-reveal]")];
const selectionStatus = document.querySelector("[data-selection-status]");

for (const artifact of artifacts) {
  artifact.addEventListener("click", () => {
    for (const item of artifacts) item.classList.remove("is-selected");
    for (const item of artifacts) item.setAttribute("aria-pressed", "false");
    artifact.classList.add("is-selected");
    artifact.setAttribute("aria-pressed", "true");
    selectionStatus.textContent = `Выбрано: ${artifact.querySelector(".artifact__title")?.textContent ?? "объект"}`;
  });
}

const galleryTrack = document.querySelector("[data-gallery-track]");
document
  .querySelector("[data-gallery-prev]")
  ?.addEventListener("click", () =>
    galleryTrack?.scrollBy({ left: -380, behavior: "smooth" }),
  );
document
  .querySelector("[data-gallery-next]")
  ?.addEventListener("click", () =>
    galleryTrack?.scrollBy({ left: 380, behavior: "smooth" }),
  );

const runner = document.querySelector("[data-runner-stage]");
const runnerHero = document.querySelector("[data-runner-hero]");
const runnerStart = document.querySelector("[data-runner-start]");
const runnerMessage = document.querySelector("[data-runner-message]");
const runnerScore = document.querySelector("[data-runner-score]");
const runnerBest = document.querySelector("[data-runner-best]");

if (runner && runnerHero && runnerStart) {
  let running = false,
    jumping = false,
    velocity = 0,
    height = 0,
    score = 0,
    last = 0,
    spawnAt = 0;
  let obstacles = [];
  let best = Number(localStorage.getItem("irakli-runner-best") || 0);
  runnerBest.textContent = String(best);
  const jump = () => {
    if (running && !jumping) {
      jumping = true;
      velocity = 760;
    }
  };
  const finish = () => {
    running = false;
    runnerMessage.hidden = false;
    runnerMessage.querySelector("strong").textContent = "Доспех звенит";
    runnerMessage.querySelector("span").textContent =
      `Счёт: ${Math.floor(score)}. Попробуйте ещё раз.`;
    runnerStart.textContent = "Ещё один забег";
    best = Math.max(best, Math.floor(score));
    localStorage.setItem("irakli-runner-best", String(best));
    runnerBest.textContent = String(best);
  };
  const frame = (now) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.034);
    last = now;
    score += dt * 10;
    runnerScore.textContent = String(Math.floor(score));
    velocity -= 1850 * dt;
    height = Math.max(0, height + velocity * dt);
    if (!height) {
      jumping = false;
      velocity = 0;
    }
    runnerHero.style.transform = `translateY(${-height}px)`;
    spawnAt -= dt;
    if (spawnAt <= 0) {
      const node = document.createElement("i");
      node.className = "runner__obstacle";
      runner.append(node);
      obstacles.push({ node, x: runner.clientWidth + 40 });
      spawnAt = 1.15 + Math.random() * 1.1;
    }
    const heroX = runner.clientWidth * 0.12,
      heroW = runnerHero.offsetWidth;
    for (const item of obstacles) {
      item.x -= (260 + Math.min(score * 2, 180)) * dt;
      item.node.style.transform = `translateX(${item.x}px)`;
      if (
        item.x < heroX + heroW &&
        item.x + item.node.offsetWidth > heroX &&
        height < item.node.offsetHeight * 0.78
      )
        return finish();
    }
    obstacles = obstacles.filter((item) => {
      if (item.x < -80) {
        item.node.remove();
        return false;
      }
      return true;
    });
    requestAnimationFrame(frame);
  };
  const start = () => {
    obstacles.forEach((item) => item.node.remove());
    obstacles = [];
    score = 0;
    height = 0;
    velocity = 0;
    jumping = false;
    running = true;
    spawnAt = 1.2;
    runnerMessage.hidden = true;
    runnerStart.textContent = "Прыжок";
    runner.focus();
    last = performance.now();
    requestAnimationFrame(frame);
  };
  runnerStart.addEventListener("click", () => (running ? jump() : start()));
  runner.addEventListener("pointerdown", jump);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      if (running) jump();
      else start();
    }
  });
}
