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
    artifact.classList.add("is-selected");
    selectionStatus.textContent = `Выбрано: ${artifact.querySelector(".artifact__title")?.textContent ?? "объект"}`;
  });
}
