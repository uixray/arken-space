// Local specimen presentation only. No app/API/network calls or saved choices.
const specimens = [
  { key: "forum", face: '400 40px "Forum"' },
  { key: "unbounded", face: '500 40px "Unbounded"' },
  { key: "yeseva", face: '400 40px "Yeseva One"' },
];
for (const specimen of specimens) {
  const row = document.querySelector(`[data-font="${specimen.key}"]`);
  const status = row?.querySelector(".font-status");
  if (!row || !status) continue;
  if (!document.fonts?.load) {
    row.dataset.fontState = "error";
    status.textContent =
      "Браузер не сообщает о загрузке шрифта. Сравнение скрыто.";
    continue;
  }
  document.fonts
    .load(specimen.face, "Аркспейс")
    .then((faces) => {
      if (
        faces.length === 0 ||
        faces.some((face) => face.status !== "loaded")
      ) {
        throw new Error("Local font is unavailable");
      }
      row.dataset.fontState = "loaded";
      status.textContent = "Локальный шрифт загружен";
    })
    .catch(() => {
      row.dataset.fontState = "error";
      status.textContent =
        "Локальный файл шрифта не загрузился. Сравнение скрыто, чтобы не показать подмену.";
    });
}
